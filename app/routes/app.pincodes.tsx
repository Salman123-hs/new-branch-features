import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSearchParams, useSubmit } from "react-router";
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

type CsvRow = { country: string; pincode: string; minDays: number; maxDays: number; codAvailable: boolean };

const MAX_ROWS = 50000;
const PAGE_SIZE = 50;

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
    rows.push({ country, pincode: pin, minDays, maxDays, codAvailable: !["no", "false", "0", "n"].includes(codText) });
  });

  return { rows, errors };
}

const CSV_EXAMPLE = `pincode,min_days,max_days,cod,country
452001,2,4,yes,IN
110001,3,5,yes,IN
SW1A 1AA,5,8,no,GB
90210,4,7,no,US`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const shop = session.shop;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const countryParam = (url.searchParams.get("country") || "").toUpperCase();
  const country = /^[A-Z]{2}$/.test(countryParam) ? countryParam : "";
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page"))) || 1);

  const filter: any = { shop };
  if (country) filter.country = country;
  if (q) filter.pincode = { $regex: `^${q}` };

  // naya: poore store ka hisaab (tabs aur summary cards ke liye), desh ke hisaab se
  const [total, docs, groups] = await Promise.all([
    Pincode.countDocuments(filter),
    Pincode.find(filter)
      .sort({ country: 1, pincode: 1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Pincode.aggregate([
      { $match: { shop } },
      {
        $group: {
          _id: "$country",
          count: { $sum: 1 },
          cod: { $sum: { $cond: ["$codAvailable", 1, 0] } },
          fastest: { $min: "$minDays" },
        },
      },
      { $sort: { count: -1 } },
    ]),
  ]);

  const allTotal = groups.reduce((sum: number, g: any) => sum + g.count, 0);
  const allCod = groups.reduce((sum: number, g: any) => sum + g.cod, 0);
  const fastest = groups.length ? Math.min(...groups.map((g: any) => g.fastest)) : null;

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
    summary: {
      allTotal,
      countries: groups.map((g: any) => ({ code: String(g._id), count: g.count as number })),
      codPercent: allTotal ? Math.round((allCod / allTotal) * 100) : 0,
      fastest,
    },
  };
};

// Server ka logic pehle jaisa: csv / delete / add-update
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
      message: `${rows.length} postal codes imported` + (errors.length ? `, ${errors.length} rows skipped` : ""),
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
  const codAvailable = form.get("codAvailable") === "true";

  if (!isValidPostcode(pincode, country)) {
    return { ok: false, source: "add", message: `Please enter a valid postal code for ${country}` };
  }
  if (!Number.isInteger(minDays) || !Number.isInteger(maxDays) || minDays < 0) {
    return { ok: false, source: "add", message: "Days must be whole numbers" };
  }
  if (minDays > maxDays) {
    return { ok: false, source: "add", message: "Min days cannot be greater than max days" };
  }

  await Pincode.findOneAndUpdate({ shop: session.shop, country, pincode }, { minDays, maxDays, codAvailable }, { upsert: true });
  return { ok: true, source: "add", message: `${country} ${pincode} saved` };
};

type Row = { id: string; country: string; pincode: string; minDays: number; maxDays: number; codAvailable: boolean };

const EMPTY_FORM = { country: "IN", pincode: "", minDays: "3", maxDays: "5", codAvailable: true };

function StatCard({ icon, label, value }: { icon: string; label: string; value: string | number }) {
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small-200">
        <s-text color="subdued">
          {icon} {label}
        </s-text>
        <span style={{ fontSize: 24, fontWeight: 650, lineHeight: 1.2 }}>{value}</span>
      </s-stack>
    </s-box>
  );
}

