import { useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import {
  useActionData,
  useFetcher,
  useLoaderData,
  useNavigate,
  useNavigation,
  useSubmit,
} from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import mongoose from "mongoose";
import { authenticate } from "../shopify.server";
import { connectDB } from "../mongo.server";
import { Zone, findDeliveryRule } from "../models/zone.server";
import { countryAllowed, getShopPlan } from "../limits.server";
import {
  isValidPostcode,
  normalizeCountry,
  normalizePostcode,
  parsePrefixes,
} from "../utils/postcode";

const COUNTRIES = [
  { code: "IN", name: "🇮🇳 India" },
  { code: "US", name: "🇺🇸 United States" },
  { code: "GB", name: "🇬🇧 United Kingdom" },
  { code: "CA", name: "🇨🇦 Canada" },
  { code: "AU", name: "🇦🇺 Australia" },
  { code: "DE", name: "🇩🇪 Germany" },
  { code: "FR", name: "🇫🇷 France" },
  { code: "NL", name: "🇳🇱 Netherlands" },
  { code: "JP", name: "🇯🇵 Japan" },
];
const CODE_LENGTH: Record<string, number> = { IN: 6, US: 5 };

type ZoneRow = {
  id: string;
  name: string;
  country: string;
  prefixes: string[];
  minDays: number;
  maxDays: number;
  codAvailable: boolean;
  active: boolean;
};

// ---------- LOADER ----------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const docs: any[] = await Zone.find({ shop: session.shop })
    .sort({ country: 1, name: 1 })
    .lean();

  const zones: ZoneRow[] = docs.map((z) => ({
    id: String(z._id),
    name: z.name,
    country: z.country,
    prefixes: z.prefixes || [],
    minDays: z.minDays,
    maxDays: z.maxDays,
    codAvailable: z.codAvailable,
    active: z.active !== false,
  }));
  const plan = await getShopPlan(session.shop);
  return { zones, zoneLimit: plan.limits.zones, planName: plan.name };
};

// ---------- ACTION ----------
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  await connectDB();

  const form = await request.formData();
  const intent = String(form.get("intent") || "");
  const fail = (message: string) => ({ intent, ok: false, message });

  // 🔍 Tester
  if (intent === "test") {
    const country = normalizeCountry(form.get("country") as string);
    const pincode = normalizePostcode(form.get("pincode") as string, country);
    if (!isValidPostcode(pincode, country)) return fail("Enter a valid postal code");
    const rule = await findDeliveryRule(shop, country, pincode);
    return { intent, ok: true, message: "", pincode, country, rule };
  }

  const id = String(form.get("id") || "");
  if (id && !mongoose.isValidObjectId(id)) return fail("Zone not found");

  if (intent === "delete") {
    await Zone.deleteOne({ _id: id, shop });
    return { intent, ok: true, message: "Zone deleted" };
  }

  if (intent === "toggle") {
    const z = await Zone.findOne({ _id: id, shop });
    if (!z) return fail("Zone not found");
    z.active = !z.active;
    await z.save();
    return { intent, ok: true, message: z.active ? "Zone activated" : "Zone paused" };
  }

  if (intent === "save") {
    const name = String(form.get("name") || "").trim().slice(0, 60);
    const country = normalizeCountry(form.get("country") as string);
    const { prefixes, invalid } = parsePrefixes(String(form.get("prefixes") || ""));
    const minDays = Number(form.get("minDays"));
    const maxDays = Number(form.get("maxDays"));
    const codAvailable = form.get("codAvailable") === "true";
    const active = form.get("active") === "true";

    if (!name) return fail("Zone name is required");
    if (invalid.length) return fail(`Invalid prefix: ${invalid.join(", ")}`);
    if (!prefixes.length) return fail("Add at least one prefix");
    if (prefixes.length > 500) return fail("Maximum 500 prefixes per zone");
    if (!Number.isInteger(minDays) || minDays < 0 || minDays > 60)
      return fail("Min days must be between 0 and 60");
    if (!Number.isInteger(maxDays) || maxDays < minDays || maxDays > 90)
      return fail("Max days must be at least min days (up to 90)");

    // 🔒 Plan limits
    const plan = await getShopPlan(shop);
    if (!id && plan.limits.zones !== null) {
      const count = await Zone.countDocuments({ shop });
      if (count >= plan.limits.zones)
        return fail(
          `The ${plan.name} plan includes ${plan.limits.zones} zones. Upgrade to Pro for unlimited zones.`,
        );
    }
    if (!(await countryAllowed(shop, country, plan)))
      return fail(`The ${plan.name} plan supports 1 country. Upgrade to Pro to add more countries.`);

    // Ek prefix do zones mein nahi ho sakta
    const clash: any = await Zone.findOne({
      shop,
      country,
      prefixes: { $in: prefixes },
      ...(id ? { _id: { $ne: id } } : {}),
    }).lean();
    if (clash) {
      const p = prefixes.find((x) => clash.prefixes.includes(x));
      return fail(`Prefix ${p} is already used in zone "${clash.name}"`);
    }

    const data = { name, country, prefixes, minDays, maxDays, codAvailable, active };
    if (id) await Zone.updateOne({ _id: id, shop }, { $set: data });
    else await Zone.create({ shop, ...data });
    return { intent, ok: true, message: id ? "Zone updated" : "Zone created" };
  }

  return fail("Unknown action");
};

