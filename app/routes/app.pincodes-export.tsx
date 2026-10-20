import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { connectDB } from "../mongo.server";
import { Pincode } from "../models/pincode.server";
import { getShopPlan } from "../limits.server";

// GET /app/pincodes-export → saare postal codes ki CSV (sirf Pro / Plus)
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // 🔒 CSV export sirf paid plans mein
  const plan = await getShopPlan(shop);
  if (!plan.features.export) {
    return new Response("CSV export is available on the Pro plan.", { status: 403 });
  }

  await connectDB();
  const docs: any[] = await Pincode.find({ shop }).sort({ country: 1, pincode: 1 }).lean();

  // Import wale format mein hi, taaki wapas import ho sake
  const lines = ["pincode,min_days,max_days,cod,country"];
  for (const d of docs) {
    lines.push([d.pincode, d.minDays, d.maxDays, d.codAvailable ? "yes" : "no", d.country].join(","));
  }

  const date = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="postal-codes-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
};