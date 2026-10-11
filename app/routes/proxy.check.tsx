import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { connectDB } from "../mongo.server";
import { Pincode } from "../models/pincode.server";

// aaj se X din baad ki date, jaise "13 Oct"
function dateAfter(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// Storefront se aane wali request: /apps/pincode/check?pincode=452001
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // check karta hai ki request sach mein Shopify App Proxy se aayi hai
  await authenticate.public.appProxy(request);

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop"); // Shopify khud add karta hai
  const pincode = (url.searchParams.get("pincode") || "").trim();

  if (!shop) {
    return Response.json({ ok: false, message: "Shop not found" }, { status: 400 });
  }
  if (!/^\d{6}$/.test(pincode)) {
    return Response.json({ ok: false, message: "Please enter a valid 6-digit pincode" });
  }

  await connectDB();
  const doc = await Pincode.findOne({ shop, pincode }).lean();

  if (!doc) {
    return Response.json({
      ok: true,
      available: false,
      pincode,
      message: "Sorry, we don't deliver to this pincode yet",
    });
  }

  const from = dateAfter(doc.minDays);
  const to = dateAfter(doc.maxDays);

  return Response.json({
    ok: true,
    available: true,
    pincode,
    minDays: doc.minDays,
    maxDays: doc.maxDays,
    codAvailable: doc.codAvailable,
    deliveryFrom: from,
    deliveryTo: to,
    message: `Delivery by ${from} – ${to}`,
  });
};