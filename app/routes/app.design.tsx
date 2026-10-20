import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigate, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getCurrentPlan } from "../billing.server";
import { getDesign, saveDesign } from "../design.server";
import { PLANS } from "../utils/plans";
import {
  BASE_KEYS,
  DEFAULT_DESIGN,
  FREE_FIELDS,
  PRESETS,
  freeVersion,
  hasProChanges,
  isDarkColor,
  presetDesign,
  sanitizeDesign,
  type BaseKey,
  type BorderStyle,
  type Design,
} from "../utils/design";

// ---------- LOADER ----------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const [current, stored] = await Promise.all([
    getCurrentPlan(billing, session.shop),
    getDesign(admin),
  ]);
  const plan = PLANS[current.key];
  return {
    design: stored.design,
    published: stored.published,
    canFull: plan.features.design, // Pro/Plus = poora control
    planName: plan.name,
  };
};

// ---------- ACTION ----------
export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, billing, session } = await authenticate.admin(request);
  const current = await getCurrentPlan(billing, session.shop);
  const full = PLANS[current.key].features.design;
  const design = sanitizeDesign(await request.json());
  try {
    // Free: basic look store pe, poora design save rehta hai (upgrade pe khud lag jayega)
    await saveDesign(admin, design, full);
  } catch (e: any) {
    return { ok: false, message: e?.message || "Could not save the design" };
  }
  if (!full && hasProChanges(design)) {
    return { ok: true, message: "Published. Pro styling is saved and will apply when you upgrade." };
  }
  return { ok: true, message: "Design published to your store" };
};

// ---------- CONSTANTS ----------
const ACCENT = "#005bd3";

const PRESET_INFO: Record<BaseKey, string> = {
  classic: "Clean & familiar",
  minimal: "Blends into any theme",
  bold: "Stands out on the page",
  soft: "Warm & friendly",
  dark: "Night mode",
};

const QUICK_COLORS = [
  "#000000", "#303030", "#005bd3", "#0a7d32", "#d9480f",
  "#c0392b", "#e36b9b", "#7c3aed", "#ffd166", "#0f766e",
];

const RADIUS_CHIPS: { label: string; value: number }[] = [
  { label: "Sharp", value: 0 },
  { label: "Soft", value: 8 },
  { label: "Round", value: 16 },
  { label: "Pill", value: 24 },
];

const card: CSSProperties = {
  background: "#fff",
  borderRadius: 16,
  border: "1px solid #e3e3e3",
  padding: 20,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
};

const proCard: CSSProperties = {
  ...card,
  border: "1px solid #c9dcff",
  background: "linear-gradient(180deg, #f5f9ff 0%, #ffffff 60%)",
};

