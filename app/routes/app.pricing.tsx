import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../mongo.server";
import { Pincode } from "../models/pincode.server";
import { Zone } from "../models/zone.server";
import {
  IS_TEST,
  ShopPlan,
  createSubscription,
  getCurrentPlan,
  getTrialDaysLeft,
} from "../billing.server";
import {
  PLANS,
  PLAN_ORDER,
  TRIAL_DAYS,
  fmtLimit,
  type Interval,
  type Plan,
  type PlanKey,
} from "../utils/plans";

// ---------- LOADER ----------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { billing, session } = await authenticate.admin(request);
  const shop = session.shop;
  const current = await getCurrentPlan(billing, shop);

  await connectDB();
  const [pincodes, zones] = await Promise.all([
    Pincode.countDocuments({ shop }),
    Zone.countDocuments({ shop }),
  ]);

  // Trial sirf ek baar: bache hue din
  const trialDaysLeft = await getTrialDaysLeft(shop);

  return { current, isTest: IS_TEST, usage: { pincodes, zones }, trialDaysLeft };
};

// ---------- ACTION ----------
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const form = await request.formData();
  const intent = String(form.get("intent") || "");

  if (intent === "subscribe") {
    const key = String(form.get("plan")) as PlanKey;
    const interval: Interval = form.get("interval") === "yearly" ? "yearly" : "monthly";
    if (key !== "pro" && key !== "plus") return { ok: false, message: "Unknown plan" };

    const result = await createSubscription(admin, session.shop, key, interval);
    if (result.error) return { ok: false, message: result.error };
    return { ok: true, intent: "subscribe", confirmationUrl: result.confirmationUrl };
  }

  if (intent === "cancel") {
    const current = await getCurrentPlan(billing, session.shop);
    if (!current.subscriptionId) return { ok: false, message: "You are already on the Free plan" };
    await billing.cancel({
      subscriptionId: current.subscriptionId,
      isTest: IS_TEST,
      prorate: true,
    });
    await ShopPlan.updateOne(
      { shop: session.shop },
      { $set: { plan: "free", interval: "monthly", subscriptionId: null } },
    );
    return { ok: true, message: "Switched to the Free plan" };
  }

  return { ok: false, message: "Unknown action" };
};

// ---------- STYLES ----------
const ACCENT = "#005bd3";
const GREEN = "#008060";

const cardStyle = (popular: boolean, current: boolean): CSSProperties => ({
  position: "relative",
  display: "flex",
  flexDirection: "column",
  gap: 16,
  height: "100%",
  boxSizing: "border-box",
  background: "#fff",
  borderRadius: 16,
  padding: "28px 22px 22px",
  border: popular ? `2px solid ${ACCENT}` : current ? `2px solid ${GREEN}` : "1px solid #e3e3e3",
  boxShadow: popular ? "0 10px 30px rgba(0, 91, 211, 0.15)" : "0 1px 3px rgba(0,0,0,0.06)",
});

const ribbonStyle = (bg: string): CSSProperties => ({
  position: "absolute",
  top: -13,
  left: "50%",
  transform: "translateX(-50%)",
  background: bg,
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  padding: "4px 12px",
  borderRadius: 999,
  whiteSpace: "nowrap",
});

// ---------- SMALL COMPONENTS ----------
function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const unlimited = limit === null;
  const pct = unlimited ? 100 : Math.min(100, Math.round((used / Math.max(limit, 1)) * 100));
  const color = unlimited ? GREEN : pct >= 100 ? "#c0392b" : pct >= 80 ? "#b25e09" : GREEN;
  return (
    <s-stack gap="small-100">
      <s-stack direction="inline" justifyContent="space-between">
        <s-text>{label}</s-text>
        <s-text color="subdued">
          {used.toLocaleString("en-US")} / {fmtLimit(limit)}
        </s-text>
      </s-stack>
      <div style={{ height: 8, background: "#ebebeb", borderRadius: 999, overflow: "hidden" }}>
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            opacity: unlimited ? 0.35 : 1,
            borderRadius: 999,
            transition: "width .4s ease",
          }}
        />
      </div>
    </s-stack>
  );
}

