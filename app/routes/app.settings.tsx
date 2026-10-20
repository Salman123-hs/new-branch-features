import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../mongo.server";
import { DEFAULT_SETTINGS, Settings, getSettings, type ShopSettings } from "../models/settings.server";
import { calculateDelivery, fillMessage, formatCountdown, formatDay, toISODate } from "../utils/delivery-date";

const ALL_TIMEZONES = Intl.supportedValuesOf("timeZone");
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

// Fixed-date national holidays (inki date har saal same hoti hai)
const INDIA_FIXED_HOLIDAYS = [
  ["01-01", "New Year"],
  ["01-26", "Republic Day"],
  ["08-15", "Independence Day"],
  ["10-02", "Gandhi Jayanti"],
  ["12-25", "Christmas"],
] as const;

function hourLabel(h: number) {
  if (h === 24) return "No cut-off";
  const hour12 = ((h + 11) % 12) + 1;
  return `${hour12}:00 ${h < 12 ? "AM" : "PM"}`;
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function formatHoliday(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

// ---------------- loader ----------------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await connectDB();

  const saved = await Settings.exists({ shop: session.shop });
  const settings = await getSettings(session.shop);

  if (!saved) {
    try {
      const res = await admin.graphql(`#graphql
        query ShopTimezone { shop { ianaTimezone } }`);
      const json: any = await res.json();
      const tz = json?.data?.shop?.ianaTimezone;
      if (tz && ALL_TIMEZONES.includes(tz)) settings.timezone = tz;
    } catch {
      // default timezone hi rahega
    }
  }

  return { settings, timezones: ALL_TIMEZONES, saved: Boolean(saved) };
};

// ---------------- action ----------------
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const data = (await request.json()) as Partial<ShopSettings>;

  const timezone = String(data.timezone || "");
  if (!ALL_TIMEZONES.includes(timezone)) return { ok: false, message: "Please choose a valid timezone" };

  const processingDays = Number(data.processingDays);
  if (!Number.isInteger(processingDays) || processingDays < 0 || processingDays > 30) {
    return { ok: false, message: "Processing days must be a whole number from 0 to 30" };
  }

  const cutoffHour = Number(data.cutoffHour);
  if (!Number.isInteger(cutoffHour) || cutoffHour < 0 || cutoffHour > 24) {
    return { ok: false, message: "Please choose a valid cut-off time" };
  }

  const workingDays = [...new Set((data.workingDays ?? []).map(Number))]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort();
  if (workingDays.length === 0) return { ok: false, message: "Select at least one working day" };

  const holidays = [...new Set((data.holidays ?? []).map(String))].filter(isValidDate).sort().slice(0, 100);

  const availableMessage =
    String(data.availableMessage ?? "").trim().slice(0, 200) || DEFAULT_SETTINGS.availableMessage;
  const unavailableMessage =
    String(data.unavailableMessage ?? "").trim().slice(0, 200) || DEFAULT_SETTINGS.unavailableMessage;

  const showCountdown = data.showCountdown !== false; // naya
  const disclaimer = String(data.disclaimer ?? "").trim().slice(0, 200); // naya

  await Settings.findOneAndUpdate(
    { shop: session.shop },
    {
      timezone,
      processingDays,
      cutoffHour,
      workingDays,
      holidays,
      availableMessage,
      unavailableMessage,
      showCountdown,
      disclaimer,
    },
    { upsert: true },
  );

  return { ok: true, message: "Settings saved" };
};

