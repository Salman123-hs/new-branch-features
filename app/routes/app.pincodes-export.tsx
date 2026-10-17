import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { connectDB } from "../mongo.server";
import { Pincode } from "../models/pincode.server";

// GET /app/pincodes-export → saare postal codes CSV mein (upload wale format mein)
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  await connectDB();

  const docs = await Pincode.find({ shop: session.shop }).sort({ country: 1, pincode: 1 }).lean();

  const lines = [
    "pincode,min_days,max_days,cod,country",
    ...docs.map((d) =>
      [d.pincode, d.minDays, d.maxDays, d.codAvailable ? "yes" : "no", d.country].join(","),
    ),
  ];

  return new Response(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="postal-codes.csv"',
    },
  });
};