// ---------- WIDGET PREVIEW ----------
function WidgetPreview({
  d,
  state,
  compact = false,
}: {
  d: Design;
  state: "available" | "unavailable";
  compact?: boolean;
}) {
  const dark = isDarkColor(d.background);
  const softBorder = dark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)";
  const ctrlRadius = Math.min(d.radius, 24);
  const icon = (e: string) => (d.icons ? e + " " : "");
  const fs = compact ? 11 : 14;

  return (
    <div
      style={{
        background: d.background,
        color: d.text,
        borderRadius: compact ? Math.min(d.radius, 14) : d.radius,
        padding: compact ? 10 : 18,
        border:
          d.border === "none"
            ? "1px solid transparent"
            : d.border === "strong"
              ? `2px solid ${d.accent}`
              : `1px solid ${softBorder}`,
        boxShadow: d.shadow ? (compact ? "0 4px 12px rgba(0,0,0,0.12)" : "0 10px 28px rgba(0,0,0,0.14)") : "none",
        fontSize: fs,
        transition: "all .25s ease",
        textAlign: "left",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: fs + 1, marginBottom: compact ? 6 : 12 }}>Check delivery</div>
      <div style={{ display: "flex", flexDirection: d.layout === "stacked" ? "column" : "row", gap: compact ? 4 : 8 }}>
        <div
          style={{
            flex: 1,
            border: `1px solid ${dark ? "#555" : "#c9c9c9"}`,
            background: dark ? "#2a2a2a" : "#fff",
            color: d.text,
            borderRadius: compact ? Math.min(ctrlRadius, 10) : ctrlRadius,
            padding: compact ? "4px 6px" : "10px 12px",
          }}
        >
          {state === "available" ? "452001" : "999999"}
        </div>
        <div
          style={{
            background: d.accent,
            color: d.buttonText,
            borderRadius: compact ? Math.min(ctrlRadius, 10) : ctrlRadius,
            padding: compact ? "4px 8px" : "10px 18px",
            fontWeight: 700,
            textAlign: "center",
          }}
        >
          Check
        </div>
      </div>

      <div style={{ marginTop: compact ? 6 : 12, display: "flex", flexDirection: "column", gap: compact ? 2 : 6 }}>
        {state === "available" ? (
          <>
            <div style={{ color: d.success }}>
              {icon("🚚")}
              {compact ? "Delivery by Thu, 22 Oct" : "Estimated delivery by Thu, 22 Oct – Sat, 24 Oct"}
            </div>
            {!compact && (
              <>
                <div style={{ color: d.success }}>{icon("💵")}Cash on Delivery available</div>
                <div style={{ color: dark ? "#ffb366" : "#b25e09", fontWeight: 600 }}>
                  {icon("⏰")}Order within 2h 15m to get it by Sat, 24 Oct
                </div>
                <div style={{ color: dark ? "#a0a0a0" : "#8a8a8a", fontSize: 12, marginTop: 4 }}>
                  Delivery dates are estimates and may vary.
                </div>
              </>
            )}
          </>
        ) : (
          <div style={{ color: d.error }}>{icon("🚫")}Sorry, we don't deliver to this pincode yet</div>
        )}
      </div>
    </div>
  );
}

// Product page jaisa mockup, taaki merchant ko asli feel aaye
function ProductMock({ d, state }: { d: Design; state: "available" | "unavailable" }) {
  return (
    <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #ebebeb", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderBottom: "1px solid #f1f1f1", background: "#fafafa" }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: "#ff5f57" }} />
        <span style={{ width: 8, height: 8, borderRadius: 99, background: "#febc2e" }} />
        <span style={{ width: 8, height: 8, borderRadius: 99, background: "#28c840" }} />
        <span style={{ marginLeft: 8, fontSize: 11, color: "#8a8a8a" }}>yourstore.com/products/cotton-tee</span>
      </div>
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div
          style={{
            height: 140,
            borderRadius: 10,
            background: "linear-gradient(135deg, #f3e7ff 0%, #e0ecff 50%, #e6fff4 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 56,
          }}
        >
          👕
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#202020" }}>Classic Cotton Tee</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "#202020" }}>₹799</span>
            <span style={{ fontSize: 12, color: "#8a8a8a", textDecoration: "line-through" }}>₹1,199</span>
            <span style={{ fontSize: 12, color: "#b25e09" }}>★★★★★</span>
          </div>
        </div>
        <WidgetPreview d={d} state={state} />
        <div
          style={{
            border: "1px solid #202020",
            borderRadius: 6,
            padding: "10px 0",
            textAlign: "center",
            fontSize: 14,
            color: "#202020",
          }}
        >
          Add to cart
        </div>
      </div>
    </div>
  );
}

// ---------- SMALL CONTROLS ----------
function ProTag({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span
      style={{
        marginLeft: 8,
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 999,
        background: "linear-gradient(90deg, #005bd3, #7c3aed)",
        color: "#fff",
        verticalAlign: "middle",
      }}
    >
      ⭐ PRO
    </span>
  );
}

function Title({ icon, title, sub, pro = false }: { icon: string; title: string; sub: string; pro?: boolean }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#202020" }}>
        {icon} {title}
        <ProTag show={pro} />
      </div>
      <div style={{ fontSize: 13, color: "#616161", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Swatch({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 10,
        borderRadius: 12,
        border: "1px solid #ebebeb",
        background: "#fff",
        cursor: "pointer",
      }}
    >
      <span style={{ position: "relative", width: 36, height: 36, flexShrink: 0 }}>
        <span
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: 999,
            background: value,
            border: "1px solid rgba(0,0,0,0.12)",
            boxShadow: "inset 0 0 0 3px rgba(255,255,255,0.6)",
          }}
        />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
        />
      </span>
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#303030" }}>{label}</span>
        <code style={{ fontSize: 12, color: "#8a8a8a" }}>{value.toUpperCase()}</code>
      </span>
    </label>
  );
}