export default function PincodesPage() {
  const { pincodes, total, page, q, country, summary } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const [searchParams, setSearchParams] = useSearchParams();

  const busyIntent = nav.state === "submitting" ? String(nav.formData?.get("intent") ?? "add") : null;
  const listLoading = nav.state === "loading";

  // naya: modals
  const editModalRef = useRef<any>(null);
  const importModalRef = useRef<any>(null);
  const deleteModalRef = useRef<any>(null);

  const [form, setForm] = useState(EMPTY_FORM); // add/edit popup ka data
  const [editing, setEditing] = useState(false); // true = purana code edit ho raha hai
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [dropKey, setDropKey] = useState(0); // drop zone reset karne ke liye
  const [exporting, setExporting] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Kaam ho gaya to: toast + jo popup khula hai use band karo
  useEffect(() => {
    if (!result?.ok) return;
    shopify.toast.show(result.message);
    if (result.source === "add") editModalRef.current?.hideOverlay?.();
    if (result.source === "delete") deleteModalRef.current?.hideOverlay?.();
    if (result.source === "csv") {
      importModalRef.current?.hideOverlay?.();
      setCsvFile(null);
      setDropKey((k) => k + 1);
    }
  }, [result, shopify]);

  function updateParams(changes: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  function onSearch(value: string) {
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => updateParams({ q: value.trim(), page: "" }), 400);
  }

  function openAdd() {
    setEditing(false);
    setForm(EMPTY_FORM);
  }

  function openEdit(p: Row) {
    setEditing(true);
    setForm({
      country: p.country,
      pincode: p.pincode,
      minDays: String(p.minDays),
      maxDays: String(p.maxDays),
      codAvailable: p.codAvailable,
    });
  }

  function saveCode() {
    const fd = new FormData();
    fd.append("intent", "add");
    fd.append("country", form.country);
    fd.append("pincode", form.pincode);
    fd.append("minDays", form.minDays);
    fd.append("maxDays", form.maxDays);
    fd.append("codAvailable", form.codAvailable ? "true" : "false");
    submit(fd, { method: "post" });
  }

  function confirmDelete() {
    if (!toDelete) return;
    const fd = new FormData();
    fd.append("intent", "delete");
    fd.append("id", toDelete.id);
    submit(fd, { method: "post" });
  }

  function uploadCsv() {
    if (!csvFile) return;
    const fd = new FormData();
    fd.append("intent", "csv");
    fd.append("file", csvFile);
    submit(fd, { method: "post", encType: "multipart/form-data" });
  }

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

  const addError = result && !result.ok && result.source === "add" ? result.message : null;
  const csvResult = result && result.source === "csv" ? result : null;
  const csvErrors = csvResult && "errors" in csvResult ? csvResult.errors ?? [] : [];

  const hasPreviousPage = page > 1;
  const hasNextPage = page * PAGE_SIZE < total;
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const isEmptyStore = summary.allTotal === 0;

  return (
    <s-page heading="Postal codes">
      {/* ---------- Page header buttons ---------- */}
      <s-button slot="primary-action" variant="primary" commandFor="pc-edit-modal" command="--show" onClick={openAdd}>
        Add postal code
      </s-button>
      <s-button slot="secondary-actions" commandFor="pc-import-modal" command="--show">
        Import CSV
      </s-button>
      <s-button slot="secondary-actions" onClick={exportCsv} loading={exporting} disabled={isEmptyStore}>
        Export CSV
      </s-button>

      {/* CSV mein kuch rows chhoot gayi hon to page par dikhao */}
      {csvResult?.ok && csvErrors.length > 0 && (
        <s-banner tone="warning" heading="Some rows were skipped">
          <s-unordered-list>
            {csvErrors.map((err) => (
              <s-list-item key={err}>{err}</s-list-item>
            ))}
          </s-unordered-list>
        </s-banner>
      )}

      {isEmptyStore ? (
        /* ---------- Empty state ---------- */
        <s-section>
          <s-stack direction="block" gap="base" alignItems="center">
            <span style={{ fontSize: 56, lineHeight: 1 }}>📮</span>
            <s-heading>Add your first delivery area</s-heading>
            <s-paragraph>
              Tell us where you deliver, how many days it takes and whether Cash on Delivery is available. Add codes
              one by one, or import thousands from a CSV file.
            </s-paragraph>
            <s-stack direction="inline" gap="base">
              <s-button variant="primary" commandFor="pc-edit-modal" command="--show" onClick={openAdd}>
                Add postal code
              </s-button>
              <s-button commandFor="pc-import-modal" command="--show">
                Import CSV
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ) : (
        <>
          {/* ---------- Summary ---------- */}
          <s-section>
            <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
              <StatCard icon="📮" label="Postal codes" value={summary.allTotal.toLocaleString("en-IN")} />
              <StatCard icon="🌍" label="Countries" value={summary.countries.length} />
              <StatCard icon="💵" label="COD available" value={`${summary.codPercent}%`} />
              <StatCard
                icon="⚡"
                label="Fastest delivery"
                value={summary.fastest === null ? "–" : `${summary.fastest} ${summary.fastest === 1 ? "day" : "days"}`}
              />
            </s-grid>
          </s-section>

          {/* ---------- List ---------- */}
          <s-section padding="none">
            {/* country tabs */}
            <s-box padding="base">
              <s-stack direction="inline" gap="small">
                <s-button
                  variant={country ? "tertiary" : "secondary"}
                  onClick={() => updateParams({ country: "", page: "" })}
                >
                  All {summary.allTotal}
                </s-button>
                {summary.countries.map((c) => (
                  <s-button
                    key={c.code}
                    variant={country === c.code ? "secondary" : "tertiary"}
                    onClick={() => updateParams({ country: c.code, page: "" })}
                  >
                    {flag(c.code)} {COUNTRY_NAME[c.code] ?? c.code} {c.count}
                  </s-button>
                ))}
              </s-stack>
            </s-box>

            <s-table
              paginate
              hasPreviousPage={hasPreviousPage}
              hasNextPage={hasNextPage}
              loading={listLoading}
              onPreviousPage={() => updateParams({ page: String(page - 1) })}
              onNextPage={() => updateParams({ page: String(page + 1) })}
            >
              <s-search-field
                slot="filters"
                label="Search postal codes"
                labelAccessibilityVisibility="exclusive"
                placeholder="Search postal codes"
                defaultValue={q}
                onInput={(e: any) => onSearch(e.currentTarget.value)}
              />

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
                      {p.codAvailable ? <s-badge tone="success">COD</s-badge> : <s-badge>No COD</s-badge>}
                    </s-table-cell>
                    <s-table-cell>
                      <s-stack direction="inline" gap="small-200">
                        <s-button
                          variant="tertiary"
                          icon="edit"
                          accessibilityLabel={`Edit ${p.pincode}`}
                          commandFor="pc-edit-modal"
                          command="--show"
                          onClick={() => openEdit(p)}
                        />
                        <s-button
                          variant="tertiary"
                          tone="critical"
                          icon="delete"
                          accessibilityLabel={`Delete ${p.pincode}`}
                          commandFor="pc-delete-modal"
                          command="--show"
                          onClick={() => setToDelete(p)}
                        />
                      </s-stack>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>

            <s-box padding="base">
              {total === 0 ? (
                <s-paragraph>No postal codes match your search.</s-paragraph>
              ) : (
                <s-text color="subdued">
                  Showing {from}–{to} of {total}
                </s-text>
              )}
            </s-box>
          </s-section>
        </>
      )}

            {/* ---------- Modal: add / edit ---------- */}
      <s-modal id="pc-edit-modal" ref={editModalRef} heading={editing ? `Edit ${form.pincode}` : "Add postal code"}>
        <s-stack direction="block" gap="base">
          {addError && <s-banner tone="critical">{addError}</s-banner>}

          {editing ? (
            <s-text color="subdued">
              {flag(form.country)} {COUNTRY_NAME[form.country] ?? form.country} · {form.pincode}
            </s-text>
          ) : (
            <s-grid gridTemplateColumns="1fr 1fr" gap="base">
              <s-select
                label="Country"
                value={form.country}
                onChange={(e: any) => {
                  const v = e.currentTarget.value; // value pehle nikaal lo
                  setForm((f) => ({ ...f, country: v }));
                }}
              >
                {COUNTRIES.map(([code, name]) => (
                  <s-option key={code} value={code}>
                    {flag(code)} {name}
                  </s-option>
                ))}
              </s-select>
              <s-text-field
                label="Postal code"
                placeholder="452001 / SW1A 1AA"
                maxLength={10}
                value={form.pincode}
                onInput={(e: any) => {
                  const v = e.currentTarget.value;
                  setForm((f) => ({ ...f, pincode: v }));
                }}
              />
            </s-grid>
          )}

          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-number-field
              label="Min days"
              min={0}
              value={form.minDays}
              onInput={(e: any) => {
                const v = e.currentTarget.value;
                setForm((f) => ({ ...f, minDays: v }));
              }}
            />
            <s-number-field
              label="Max days"
              min={0}
              value={form.maxDays}
              onInput={(e: any) => {
                const v = e.currentTarget.value;
                setForm((f) => ({ ...f, maxDays: v }));
              }}
            />
          </s-grid>

          <s-checkbox
            label="Cash on Delivery available"
            checked={form.codAvailable}
            onChange={(e: any) => {
              const v = e.currentTarget.checked;
              setForm((f) => ({ ...f, codAvailable: v }));
            }}
          />
        </s-stack>

        <s-button slot="secondary-actions" commandFor="pc-edit-modal" command="--hide">
          Cancel
        </s-button>
        <s-button slot="primary-action" variant="primary" loading={busyIntent === "add"} onClick={saveCode}>
          {editing ? "Save changes" : "Add postal code"}
        </s-button>
      </s-modal>

      {/* ---------- Modal: import CSV ---------- */}
      <s-modal id="pc-import-modal" ref={importModalRef} heading="Import postal codes">
        <s-stack direction="block" gap="base">
          <s-paragraph>
            Columns: <s-text type="strong">pincode, min_days, max_days, cod, country</s-text>. Country is optional
            (default IN). Existing codes are updated, not duplicated.
          </s-paragraph>
          <s-box padding="base" background="subdued" borderRadius="base">
            <pre style={{ margin: 0, fontSize: 13 }}>{CSV_EXAMPLE}</pre>
          </s-box>
          <s-drop-zone
            key={dropKey}
            label="CSV file"
            accept=".csv,text/csv"
            onChange={(e: any) => setCsvFile(e.currentTarget.files?.[0] ?? null)}
          />
          {csvFile && <s-text color="subdued">Selected: {csvFile.name}</s-text>}
          {csvResult && !csvResult.ok && <s-banner tone="critical">{csvResult.message}</s-banner>}
        </s-stack>

        <s-button slot="secondary-actions" commandFor="pc-import-modal" command="--hide">
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          disabled={!csvFile}
          loading={busyIntent === "csv"}
          onClick={uploadCsv}
        >
          Import
        </s-button>
      </s-modal>

      {/* ---------- Modal: delete confirm ---------- */}
      <s-modal id="pc-delete-modal" ref={deleteModalRef} heading="Delete postal code?">
        <s-paragraph>
          {toDelete
            ? `${flag(toDelete.country)} ${toDelete.pincode} will be removed. Customers in this area will see “not deliverable”.`
            : ""}
        </s-paragraph>
        <s-button slot="secondary-actions" commandFor="pc-delete-modal" command="--hide">
          Cancel
        </s-button>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={busyIntent === "delete"}
          onClick={confirmDelete}
        >
          Delete
        </s-button>
      </s-modal>
    </s-page>
  );
}