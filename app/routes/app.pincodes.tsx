import { useEffect, useRef, useState } from "react"; // naya: useRef
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useSearchParams, // naya
  useSubmit,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../mongo.server";
import { Pincode } from "../models/pincode.server";
import { isValidPostcode, normalizeCountry, normalizePostcode } from "../utils/postcode";

const COUNTRIES = [
  ["IN", "India"],
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["CA", "Canada"],
  ["AU", "Australia"],
  ["DE", "Germany"],
  ["FR", "France"],
  ["NL", "Netherlands"],
  ["JP", "Japan"],
  ["AE", "United Arab Emirates"],
  ["SG", "Singapore"],
] as const;

const COUNTRY_NAME: Record<string, string> = Object.fromEntries(COUNTRIES);

function flag(code: string) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));
}

type CsvRow = {
  country: string;
  pincode: string;
  minDays: number;
  maxDays: number;
  codAvailable: boolean;
};

const MAX_ROWS = 50000;
const PAGE_SIZE = 50; // naya: ek page par kitne codes

function parseCsv(text: string) {
  const rows: CsvRow[] = [];
  const errors: string[] = [];
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    if (!line.trim()) return;

    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    if (lineNo === 1 && /pin|post|zip/i.test(cells[0])) return;

    const [rawPin, min, max, cod, rawCountry] = cells;
    const country = normalizeCountry(rawCountry);
    const pin = normalizePostcode(rawPin, country);

    if (!isValidPostcode(pin, country)) {
      errors.push(`Row ${lineNo}: invalid postal code "${rawPin}" for ${country}`);
      return;
    }

    const minDays = min ? Number(min) : 3;
    const maxDays = max ? Number(max) : 5;

    if (!Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays < 0 || maxDays < 0) {
      errors.push(`Row ${lineNo}: days must be whole numbers`);
      return;
    }
    if (minDays > maxDays) {
      errors.push(`Row ${lineNo}: min days cannot be greater than max days`);
      return;
    }

    const codText = (cod || "yes").toLowerCase();
    const codAvailable = !["no", "false", "0", "n"].includes(codText);

    rows.push({ country, pincode: pin, minDays, maxDays, codAvailable });
  });

  return { rows, errors };
}

const CSV_EXAMPLE = `pincode,min_days,max_days,cod,country
452001,2,4,yes,IN
110001,3,5,yes,IN
SW1A 1AA,5,8,no,GB
90210,4,7,no,US`;