function OptionCard({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        cursor: "pointer",
        flex: 1,
        minWidth: 90,
        borderRadius: 12,
        padding: 12,
        background: active ? "#f2f7ff" : "#fff",
        border: active ? `2px solid ${ACCENT}` : "1px solid #e3e3e3",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        transition: "all .15s ease",
      }}
    >
      <div style={{ height: 34, display: "flex", alignItems: "center", justifyContent: "center" }}>{children}</div>
      <span style={{ fontSize: 13, fontWeight: 600, color: active ? ACCENT : "#303030" }}>
        {active ? "✓ " : ""}
        {label}
      </span>
    </button>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        cursor: "pointer",
        border: "none",
        padding: "7px 14px",
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 600,
        background: active ? "#fff" : "transparent",
        color: active ? "#202020" : "#616161",
        boxShadow: active ? "0 1px 3px rgba(0,0,0,0.15)" : "none",
      }}
    >
      {children}
    </button>
  );
}

function Toggle({ checked, onChange, label, sub }: { checked: boolean; onChange: (v: boolean) => void; label: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        width: "100%",
        padding: 12,
        borderRadius: 12,
        border: "1px solid #ebebeb",
        background: "#fff",
        textAlign: "left",
      }}
    >
      <span>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#303030" }}>{label}</span>
        <span style={{ display: "block", fontSize: 12, color: "#8a8a8a" }}>{sub}</span>
      </span>
      <span
        style={{
          width: 40,
          height: 22,
          borderRadius: 999,
          background: checked ? ACCENT : "#d4d4d4",
          position: "relative",
          flexShrink: 0,
          transition: "background .2s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 16,
            height: 16,
            borderRadius: 999,
            background: "#fff",
            boxShadow: "0 1px 2px rgba(0,0,0,0.3)",
            transition: "left .2s",
          }}
        />
      </span>
    </button>
  );
}