// ---------- UI ----------
const EMPTY = {
  id: "",
  name: "",
  country: "IN",
  prefixes: "",
  minDays: "2",
  maxDays: "4",
  codAvailable: true,
  active: true,
};
type FormState = typeof EMPTY;

const TEMPLATES: { label: string; form: Partial<FormState> }[] = [
  { label: "🏙️ My city", form: { name: "Indore city", prefixes: "4520", minDays: "1", maxDays: "2" } },
  { label: "🗺️ My state", form: { name: "Madhya Pradesh", prefixes: "45, 46, 47, 48", minDays: "2", maxDays: "4" } },
  { label: "🌏 Rest of India", form: { name: "Rest of India", prefixes: "*", minDays: "4", maxDays: "7", codAvailable: false } },
];

function coverage(p: string, country: string) {
  if (p === "*") return "all other postal codes";
  const len = CODE_LENGTH[country];
  if (len && /^\d+$/.test(p) && p.length < len) {
    const pad = len - p.length;
    return `${p}${"0".repeat(pad)} – ${p}${"9".repeat(pad)}`;
  }
  return `codes starting with ${p}`;
}

const flag = (code: string) => COUNTRIES.find((c) => c.code === code)?.name ?? code;

export default function ZonesPage() {
  const { zones, zoneLimit, planName } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const atLimit = zoneLimit !== null && zones.length >= zoneLimit;
  const actionData = useActionData() as any;
  const submit = useSubmit();
  const nav = useNavigation();
  const shopify = useAppBridge();
  const tester = useFetcher();

  const editRef = useRef<any>(null);
  const delRef = useRef<any>(null);

  const [form, setForm] = useState<FormState>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ZoneRow | null>(null);
  const [test, setTest] = useState({ country: "IN", pincode: "" });

  const savingIntent = nav.state !== "idle" ? nav.formData?.get("intent") : null;

  useEffect(() => {
    if (!actionData || actionData.intent === "test") return;
    if (actionData.ok) {
      shopify.toast.show(actionData.message);
      setFormError(null);
      if (actionData.intent === "save") editRef.current?.hideOverlay?.();
      if (actionData.intent === "delete") delRef.current?.hideOverlay?.();
    } else if (actionData.intent === "save") {
      setFormError(actionData.message);
    } else {
      shopify.toast.show(actionData.message, { isError: true });
    }
  }, [actionData]);

  const set = (key: keyof FormState, value: any) => setForm((f) => ({ ...f, [key]: value }));

  const openForm = (values: Partial<FormState>) => {
    setFormError(null);
    setForm({ ...EMPTY, ...values });
    editRef.current?.showOverlay?.();
  };

  const openEdit = (z: ZoneRow) =>
    openForm({
      id: z.id,
      name: z.name,
      country: z.country,
      prefixes: z.prefixes.join(", "),
      minDays: String(z.minDays),
      maxDays: String(z.maxDays),
      codAvailable: z.codAvailable,
      active: z.active,
    });

  const save = () => {
    const fd = new FormData();
    fd.set("intent", "save");
    fd.set("id", form.id);
    fd.set("name", form.name);
    fd.set("country", form.country);
    fd.set("prefixes", form.prefixes);
    fd.set("minDays", form.minDays);
    fd.set("maxDays", form.maxDays);
    fd.set("codAvailable", String(form.codAvailable));
    fd.set("active", String(form.active));
    submit(fd, { method: "post" });
  };

  const simple = (intent: string, id: string) => {
    const fd = new FormData();
    fd.set("intent", intent);
    fd.set("id", id);
    submit(fd, { method: "post" });
  };

  const runTest = () => {
    const fd = new FormData();
    fd.set("intent", "test");
    fd.set("country", test.country);
    fd.set("pincode", test.pincode);
    tester.submit(fd, { method: "post" });
  };

  const parsed = parsePrefixes(form.prefixes);
  const t = tester.data as any;

  return (
    <s-page heading="Delivery zones">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={() => (atLimit ? navigate("/app/pricing") : openForm({}))}
      >
        {atLimit ? "⭐ Upgrade for more zones" : "Add zone"}
      </s-button>

      <s-banner tone="info" heading="Cover thousands of postal codes with one rule">
        A prefix covers every postal code that starts with it. For example, 4520 covers
        452000–452099. A code added on the Pincodes page always comes first. If none is
        found, the longest matching prefix is used. Use * for the rest of the country.
      </s-banner>

      {/* 🔒 Plan limit */}
      {atLimit && (
        <s-banner
          tone="warning"
          heading={`You've used ${zones.length} of ${zoneLimit} zones on the ${planName} plan`}
        >
          Upgrade to Pro for unlimited zones, postcodes and countries.
          <s-button slot="secondary-actions" onClick={() => navigate("/app/pricing")}>
            See plans
          </s-button>
        </s-banner>
      )}

      {zones.length === 0 ? (
        <s-section heading="🗺️ Create your first zone">
          <s-stack gap="base">
            <s-paragraph>
              Start from a template and change it to fit your store. You can edit everything later.
            </s-paragraph>
            <s-stack direction="inline" gap="small-200">
              {TEMPLATES.map((tpl) => (
                <s-button key={tpl.label} onClick={() => openForm(tpl.form)}>
                  {tpl.label}
                </s-button>
              ))}
              <s-button variant="tertiary" onClick={() => openForm({})}>
                Start from scratch
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      ) : (
        <s-section padding="none">
          <s-table>
            <s-table-header-row>
              <s-table-header>Zone</s-table-header>
              <s-table-header>Prefixes</s-table-header>
              <s-table-header>Delivery</s-table-header>
              <s-table-header>COD</s-table-header>
              <s-table-header>Status</s-table-header>
              <s-table-header>Actions</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {zones.map((z) => (
                <s-table-row key={z.id}>
                  <s-table-cell>
                    <s-stack gap="none">
                      <s-text type="strong">{z.name}</s-text>
                      <s-text color="subdued">{flag(z.country)}</s-text>
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-300">
                      {z.prefixes.slice(0, 6).map((p) => (
                        <s-badge key={p}>{p === "*" ? "* rest" : p}</s-badge>
                      ))}
                      {z.prefixes.length > 6 && (
                        <s-text color="subdued">+{z.prefixes.length - 6} more</s-text>
                      )}
                    </s-stack>
                  </s-table-cell>
                  <s-table-cell>
                    {z.minDays}–{z.maxDays} days
                  </s-table-cell>
                  <s-table-cell>
                    {z.codAvailable ? (
                      <s-badge tone="success">COD</s-badge>
                    ) : (
                      <s-badge>Prepaid only</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    {z.active ? (
                      <s-badge tone="success">Active</s-badge>
                    ) : (
                      <s-badge tone="warning">Paused</s-badge>
                    )}
                  </s-table-cell>
                  <s-table-cell>
                    <s-stack direction="inline" gap="small-200">
                      <s-button variant="tertiary" onClick={() => openEdit(z)}>
                        Edit
                      </s-button>
                      <s-button variant="tertiary" onClick={() => simple("toggle", z.id)}>
                        {z.active ? "Pause" : "Activate"}
                      </s-button>
                      <s-button
                        variant="tertiary"
                        tone="critical"
                        onClick={() => {
                          setToDelete(z);
                          delRef.current?.showOverlay?.();
                        }}
                      >
                        Delete
                      </s-button>
                    </s-stack>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      {/* 🔍 Tester */}
      <s-section slot="aside" heading="🔍 Test a postal code">
        <s-stack gap="base">
          <s-paragraph color="subdued">See which rule a customer's code will use.</s-paragraph>
          <s-select
            label="Country"
            value={test.country}
            onChange={(e: any) => {
              const v = e.currentTarget.value;
              setTest((s) => ({ ...s, country: v }));
            }}
          >
            {COUNTRIES.map((c) => (
              <s-option key={c.code} value={c.code}>
                {c.name}
              </s-option>
            ))}
          </s-select>
          <s-text-field
            label="Postal code"
            placeholder="452001"
            value={test.pincode}
            onInput={(e: any) => {
              const v = e.currentTarget.value;
              setTest((s) => ({ ...s, pincode: v }));
            }}
          />
          <s-button
            variant="primary"
            loading={tester.state !== "idle"}
            disabled={!test.pincode.trim()}
            onClick={runTest}
          >
            Test
          </s-button>

          {t && !t.ok && <s-banner tone="critical">{t.message}</s-banner>}
          {t?.ok && !t.rule && (
            <s-banner tone="warning" heading={`🚫 No rule for ${t.pincode}`}>
              Customers will see your "not available" message. Add a zone or use * for the rest of the country.
            </s-banner>
          )}
          {t?.ok && t.rule && (
            <s-banner
              tone="success"
              heading={
                t.rule.source === "pincode"
                  ? `📮 Exact match: ${t.pincode}`
                  : `🗺️ Zone: ${t.rule.zoneName}`
              }
            >
              {t.rule.source === "zone" && <>Matched prefix {t.rule.prefix === "*" ? "* (rest)" : t.rule.prefix} · </>}
              {t.rule.minDays}–{t.rule.maxDays} days ·{" "}
              {t.rule.codAvailable ? "COD available" : "Prepaid only"}
            </s-banner>
          )}
        </s-stack>
      </s-section>

      {/* ➕ Add / Edit modal */}
      <s-modal id="zone-modal" ref={editRef} heading={form.id ? "Edit zone" : "Add zone"}>
        <s-stack gap="base">
          {formError && <s-banner tone="critical">{formError}</s-banner>}

          <s-text-field
            label="Zone name"
            placeholder="e.g. Indore city"
            value={form.name}
            maxLength={60}
            onInput={(e: any) => {
              const v = e.currentTarget.value;
              set("name", v);
            }}
          />

          <s-select
            label="Country"
            value={form.country}
            onChange={(e: any) => {
              const v = e.currentTarget.value;
              set("country", v);
            }}
          >
            {COUNTRIES.map((c) => (
              <s-option key={c.code} value={c.code}>
                {c.name}
              </s-option>
            ))}
          </s-select>

          <s-text-area
            label="Postal code prefixes"
            placeholder="4520, 4521, 4522"
            details="Separate with commas or new lines. Use * for all other codes in this country."
            rows={3}
            value={form.prefixes}
            onInput={(e: any) => {
              const v = e.currentTarget.value;
              set("prefixes", v);
            }}
          />

          {parsed.prefixes.length > 0 && (
            <s-box padding="base" background="subdued" borderRadius="base">
              <s-stack gap="small-200">
                <s-text type="strong">
                  Covers {parsed.prefixes.length} prefix{parsed.prefixes.length > 1 ? "es" : ""}
                </s-text>
                {parsed.prefixes.slice(0, 5).map((p) => (
                  <s-text key={p} color="subdued">
                    {p} → {coverage(p, form.country)}
                  </s-text>
                ))}
                {parsed.prefixes.length > 5 && (
                  <s-text color="subdued">…and {parsed.prefixes.length - 5} more</s-text>
                )}
              </s-stack>
            </s-box>
          )}
          {parsed.invalid.length > 0 && (
            <s-banner tone="warning">Ignored invalid: {parsed.invalid.join(", ")}</s-banner>
          )}

          <s-grid gridTemplateColumns="1fr 1fr" gap="base">
            <s-number-field
              label="Min days"
              min={0}
              max={60}
              value={form.minDays}
              onInput={(e: any) => {
                const v = e.currentTarget.value;
                set("minDays", v);
              }}
            />
            <s-number-field
              label="Max days"
              min={0}
              max={90}
              value={form.maxDays}
              onInput={(e: any) => {
                const v = e.currentTarget.value;
                set("maxDays", v);
              }}
            />
          </s-grid>

          <s-checkbox
            label="Cash on Delivery available"
            checked={form.codAvailable}
            onChange={(e: any) => {
              const v = e.currentTarget.checked;
              set("codAvailable", v);
            }}
          />
          <s-checkbox
            label="Active"
            details="Paused zones are skipped on the storefront."
            checked={form.active}
            onChange={(e: any) => {
              const v = e.currentTarget.checked;
              set("active", v);
            }}
          />
        </s-stack>

        <s-button
          slot="primary-action"
          variant="primary"
          loading={savingIntent === "save"}
          onClick={save}
        >
          {form.id ? "Save zone" : "Create zone"}
        </s-button>
        <s-button slot="secondary-actions" commandFor="zone-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>

      {/* 🗑️ Delete modal */}
      <s-modal id="zone-delete-modal" ref={delRef} heading="Delete zone?">
        <s-paragraph>
          "{toDelete?.name}" will be removed. Postal codes in this zone will use the next
          matching rule, or show your "not available" message.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={savingIntent === "delete"}
          onClick={() => toDelete && simple("delete", toDelete.id)}
        >
          Delete
        </s-button>
        <s-button slot="secondary-actions" commandFor="zone-delete-modal" command="--hide">
          Cancel
        </s-button>
      </s-modal>
    </s-page>
  );
}