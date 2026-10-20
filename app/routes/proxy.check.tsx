import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { connectDB } from "../mongo.server";
import { findDeliveryRule } from "../models/zone.server";
import { getSettings } from "../models/settings.server";
import { recordCheck } from "../models/stats.server";
import { recordMonthlyCheck } from "../models/usage.server";
import { getShopPlan } from "../limits.server";
import { isValidPostcode, normalizeCountry, normalizePostcode } from "../utils/postcode";
import { calculateDelivery, fillMessage, formatDay, toISODate } from "../utils/delivery-date";

// Storefront se: /apps/pincode/check?pincode=452001&country=IN
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const country = normalizeCountry(url.searchParams.get("country"));
  const pincode = normalizePostcode(url.searchParams.get("pincode"), country);

  if (!shop) {
    return Response.json({ ok: false, message: "Shop not found" }, { status: 400 });
  }
  if (!isValidPostcode(pincode, country)) {
    return Response.json({ ok: false, message: "Please enter a valid postal code" });
  }

  await connectDB();
  const [rule, schedule, plan] = await Promise.all([
    findDeliveryRule(shop, country, pincode),
    getSettings(shop),
    getShopPlan(shop),
  ]);

  // Mahine ke checks gino (limit cross hone pe bhi widget chalta rahega)
  recordMonthlyCheck(shop);

  const poweredBy = !plan.features.removeBadge;

  if (!rule) {
    recordCheck(shop, false);
    return Response.json({
      ok: true,
      available: false,
      pincode,
      country,
      poweredBy,
      message: schedule.unavailableMessage,
    });
  }

  recordCheck(shop, true);

  const r = calculateDelivery(schedule, rule.minDays, rule.maxDays);
  const from = formatDay(r.from);
  const to = formatDay(r.to);

  // Countdown sirf Pro/Plus mein + merchant ne on kiya ho
  const countdownOn = schedule.showCountdown && plan.features.countdown;

  return Response.json({
    ok: true,
    available: true,
    pincode,
    country,
    source: rule.source,
    zone: rule.zoneName,
    minDays: rule.minDays,
    maxDays: rule.maxDays,
    codAvailable: rule.codAvailable,
    deliveryFrom: from,
    deliveryTo: to,
    dispatchDate: formatDay(r.dispatch),
    cutoffMinutesLeft: countdownOn ? r.minutesLeft : null,
    dispatchToday: toISODate(r.dispatch) === toISODate(r.today),
    disclaimer: schedule.disclaimer,
    poweredBy,
    message: fillMessage(schedule.availableMessage, from, to),
  });
};