// ---------- PAGE ----------
export default function DesignPage() {
  const { design: saved, published, canFull, planName } = useLoaderData<typeof loader>();
  const actionData = useActionData() as any;
  const submit = useSubmit();
  const nav = useNavigation();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const [d, setD] = useState<Design>(saved);
  const [state, setState] = useState<"available" | "unavailable">("available");
  const dirty = useMemo(() => JSON.stringify(d) !== JSON.stringify(saved), [d, saved]);
  const saving = nav.state !== "idle";

  useEffect(() => setD(saved), [saved]);
  useEffect(() => {
    if (actionData) shopify.toast.show(actionData.message, { isError: !actionData.ok });
  }, [actionData]);

  // Free fields (button color, layout) preset nahi todte; Pro fields se style "custom" ho jata hai
  const set = <K extends keyof Design>(key: K, value: Design[K]) =>
    setD((prev) => ({
      ...prev,
      [key]: value,
      preset: FREE_FIELDS.includes(key) ? prev.preset : "custom",
    }));

  const applyPreset = (key: BaseKey) => setD(presetDesign(key));
  const lockedPro = !canFull && hasProChanges(d);
  const save = () => submit(JSON.stringify(d), { method: "post", encType: "application/json" });

  const status = dirty
    ? { text: "● Unpublished changes", bg: "#fff1e3", color: "#8a4b00" }
    : published
      ? { text: "● Live on your store", bg: "#cdfee1", color: "#0c5132" }
      : { text: "● Not published yet", bg: "#ebebeb", color: "#4a4a4a" };

  return (
    <s-page heading="Widget design">
      <s-button
        slot="primary-action"
        variant="primary"
        disabled={!dirty && published}
        loading={saving}
        onClick={save}
      >
        Publish design
      </s-button>
      <s-button slot="secondary-actions" onClick={() => setD(DEFAULT_DESIGN)}>
        Reset to Classic
      </s-button>

      {/* ---------- HERO ---------- */}
      <div
        style={{
          borderRadius: 18,
          padding: "22px 24px",
          marginBottom: 20,
          background: "linear-gradient(120deg, #0b1f44 0%, #005bd3 55%, #7c3aed 100%)",
          color: "#fff",
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div style={{ maxWidth: 520 }}>
          <div style={{ fontSize: 22, fontWeight: 800, lineHeight: "28px" }}>🎨 Make the checker look like your brand</div>
          <div style={{ fontSize: 14, opacity: 0.85, marginTop: 6 }}>
            Pick a style, match your button color and publish. Changes appear on your product pages instantly.
          </div>
        </div>
        <span
          style={{
            fontSize: 13,
            fontWeight: 700,
            padding: "6px 12px",
            borderRadius: 999,
            background: status.bg,
            color: status.color,
            whiteSpace: "nowrap",
          }}
        >
          {status.text}
        </span>
      </div>

      {lockedPro && (
        <s-banner tone="info" heading="⭐ You're using Pro styling">
          Your store will show the {PRESETS[d.base].label} style with your button color and layout. Custom colors,
          corners, border, shadow and icons go live when you upgrade. They're saved, so nothing is lost.
          <s-button slot="secondary-actions" onClick={() => navigate("/app/pricing")}>
            Upgrade to Pro
          </s-button>
        </s-banner>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
          gap: 20,
          alignItems: "start",
          marginTop: lockedPro ? 16 : 0,
        }}
      >
        {/* ================= LEFT: CONTROLS ================= */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Presets */}
          <div style={card}>
            <Title icon="✨" title="Choose a style" sub="One click to a complete look. Free on every plan." />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
              {BASE_KEYS.map((key) => {
                const active = d.base === key && d.preset !== "custom";
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => applyPreset(key)}
                    style={{
                      position: "relative",
                      cursor: "pointer",
                      textAlign: "left",
                      borderRadius: 14,
                      padding: 10,
                      background: "#f6f6f7",
                      border: active ? `2px solid ${ACCENT}` : "1px solid #e3e3e3",
                      boxShadow: active ? "0 0 0 4px rgba(0,91,211,0.12)" : "none",
                      transition: "all .15s ease",
                    }}
                  >
                    {active && (
                      <span
                        style={{
                          position: "absolute",
                          top: -8,
                          right: -8,
                          width: 22,
                          height: 22,
                          borderRadius: 999,
                          background: ACCENT,
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: 800,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
                        }}
                      >
                        ✓
                      </span>
                    )}
                    <WidgetPreview d={presetDesign(key)} state="available" compact />
                    <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: "#202020" }}>{PRESETS[key].label}</div>
                    <div style={{ fontSize: 11, color: "#8a8a8a" }}>{PRESET_INFO[key]}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Button & layout (Free) */}
          <div style={card}>
            <Title icon="🖌️" title="Button & layout" sub="Match your theme's button color. Free on every plan." />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                <Swatch label="Button color" value={d.accent} onChange={(v) => set("accent", v)} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {QUICK_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      title={c}
                      onClick={() => set("accent", c)}
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: 999,
                        cursor: "pointer",
                        background: c,
                        border: d.accent === c ? `3px solid #fff` : "1px solid rgba(0,0,0,0.15)",
                        boxShadow: d.accent === c ? `0 0 0 2px ${ACCENT}` : "none",
                      }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#303030", marginBottom: 8 }}>Layout</div>
                <div style={{ display: "flex", gap: 10 }}>
                  <OptionCard active={d.layout === "inline"} onClick={() => set("layout", "inline")} label="Side by side">
                    <div style={{ display: "flex", gap: 4 }}>
                      <span style={{ width: 46, height: 14, borderRadius: 4, border: "1px solid #b5b5b5" }} />
                      <span style={{ width: 20, height: 14, borderRadius: 4, background: d.accent }} />
                    </div>
                  </OptionCard>
                  <OptionCard active={d.layout === "stacked"} onClick={() => set("layout", "stacked")} label="Stacked">
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      <span style={{ width: 60, height: 12, borderRadius: 4, border: "1px solid #b5b5b5" }} />
                      <span style={{ width: 60, height: 12, borderRadius: 4, background: d.accent }} />
                    </div>
                  </OptionCard>
                </div>
              </div>
            </div>
          </div>

          {/* Colors (Pro) */}
          <div style={canFull ? card : proCard}>
            <Title icon="🎨" title="Colors" sub="Fine-tune every color to fit your brand." pro={!canFull} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 }}>
              <Swatch label="Button text" value={d.buttonText} onChange={(v) => set("buttonText", v)} />
              <Swatch label="Background" value={d.background} onChange={(v) => set("background", v)} />
              <Swatch label="Text" value={d.text} onChange={(v) => set("text", v)} />
              <Swatch label="Available" value={d.success} onChange={(v) => set("success", v)} />
              <Swatch label="Not available" value={d.error} onChange={(v) => set("error", v)} />
            </div>
          </div>

          {/* Shape & style (Pro) */}
          <div style={canFull ? card : proCard}>
            <Title icon="📐" title="Shape & style" sub="Corners, border, shadow and icons." pro={!canFull} />
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#303030" }}>Corner roundness</span>
                  <div style={{ display: "inline-flex", gap: 2, padding: 3, background: "#ebebeb", borderRadius: 999 }}>
                    {RADIUS_CHIPS.map((r) => (
                      <Pill key={r.label} active={d.radius === r.value} onClick={() => set("radius", r.value)}>
                        {r.label}
                      </Pill>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <input
                    type="range"
                    min={0}
                    max={24}
                    value={d.radius}
                    onChange={(e) => set("radius", Number(e.target.value))}
                    style={{ flex: 1, accentColor: ACCENT }}
                  />
                  <code style={{ fontSize: 12, color: "#616161", width: 36, textAlign: "right" }}>{d.radius}px</code>
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#303030", marginBottom: 8 }}>Border</div>
                <div style={{ display: "flex", gap: 10 }}>
                  {(["none", "subtle", "strong"] as BorderStyle[]).map((b) => (
                    <OptionCard
                      key={b}
                      active={d.border === b}
                      onClick={() => set("border", b)}
                      label={b === "none" ? "None" : b === "subtle" ? "Subtle" : "Strong"}
                    >
                      <span
                        style={{
                          width: 44,
                          height: 28,
                          borderRadius: 6,
                          background: "#fafafa",
                          border:
                            b === "none" ? "1px dashed #d4d4d4" : b === "subtle" ? "1px solid #c9c9c9" : `2px solid ${d.accent}`,
                        }}
                      />
                    </OptionCard>
                  ))}
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                <Toggle checked={d.shadow} onChange={(v) => set("shadow", v)} label="Drop shadow" sub="Lifts the box off the page" />
                <Toggle checked={d.icons} onChange={(v) => set("icons", v)} label="Show icons" sub="🚚 💵 ⏰ next to messages" />
              </div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: "#8a8a8a", padding: "0 4px" }}>
            💡 Heading, button label and placeholder text are edited in your theme editor (Customize → Pincode checker
            block).
          </div>
        </div>

        {/* ================= RIGHT: STICKY PREVIEW ================= */}
        <div style={{ position: "sticky", top: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8, flexWrap: "wrap" }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>👀 Live preview</div>
              <div style={{ display: "inline-flex", gap: 2, padding: 3, background: "#ebebeb", borderRadius: 999 }}>
                <Pill active={state === "available"} onClick={() => setState("available")}>
                  ✅ Available
                </Pill>
                <Pill active={state === "unavailable"} onClick={() => setState("unavailable")}>
                  🚫 Not available
                </Pill>
              </div>
            </div>
            <div style={{ padding: 14, background: "#f1f2f4", borderRadius: 14 }}>
              <ProductMock d={d} state={state} />
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "#8a8a8a", textAlign: "center" }}>
              {d.preset === "custom" ? "🎨 Custom style" : `✨ ${PRESETS[d.base].label} style`}
            </div>
          </div>

          {lockedPro && (
            <div style={proCard}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>🌱 Your store on the {planName} plan</div>
              <div style={{ fontSize: 12, color: "#616161", marginBottom: 12 }}>
                This is what shoppers see until you upgrade.
              </div>
              <WidgetPreview d={freeVersion(d)} state={state} />
              <div style={{ marginTop: 14 }}>
                <s-button variant="primary" onClick={() => navigate("/app/pricing")}>
                  ⭐ Unlock my full design
                </s-button>
              </div>
            </div>
          )}
        </div>
      </div>
    </s-page>
  );
}