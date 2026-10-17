import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { connectDB } from "../mongo.server";
import { DEFAULT_SETTINGS, Settings, getSettings, type ShopSettings } from "../models/settings.server";

const ALL_TIMEZONES = Intl.supportedValuesOf("timeZone");
const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday se dikhane ke liye

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

// Page khulte hi: saved settings, aur pehli baar ho to timezone Shopify store se
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  await connectDB();

  const saved = await Settings.exists({ shop: session.shop });
  const settings = await getSettings(session.shop);

  if (!saved) {
    try {
      const res = await admin.graphql(`#graphql
        query ShopTimezone { shop { ianaTimezone } }`);
      const json = await res.json();
      const tz = json?.data?.shop?.ianaTimezone;
      if (tz && ALL_TIMEZONES.includes(tz)) settings.timezone = tz;
    } catch {
      // nahi mila to default timezone hi rahega
    }
  }

  return { settings, timezones: ALL_TIMEZONES, saved: Boolean(saved) };
};

// Save dabane par: JSON aata hai, check karke MongoDB mein
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();
  const data = (await request.json()) as Partial<ShopSettings>;

  const timezone = String(data.timezone || "");
  if (!ALL_TIMEZONES.includes(timezone)) {
    return { ok: false, message: "Please choose a valid timezone" };
  }

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
  if (workingDays.length === 0) {
    return { ok: false, message: "Select at least one working day" };
  }

  const holidays = [...new Set((data.holidays ?? []).map(String))].filter(isValidDate).sort().slice(0, 100);

  const availableMessage =
    String(data.availableMessage ?? "").trim().slice(0, 200) || DEFAULT_SETTINGS.availableMessage;
  const unavailableMessage =
    String(data.unavailableMessage ?? "").trim().slice(0, 200) || DEFAULT_SETTINGS.unavailableMessage;

  await Settings.findOneAndUpdate(
    { shop: session.shop },
    { timezone, processingDays, cutoffHour, workingDays, holidays, availableMessage, unavailableMessage },
    { upsert: true },
  );

  return { ok: true, message: "Settings saved" };
};

export default function SettingsPage() {
  const { settings: initial, timezones, saved } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const saving = nav.state === "submitting";

  // Saari settings ek state mein (controlled form)
  const [s, setS] = useState<ShopSettings>(initial);
  const [holidayInput, setHolidayInput] = useState("");
  const [holidayError, setHolidayError] = useState("");

  function update<K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) {
    setS((prev) => ({ ...prev, [key]: value }));
  }

  useEffect(() => {
    if (result?.ok) shopify.toast.show(result.message);
  }, [result, shopify]);

  function save() {
    submit(s as any, { method: "post", encType: "application/json" });
  }

  function toggleDay(day: number, checked: boolean) {
    const next = checked ? [...s.workingDays, day] : s.workingDays.filter((d) => d !== day);
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

  const previewMessage = s.availableMessage
    .replace("{from}", "20 Oct")
    .replace("{to}", "22 Oct");

  return (
    <s-page heading="Settings">
      <s-button slot="primary-action" variant="primary" onClick={save} loading={saving}>
        Save
      </s-button>

      {!saved && (
        <s-banner tone="info">
          These are default settings. Review them and click Save to use your own schedule.
        </s-banner>
      )}
      {result && !result.ok && <s-banner tone="critical">{result.message}</s-banner>}

      {/* ---------- Shipping schedule ---------- */}
      <s-section heading="Shipping schedule">
        <s-stack direction="block" gap="base">
          <s-select
            label="Store timezone"
            value={s.timezone}
            onChange={(e: any) => update("timezone", e.currentTarget.value)}
          >
            {timezones.map((tz) => (
              <s-option key={tz} value={tz}>
                {tz}
              </s-option>
            ))}
          </s-select>

          <s-number-field
            label="Processing days"
            details="Days to pack and dispatch an order before it ships. Use 0 for same-day dispatch."
            value={String(s.processingDays)}
            min={0}
            max={30}
            onInput={(e: any) => update("processingDays", Number(e.currentTarget.value || 0))}
          />

          <s-select
            label="Order cut-off time"
            details="Orders placed after this time are counted from the next working day."
            value={String(s.cutoffHour)}
            onChange={(e: any) => update("cutoffHour", Number(e.currentTarget.value))}
          >
            {Array.from({ length: 25 }, (_, h) => (
              <s-option key={h} value={String(h)}>
                {hourLabel(h)}
              </s-option>
            ))}
          </s-select>
        </s-stack>
      </s-section>

      {/* ---------- Working days ---------- */}
      <s-section heading="Working days">
        <s-paragraph>Days when orders are dispatched and delivered. Other days are skipped.</s-paragraph>
        <s-stack direction="inline" gap="base">
          {DAY_ORDER.map((day) => (
            <s-checkbox
              key={day}
              label={DAY_LABELS[day]}
              checked={s.workingDays.includes(day)}
              onChange={(e: any) => toggleDay(day, e.currentTarget.checked)}
            />
          ))}
        </s-stack>
      </s-section>

      {/* ---------- Holidays ---------- */}
      <s-section heading="Holidays">
        <s-paragraph>No dispatch or delivery on these dates (for example Diwali or Christmas).</s-paragraph>
        <s-stack direction="block" gap="base">
          <s-stack direction="inline" gap="base" alignItems="end">
            <s-text-field
              label="Add a holiday"
              placeholder="YYYY-MM-DD"
              value={holidayInput}
              error={holidayError || undefined}
              onInput={(e: any) => setHolidayInput(e.currentTarget.value)}
            />
            <s-button onClick={addHoliday}>Add</s-button>
          </s-stack>

          {s.holidays.length === 0 ? (
            <s-text color="subdued">No holidays added.</s-text>
          ) : (
            <s-stack direction="block" gap="small">
              {s.holidays.map((h) => (
                <s-stack key={h} direction="inline" gap="small" alignItems="center">
                  <s-text>{formatHoliday(h)}</s-text>
                  <s-button
                    variant="tertiary"
                    tone="critical"
                    icon="delete"
                    accessibilityLabel={`Remove ${h}`}
                    onClick={() => update("holidays", s.holidays.filter((x) => x !== h))}
                  />
                </s-stack>
              ))}
            </s-stack>
          )}
        </s-stack>
      </s-section>

      {/* ---------- Messages ---------- */}
      <s-section heading="Messages">
        <s-stack direction="block" gap="base">
          <s-text-field
            label="When delivery is available"
            details="Use {from} and {to} for the delivery dates."
            value={s.availableMessage}
            maxLength={200}
            onInput={(e: any) => update("availableMessage", e.currentTarget.value)}
          />
          <s-text color="subdued">Preview: 🚚 {previewMessage}</s-text>

          <s-text-field
            label="When delivery is not available"
            value={s.unavailableMessage}
            maxLength={200}
            onInput={(e: any) => update("unavailableMessage", e.currentTarget.value)}
          />
        </s-stack>
      </s-section>
    </s-page>
  );
}