function Check({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 14, lineHeight: "20px" }}>
      <span style={{ color: GREEN, fontWeight: 700 }}>✓</span>
      <span>{children}</span>
    </div>
  );
}

// ---------- COMPARE TABLE ROWS ----------
type Row = { label: string; value: (p: Plan) => string | boolean };
const ROWS: Row[] = [
  { label: "Postcodes / pincodes", value: (p) => fmtLimit(p.limits.pincodes) },
  { label: "Delivery zones", value: (p) => fmtLimit(p.limits.zones) },
  { label: "Checks per month", value: (p) => fmtLimit(p.limits.checks) },
  { label: "Countries", value: (p) => fmtLimit(p.limits.countries) },
  { label: "Delivery dates & COD", value: () => true },
  { label: "Holidays, cut-off & working days", value: () => true },
  { label: "Live cut-off countdown", value: (p) => p.features.countdown },
  { label: "CSV export", value: (p) => p.features.export },
  { label: "Widget design options", value: (p) => p.features.design },
  { label: 'Remove "Powered by" badge', value: (p) => p.features.removeBadge },
  { label: "Analytics", value: (p) => p.features.analytics || false },
  { label: "Priority support", value: (p) => p.features.prioritySupport },
];

const FAQ = [
  {
    q: "Is the trial really free?",
    a: `Yes. You pay nothing for ${TRIAL_DAYS} days. Cancel before the trial ends and you won't be charged.`,
  },
  { q: "How do I pay?", a: "Charges appear on your regular Shopify bill. No separate card needed." },
  {
    q: "Can I switch plans anytime?",
    a: "Yes. Upgrade, downgrade or switch between monthly and yearly whenever you like.",
  },
  { q: "What counts as a check?", a: "Each time a shopper checks a postal code on your store." },
  {
    q: "What happens if I downgrade?",
    a: "Your postal codes and zones are kept. Free plan limits apply again.",
  },
];