// ---------------- Live preview card ----------------
function LivePreview({ s, now }: { s: ShopSettings; now: Date | null }) {
  const [pMin, setPMin] = useState("2");
  const [pMax, setPMax] = useState("4");

  if (!now) return <s-text color="subdued">Loading preview…</s-text>;

  const min = Math.max(0, Number(pMin) || 0);
  const max = Math.max(min, Number(pMax) || 0);
  const r = calculateDelivery(s, min, max, now);
  const from = formatDay(r.from);
  const to = formatDay(r.to);
  const message = fillMessage(s.availableMessage, from, to);

  let storeTime = "";
  try {
    storeTime = now.toLocaleString("en-IN", {
      timeZone: s.timezone,
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    storeTime = "";
  }

  const step = (icon: string, title: string, value: string) => (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
      <span style={{ fontSize: 18, lineHeight: "22px" }}>{icon}</span>
      <div>
        <div style={{ fontSize: 12, color: "#616161" }}>{title}</div>
        <div style={{ fontWeight: 600 }}>{value}</div>
      </div>
    </div>
  );

  return (
    <s-stack direction="block" gap="base">
      <s-text color="subdued">Store time now: {storeTime}</s-text>

      {/* product page widget jaisa */}
      <div
        style={{
          border: "1px solid #e3e3e3",
          borderRadius: 12,
          padding: 14,
          background: "#fff",
          boxShadow: "0 6px 20px rgba(0,0,0,0.06)",
          fontSize: 14,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Check delivery</div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1, border: "1px solid #c9c9c9", borderRadius: 6, padding: "7px 10px" }}>452001</div>
          <div style={{ background: "#000", color: "#fff", borderRadius: 6, padding: "7px 12px", fontWeight: 600 }}>
            Check
          </div>
        </div>
        <div style={{ color: "#0a7d32", marginTop: 10 }}>🚚 {message}</div>

        {/* naya: countdown sirf tab jab switch on ho */}
        {s.showCountdown && r.minutesLeft !== null && (
          <div style={{ color: "#b25e09", marginTop: 4, fontWeight: 600 }}>
            ⏰ Order within {formatCountdown(r.minutesLeft)}{" "}
            {toISODate(r.dispatch) === toISODate(r.today) ? "for dispatch today" : `to get it by ${to}`}
          </div>
        )}

        {/* naya: merchant ka note */}
        {s.disclaimer && <div style={{ color: "#8a8a8a", fontSize: 12, marginTop: 6 }}>{s.disclaimer}</div>}
      </div>

      {/* timeline */}
      <s-box padding="base" background="subdued" borderRadius="base">
        <div style={{ display: "grid", gap: 12 }}>
          {step("🛒", "Order counted from", r.todayCounts ? `Today, ${formatDay(r.orderDay)}` : formatDay(r.orderDay))}
          {step("📦", "Dispatched", formatDay(r.dispatch))}
          {step("🚚", "Delivered", from === to ? from : `${from} – ${to}`)}
        </div>
      </s-box>

      {!r.todayCounts && (
        <s-text color="subdued">
          {s.cutoffHour < 24 ? "Today's cut-off has passed or today is a day off, " : "Today is a day off, "}
          so new orders start from the next working day.
        </s-text>
      )}

      <s-grid gridTemplateColumns="1fr 1fr" gap="small">
        <s-number-field
          label="Preview: min days"
          min={0}
          value={pMin}
          onInput={(e: any) => setPMin(e.currentTarget.value)}
        />
        <s-number-field
          label="Preview: max days"
          min={0}
          value={pMax}
          onInput={(e: any) => setPMax(e.currentTarget.value)}
        />
      </s-grid>
    </s-stack>
  );
}

// ---------------- Page ----------------
export default function SettingsPage() {
  const { settings: initial, timezones, saved } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const saving = nav.state === "submitting";

  const [s, setS] = useState<ShopSettings>(initial);
  const [holidayInput, setHolidayInput] = useState("");
  const [holidayError, setHolidayError] = useState("");
  const [now, setNow] = useState<Date | null>(null);

  // Preview ke liye "abhi ka time" (har 30 second update)
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (result?.ok) shopify.toast.show(result.message);
  }, [result, shopify]);

  function update<K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  const dirty = JSON.stringify(s) !== JSON.stringify(initial);

  function save() {
    submit(s as any, { method: "post", encType: "application/json" });
  }

  function toggleDay(day: number) {
    const next = s.workingDays.includes(day) ? s.workingDays.filter((d) => d !== day) : [...s.workingDays, day];
    update("workingDays", [...new Set(next)].sort());
  }

  function addHoliday() {
    const value = holidayInput.trim();
    if (!isValidDate(value)) {
      setHolidayError("Use the format YYYY-MM-DD, for example 2026-11-08");
      return;
    }
    if (s.holidays.includes(value)) {
      setHolidayError("This date is already added");
      return;
    }
    update("holidays", [...s.holidays, value].sort());
    setHolidayInput("");
    setHolidayError("");
  }

  // Har fixed holiday ki agli aane wali date jodo
  function addIndiaHolidays() {
    const todayIso = new Date().toISOString().slice(0, 10);
    const year = new Date().getFullYear();
    const dates = INDIA_FIXED_HOLIDAYS.map(([md]) => {
      const thisYear = `${year}-${md}`;
      return thisYear >= todayIso ? thisYear : `${year + 1}-${md}`;
    });
    update("holidays", [...new Set([...s.holidays, ...dates])].sort());
  }

  return (
    <s-page heading="Settings">
      <s-button
        slot="primary-action"
        variant="primary"
        onClick={save}
        loading={saving}
        disabled={saved && !dirty}
      >
        Save
      </s-button>

      {!saved && (
        <s-banner tone="info">
          These are default settings. Review them and click Save to use your own schedule.
        </s-banner>
      )}
      {saved && dirty && <s-banner tone="warning">You have unsaved changes.</s-banner>}
      {result && !result.ok && <s-banner tone="critical">{result.message}</s-banner>}

      {/* ---------- Shipping schedule ---------- */}
      <s-section heading="⏱️ Shipping schedule">
        <s-stack direction="block" gap="base">
          <s-select
            label="Store timezone"
            details="Cut-off time and delivery dates are calculated in this timezone."
            value={s.timezone}
            onChange={(e: any) => update("timezone", e.currentTarget.value)}
          >
            {timezones.map((tz) => (
              <s-option key={tz} value={tz}>
                {tz}
              </s-option>
            ))}
          </s-select>

          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap="base">
            <s-number-field
              label="Processing days"
              details="Days to pack an order before it ships. 0 = same day."
              value={String(s.processingDays)}
              min={0}
              max={30}
              onInput={(e: any) => update("processingDays", Number(e.currentTarget.value || 0))}
            />
            <s-select
              label="Order cut-off time"
              details="Orders after this time count from the next working day."
              value={String(s.cutoffHour)}
              onChange={(e: any) => update("cutoffHour", Number(e.currentTarget.value))}
            >
              {Array.from({ length: 25 }, (_, h) => (
                <s-option key={h} value={String(h)}>
                  {hourLabel(h)}
                </s-option>
              ))}
            </s-select>
          </s-grid>
        </s-stack>
      </s-section>

      {/* ---------- Working days ---------- */}
      <s-section heading="📅 Working days">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">Tap to turn days on or off. Days off are skipped for dispatch and delivery.</s-text>
          <s-stack direction="inline" gap="small">
            {DAY_ORDER.map((day) => {
              const on = s.workingDays.includes(day);
              return (
                <s-button key={day} variant={on ? "primary" : "secondary"} onClick={() => toggleDay(day)}>
                  {on ? `✓ ${DAY_SHORT[day]}` : DAY_SHORT[day]}
                </s-button>
              );
            })}
          </s-stack>
        </s-stack>
      </s-section>

      {/* ---------- Holidays ---------- */}
      <s-section heading="🎉 Holidays">
        <s-stack direction="block" gap="base">
          <s-text color="subdued">No dispatch or delivery on these dates.</s-text>

          <s-stack direction="inline" gap="base" alignItems="end">
            <s-text-field
              label="Add a holiday"
              placeholder="YYYY-MM-DD"
              value={holidayInput}
              error={holidayError || undefined}
              onInput={(e: any) => setHolidayInput(e.currentTarget.value)}
            />
            <s-button onClick={addHoliday}>Add</s-button>
            <s-button variant="tertiary" onClick={addIndiaHolidays}>
              🇮🇳 Add India national holidays
            </s-button>
          </s-stack>

          {s.holidays.length === 0 ? (
            <s-text color="subdued">No holidays added yet.</s-text>
          ) : (
            <s-stack direction="inline" gap="small">
              {s.holidays.map((h) => (
                <s-box key={h} padding="small-200" border="base" borderRadius="base">
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text>{formatHoliday(h)}</s-text>
                    <s-button
                      variant="tertiary"
                      icon="delete"
                      accessibilityLabel={`Remove ${h}`}
                      onClick={() => update("holidays", s.holidays.filter((x) => x !== h))}
                    />
                  </s-stack>
                </s-box>
              ))}
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {/* ---------- Messages ---------- */}
      <s-section heading="💬 Messages">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="When delivery is available"
            details="Use {from} and {to} for the delivery dates."
            value={s.availableMessage}
            maxLength={200}
            onInput={(e: any) => update("availableMessage", e.currentTarget.value)}
          />
          <s-text-field
            label="When delivery is not available"
            value={s.unavailableMessage}
            maxLength={200}
            onInput={(e: any) => update("unavailableMessage", e.currentTarget.value)}
          />

          {/* naya: countdown on/off */}
          <s-checkbox
            label="Show order cut-off countdown"
            details="Shows “Order within 2h 27m…” under the delivery date until your daily cut-off."
            checked={s.showCountdown}
            onChange={(e: any) => update("showCountdown", e.currentTarget.checked)}
          />

          {/* naya: result ke neeche chhota note */}
          <s-text-field
            label="Note under the result (optional)"
            placeholder="Delivery dates are estimates and may vary."
            value={s.disclaimer}
            maxLength={200}
            onInput={(e: any) => update("disclaimer", e.currentTarget.value)}
          />
        </s-stack>
      </s-section>

      {/* ---------- Live preview (right side) ---------- */}
      <s-section slot="aside" heading="👀 Live preview">
        <LivePreview s={s} now={now} />
      </s-section>
    </s-page>
  );
}