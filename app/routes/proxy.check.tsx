import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { connectDB } from "../mongo.server";
import { Pincode } from "../models/pincode.server";
import { getSettings } from "../models/settings.server";
import { recordCheck } from "../models/stats.server";
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
  const [doc, schedule] = await Promise.all([
    Pincode.findOne({ shop, country, pincode }).lean(),
    getSettings(shop),
  ]);

  if (!doc) {
    recordCheck(shop, false);
    return Response.json({
      ok: true,
      available: false,
      pincode,
      country,
      message: schedule.unavailableMessage,
    });
  }

  recordCheck(shop, true);

  // cut-off, processing days, working days aur holidays ke hisaab se
  const r = calculateDelivery(schedule, doc.minDays, doc.maxDays);
  const from = formatDay(r.from);
  const to = formatDay(r.to);

  return Response.json({
    ok: true,
    available: true,
    pincode,
    country,
    minDays: doc.minDays,
    maxDays: doc.maxDays,
    codAvailable: doc.codAvailable,
    deliveryFrom: from,
    deliveryTo: to,
    dispatchDate: formatDay(r.dispatch),
    // Settings mein countdown off ho to null bhejo, widget line nahi dikhayega
    cutoffMinutesLeft: schedule.showCountdown ? r.minutesLeft : null,
    // aaj hi dispatch hoga? (processing days 0 ho to true)
    dispatchToday: toISODate(r.dispatch) === toISODate(r.today),
    // merchant ka note, result ke neeche grey mein
    disclaimer: schedule.disclaimer,
    message: fillMessage(schedule.availableMessage, from, to),
  });
};