// naya: URL se search (q), country filter aur page padh ke sirf 50 rows laao
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const url = new URL(request.url);
  // "sw1a 1" → "SW1A1" (space/dash/symbol hata ke, taaki regex safe rahe)
  const q = (url.searchParams.get("q") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const countryParam = (url.searchParams.get("country") || "").toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryParam) ? countryParam : "";
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page"))) || 1);

  const filter: any = { shop: session.shop };
  if (country) filter.country = country;
  if (q) filter.pincode = { $regex: `^${q}` }; // shuruaat se match

  const [total, docs] = await Promise.all([
    Pincode.countDocuments(filter),
    Pincode.find(filter)
      .sort({ country: 1, pincode: 1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
  ]);

  return {
    pincodes: docs.map((p) => ({
      id: String(p._id),
      country: p.country,
      pincode: p.pincode,
      minDays: p.minDays,
      maxDays: p.maxDays,
      codAvailable: p.codAvailable,
    })),
    total,
    page,
    q,
    country,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const form = await request.formData();

  if (form.get("intent") === "csv") {
    const file = form.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return { ok: false, source: "csv", message: "Please choose a CSV file" };
    }
    if (file.size > 5 * 1024 * 1024) {
      return { ok: false, source: "csv", message: "File is too large (max 5 MB)" };
    }

    const { rows, errors } = parseCsv(await file.text());

    if (rows.length > MAX_ROWS) {
      return { ok: false, source: "csv", message: `Too many rows (max ${MAX_ROWS})` };
    }
    if (rows.length === 0) {
      return { ok: false, source: "csv", message: "No valid rows found", errors: errors.slice(0, 10) };
    }

    const ops = rows.map((r) => ({
      updateOne: {
        filter: { shop: session.shop, country: r.country, pincode: r.pincode },
        update: { $set: { minDays: r.minDays, maxDays: r.maxDays, codAvailable: r.codAvailable } },
        upsert: true,
      },
    }));
    for (let i = 0; i < ops.length; i += 1000) {
      await Pincode.bulkWrite(ops.slice(i, i + 1000), { ordered: false });
    }

    return {
      ok: true,
      source: "csv",
      message:
        `${rows.length} postal codes imported` +
        (errors.length ? `, ${errors.length} rows skipped` : ""),
      errors: errors.slice(0, 10),
    };
  }

  if (form.get("intent") === "delete") {
    await Pincode.deleteOne({ _id: String(form.get("id")), shop: session.shop });
    return { ok: true, source: "delete", message: "Postal code deleted" };
  }

  const country = normalizeCountry(form.get("country"));
  const pincode = normalizePostcode(form.get("pincode"), country);
  const minDays = Number(form.get("minDays") || 3);
  const maxDays = Number(form.get("maxDays") || 5);
  const codValue = form.get("codAvailable");
  const codAvailable = codValue !== null && codValue !== "" && codValue !== "false";

  if (!isValidPostcode(pincode, country)) {
    return { ok: false, source: "add", message: `Please enter a valid postal code for ${country}` };
  }
  if (!Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays < 0) {
    return { ok: false, source: "add", message: "Days must be whole numbers" };
  }
  if (minDays > maxDays) {
    return { ok: false, source: "add", message: "Min days cannot be greater than max days" };
  }

  await Pincode.findOneAndUpdate(
    { shop: session.shop, country, pincode },
    { minDays, maxDays, codAvailable },
    { upsert: true },
  );
  return { ok: true, source: "add", message: `${country} ${pincode} saved` };
};

export default function PincodesPage() {
  const { pincodes, total, page, q, country } = useLoaderData<typeof loader>(); // naya: total, page, q, country
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams(); // naya

  const busyIntent =
    nav.state === "submitting" ? String(nav.formData?.get("intent") ?? "add") : null;
  const listLoading = nav.state === "loading"; // naya: search/page badalte waqt table par loading

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [exporting, setExporting] = useState(false); // naya
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined); // naya

  useEffect(() => {
    if (!result?.ok) return;
    shopify.toast.show(result.message);
    if (result.source === "add") setFormKey((k) => k + 1);
    if (result.source === "csv") setCsvFile(null);
  }, [result, shopify]);

  // naya: URL ke params badlo (khaali value ho to hata do)
  function updateParams(changes: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  // naya: type karna rukne ke 400ms baad search (har akshar par request nahi)
  function onSearch(value: string) {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => updateParams({ q: value.trim(), page: "" }), 400);
  }

  // naya: export file download
  async function exportCsv() {
    setExporting(true);
    try {
      const res = await fetch("/app/pincodes-export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `postal-codes-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      shopify.toast.show("Export failed. Please try again.", { isError: true });
    } finally {
      setExporting(false);
    }
  }

  function uploadCsv() {
    if (!csvFile) return;
    const fd = new FormData();
    fd.append("intent", "csv");
    fd.append("file", csvFile);
    submit(fd, { method: "post", encType: "multipart/form-data" });
  }

  const addError = result && !result.ok && result.source === "add" ? result.message : null;
  const csvResult = result && result.source === "csv" ? result : null;
  const csvErrors = csvResult && "errors" in csvResult ? csvResult.errors ?? [] : [];

  // naya: pagination ka hisaab
  const hasPreviousPage = page > 1;
  const hasNextPage = page * PAGE_SIZE < total;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const filtering = Boolean(q || country);

  return (
    <s-page heading="Pincodes">
      {/* naya: upar right Export button */}
      <s-button slot="secondary-actions" onClick={exportCsv} loading={exporting}>
        Export CSV
      </s-button>

      {/* ---------- Add / update ---------- */}
      <s-section heading="Add postal code">
        {addError && <s-banner tone="critical">{addError}</s-banner>}

        <Form method="post" key={formKey}>
          <s-grid gridTemplateColumns="2fr 2fr 1fr 1fr" gap="base" alignItems="end">
            <s-select label="Country" name="country" value="IN">
              {COUNTRIES.map(([code, name]) => (
                <s-option key={code} value={code}>
                  {flag(code)} {name}
                </s-option>
              ))}
            </s-select>
            <s-text-field
              label="Postal code"
              name="pincode"
              placeholder="452001 / SW1A 1AA"
              maxLength={10}
              required
            />
            <s-number-field label="Min days" name="minDays" defaultValue="3" min={0} />
            <s-number-field label="Max days" name="maxDays" defaultValue="5" min={0} />
            <s-checkbox label="COD available" name="codAvailable" defaultChecked />
            <s-button type="submit" variant="primary" loading={busyIntent === "add"}>
              Save
            </s-button>
          </s-grid>
        </Form>
      </s-section>

      {/* ---------- CSV ---------- */}
      <s-section heading="Bulk upload (CSV)">
        <s-paragraph>
          Columns: <s-text type="strong">pincode, min_days, max_days, cod, country</s-text>.
          Country is optional (default IN). Existing codes are updated, not duplicated.
        </s-paragraph>

        <s-stack direction="block" gap="base">
          <s-box padding="base" background="subdued" borderRadius="base">
            <pre style={{ margin: 0, fontSize: 13 }}>{CSV_EXAMPLE}</pre>
          </s-box>

          <s-drop-zone
            label="CSV file"
            accept=".csv,text/csv"
            onChange={(e: any) => setCsvFile(e.currentTarget.files?.[0] ?? null)}
          />

          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button
              variant="primary"
              disabled={!csvFile}
              loading={busyIntent === "csv"}
              onClick={uploadCsv}
            >
              Upload CSV
            </s-button>
            {csvFile && <s-text color="subdued">Selected: {csvFile.name}</s-text>}
          </s-stack>

          {csvResult && !csvResult.ok && <s-banner tone="critical">{csvResult.message}</s-banner>}
          {csvErrors.length > 0 && (
            <s-banner tone="warning" heading="Some rows were skipped">
              <s-unordered-list>
                {csvErrors.map((err) => (
                  <s-list-item key={err}>{err}</s-list-item>
                ))}
              </s-unordered-list>
            </s-banner>
          )}
        </s-stack>
      </s-section>

      {/* ---------- List ---------- */}
      <s-section heading={`Saved postal codes (${total})`} padding="none">
        {total === 0 && !filtering ? (
          <s-box padding="base">
            <s-paragraph>No postal codes yet. Add one above or upload a CSV.</s-paragraph>
          </s-box>
        ) : (
          <>
            {/* naya: paginate + loading + filters */}
            <s-table
              paginate
              hasPreviousPage={hasPreviousPage}
              hasNextPage={hasNextPage}
              loading={listLoading}
              onPreviousPage={() => updateParams({ page: String(page - 1) })}
              onNextPage={() => updateParams({ page: String(page + 1) })}
            >
              <s-grid slot="filters" gridTemplateColumns="3fr 1fr" gap="base">
                <s-search-field
                  label="Search postal codes"
                  labelAccessibilityVisibility="exclusive"
                  placeholder="Search postal codes"
                  defaultValue={q}
                  onInput={(e: any) => onSearch(e.currentTarget.value)}
                />
                <s-select
                  label="Country"
                  labelAccessibilityVisibility="exclusive"
                  value={country}
                  onChange={(e: any) => updateParams({ country: e.currentTarget.value, page: "" })}
                >
                  <s-option value="">All countries</s-option>
                  {COUNTRIES.map(([code, name]) => (
                    <s-option key={code} value={code}>
                      {flag(code)} {name}
                    </s-option>
                  ))}
                </s-select>
              </s-grid>

              <s-table-header-row>
                <s-table-header listSlot="primary">Postal code</s-table-header>
                <s-table-header listSlot="secondary">Country</s-table-header>
                <s-table-header listSlot="labeled">Delivery</s-table-header>
                <s-table-header listSlot="inline">COD</s-table-header>
                <s-table-header listSlot="labeled">Actions</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {pincodes.map((p) => (
                  <s-table-row key={p.id}>
                    <s-table-cell>
                      <s-text type="strong">{p.pincode}</s-text>
                    </s-table-cell>
                    <s-table-cell>
                      {flag(p.country)} {COUNTRY_NAME[p.country] ?? p.country}
                    </s-table-cell>
                    <s-table-cell>
                      {p.minDays}–{p.maxDays} days
                    </s-table-cell>
                    <s-table-cell>
                      {p.codAvailable ? (
                        <s-badge tone="success">COD</s-badge>
                      ) : (
                        <s-badge>No COD</s-badge>
                      )}
                    </s-table-cell>
                    <s-table-cell>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={p.id} />
                        <s-button
                          type="submit"
                          variant="tertiary"
                          tone="critical"
                          icon="delete"
                          accessibilityLabel={`Delete ${p.pincode}`}
                        />
                      </Form>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>

            {/* naya: kitne dikh rahe hain, ya search mein kuch na mila */}
            <s-box padding="base">
              {total === 0 ? (
                <s-paragraph>No postal codes match your search.</s-paragraph>
              ) : (
                <s-text color="subdued">
                  Showing {from}–{to} of {total}
                </s-text>
              )}
            </s-box>
          </>
        )}
      </s-section>
    </s-page>
  );
}