// ---------- PAGE ----------
export default function PricingPage() {
  const { current, isTest, usage, trialDaysLeft } = useLoaderData<typeof loader>();
  const actionData = useActionData() as any;
  const submit = useSubmit();
  const nav = useNavigation();
  const shopify = useAppBridge();
  const cancelRef = useRef<any>(null);

  const [interval, setInterval] = useState<Interval>(
    current.key === "free" ? "monthly" : current.interval,
  );

  const pendingPlan = nav.state !== "idle" ? nav.formData?.get("plan") : null;
  const cancelling = nav.state !== "idle" && nav.formData?.get("intent") === "cancel";

  useEffect(() => {
    if (!actionData) return;
    // Shopify ke approve page pe bhejo (iframe ke bahar)
    if (actionData.confirmationUrl) {
      window.open(actionData.confirmationUrl, "_top");
      return;
    }
    shopify.toast.show(actionData.message, { isError: !actionData.ok });
    if (actionData.ok) cancelRef.current?.hideOverlay?.();
  }, [actionData]);

  const subscribe = (key: PlanKey) => {
    const fd = new FormData();
    fd.set("intent", "subscribe");
    fd.set("plan", key);
    fd.set("interval", interval);
    submit(fd, { method: "post" });
  };

  const cancel = () => {
    const fd = new FormData();
    fd.set("intent", "cancel");
    submit(fd, { method: "post" });
  };

  const currentPlan = PLANS[current.key];
  const rank = (k: PlanKey) => PLAN_ORDER.indexOf(k);

  const buttonFor = (k: PlanKey) => {
    const p = PLANS[k];
    if (k === "free") {
      return current.key === "free" ? (
        <s-button disabled>Your current plan</s-button>
      ) : (
        <s-button onClick={() => cancelRef.current?.showOverlay?.()}>Switch to Free</s-button>
      );
    }
    if (current.key === k && current.interval === interval) {
      return <s-button disabled>Your current plan</s-button>;
    }
    let label: string;
    if (current.key === "free")
      label = trialDaysLeft > 0 ? `Start ${trialDaysLeft}-day free trial` : `Upgrade to ${p.name}`;
    else if (current.key === k)
      label = interval === "yearly" ? "Switch to yearly billing" : "Switch to monthly billing";
    else if (rank(k) > rank(current.key)) label = `Upgrade to ${p.name}`;
    else label = `Switch to ${p.name}`;

    return (
      <s-button
        variant={k === "pro" ? "primary" : "secondary"}
        loading={pendingPlan === k}
        onClick={() => subscribe(k)}
      >
        {label}
      </s-button>
    );
  };

  return (
    <s-page heading="Plans">
      {isTest && (
        <s-banner tone="info" heading="🧪 Test mode">
          Charges are test charges. No real money is taken.
        </s-banner>
      )}

      {/* ---------- HERO ---------- */}
      <s-section>
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(280px, 1fr))" gap="large">
          <s-stack gap="base">
            <s-stack direction="inline" gap="small-200">
              <s-badge tone={current.key === "free" ? "neutral" : "success"}>
                {currentPlan.emoji} You're on {currentPlan.name}
                {current.key !== "free" ? ` · ${current.interval}` : ""}
              </s-badge>
            </s-stack>
            <div style={{ fontSize: 26, fontWeight: 700, lineHeight: "32px" }}>
              Show delivery dates.
              <br />
              <span style={{ color: ACCENT }}>Sell more.</span>
            </div>
            <s-text color="subdued">
              Shoppers who know when their order will arrive buy with confidence. Start free and
              upgrade as your store grows.
            </s-text>
            <s-stack direction="inline" gap="small-200">
              {trialDaysLeft > 0 && <s-badge>✓ {trialDaysLeft}-day free trial</s-badge>}
              <s-badge>✓ Cancel anytime</s-badge>
              <s-badge>✓ Billed by Shopify</s-badge>
            </s-stack>
          </s-stack>

          <s-box padding="base" background="subdued" borderRadius="large">
            <s-stack gap="base">
              <s-text type="strong">📊 Your usage</s-text>
              <UsageBar label="Postcodes" used={usage.pincodes} limit={currentPlan.limits.pincodes} />
              <UsageBar label="Zones" used={usage.zones} limit={currentPlan.limits.zones} />
              {current.key === "free" &&
                (usage.pincodes >= 80 || usage.zones >= (currentPlan.limits.zones ?? Infinity)) && (
                  <s-text color="subdued">
                    You're close to your Free limits. Upgrade to Pro for unlimited.
                  </s-text>
                )}
            </s-stack>
          </s-box>
        </s-grid>
      </s-section>

      {/* ---------- INTERVAL TOGGLE ---------- */}
      <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 20px" }}>
        <div
          style={{
            display: "inline-flex",
            gap: 4,
            padding: 4,
            background: "#ebebeb",
            borderRadius: 999,
            alignItems: "center",
          }}
        >
          {(["monthly", "yearly"] as Interval[]).map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => setInterval(iv)}
              style={{
                border: "none",
                cursor: "pointer",
                padding: "8px 18px",
                borderRadius: 999,
                fontSize: 14,
                fontWeight: 600,
                background: interval === iv ? "#fff" : "transparent",
                color: interval === iv ? "#303030" : "#616161",
                boxShadow: interval === iv ? "0 1px 3px rgba(0,0,0,0.15)" : "none",
              }}
            >
              {iv === "monthly" ? "Monthly" : "Yearly"}
              {iv === "yearly" && (
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 11,
                    background: "#cdfee1",
                    color: "#0c5132",
                    padding: "2px 6px",
                    borderRadius: 999,
                  }}
                >
                  2 months free
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ---------- PLAN CARDS ---------- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 20,
          paddingTop: 14,
          marginBottom: 24,
        }}
      >
        {PLAN_ORDER.map((k) => {
          const p = PLANS[k];
          const popular = k === "pro";
          const isCurrent =
            current.key === k && (k === "free" || current.interval === interval);
          const yearly = interval === "yearly" && p.price > 0;
          const shownPrice = yearly ? p.yearlyPrice / 12 : p.price;

          return (
            <div key={k} style={cardStyle(popular, isCurrent)}>
              {isCurrent ? (
                <div style={ribbonStyle(GREEN)}>✓ Current plan</div>
              ) : popular ? (
                <div style={ribbonStyle(ACCENT)}>⭐ Most popular</div>
              ) : null}

              <div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  {p.emoji} {p.name}
                </div>
                <div style={{ color: "#616161", fontSize: 13, marginTop: 4 }}>{p.tagline}</div>
              </div>

              <div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                  <span style={{ fontSize: 36, fontWeight: 800, letterSpacing: -1 }}>
                    ${shownPrice === 0 ? "0" : shownPrice.toFixed(2)}
                  </span>
                  <span style={{ color: "#616161" }}>/ month</span>
                </div>
                <div style={{ color: "#616161", fontSize: 12, minHeight: 16 }}>
                  {p.price === 0
                    ? "Free forever"
                    : yearly
                      ? `Billed $${p.yearlyPrice.toFixed(2)} yearly · save $${(p.price * 12 - p.yearlyPrice).toFixed(2)}`
                      : `or $${p.yearlyPrice.toFixed(2)}/year (2 months free)`}
                </div>
              </div>

              {buttonFor(k)}

              <div style={{ borderTop: "1px solid #ebebeb", paddingTop: 14 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: "#616161",
                    marginBottom: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.4,
                  }}
                >
                  {p.highlightsTitle}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {p.highlights.map((h) => (
                    <Check key={h}>{h}</Check>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ---------- COMPARE TABLE ---------- */}
      <s-section heading="Compare all features" padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header>Feature</s-table-header>
            {PLAN_ORDER.map((k) => (
              <s-table-header key={k}>
                {PLANS[k].emoji} {PLANS[k].name}
              </s-table-header>
            ))}
          </s-table-header-row>
          <s-table-body>
            {ROWS.map((row) => (
              <s-table-row key={row.label}>
                <s-table-cell>{row.label}</s-table-cell>
                {PLAN_ORDER.map((k) => {
                  const v = row.value(PLANS[k]);
                  return (
                    <s-table-cell key={k}>
                      {v === true ? (
                        <span style={{ color: GREEN, fontWeight: 700 }}>✓</span>
                      ) : v === false ? (
                        <span style={{ color: "#b5b5b5" }}>—</span>
                      ) : (
                        v
                      )}
                    </s-table-cell>
                  );
                })}
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
      </s-section>

      {/* ---------- FAQ ---------- */}
      <s-section heading="❓ Frequently asked questions">
        <s-grid gridTemplateColumns="repeat(auto-fit, minmax(260px, 1fr))" gap="base">
          {FAQ.map((f) => (
            <s-box key={f.q} padding="base" background="subdued" borderRadius="base">
              <s-stack gap="small-100">
                <s-text type="strong">{f.q}</s-text>
                <s-text color="subdued">{f.a}</s-text>
              </s-stack>
            </s-box>
          ))}
        </s-grid>
      </s-section>

      {/* ---------- DOWNGRADE MODAL ---------- */}
      <s-modal id="cancel-plan-modal" ref={cancelRef} heading="Switch to the Free plan?">
        <s-paragraph>
          Your {currentPlan.name} plan will be cancelled right away. Your data is kept, but Free
          plan limits (100 postcodes, 2 zones, no countdown) will apply.
        </s-paragraph>
        <s-button
          slot="primary-action"
          variant="primary"
          tone="critical"
          loading={cancelling}
          onClick={cancel}
        >
          Switch to Free
        </s-button>
        <s-button slot="secondary-actions" commandFor="cancel-plan-modal" command="--hide">
          Keep {currentPlan.name}
        </s-button>
      </s-modal>
    </s-page>
  );
}