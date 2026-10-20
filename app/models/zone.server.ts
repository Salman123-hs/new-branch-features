import mongoose from "mongoose";
import { Pincode } from "./pincode.server";

const zoneSchema = new mongoose.Schema(
  {
    shop: { type: String, required: true, index: true },
    country: { type: String, default: "IN", uppercase: true },
    name: { type: String, required: true, trim: true },
    prefixes: { type: [String], default: [] }, // "4520", "45", "*"
    minDays: { type: Number, default: 3 },
    maxDays: { type: Number, default: 5 },
    codAvailable: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

zoneSchema.index({ shop: 1, country: 1 });

export const Zone: mongoose.Model<any> =
  mongoose.models.Zone || mongoose.model("Zone", zoneSchema);

export type DeliveryRule = {
  source: "pincode" | "zone";
  minDays: number;
  maxDays: number;
  codAvailable: boolean;
  zoneName: string | null;
  prefix: string;
};

// 1) Exact pincode  2) Sabse lamba matching prefix  3) "*" (baaki sab)
export async function findDeliveryRule(
  shop: string,
  country: string,
  pincode: string,
): Promise<DeliveryRule | null> {
  const doc: any = await Pincode.findOne({ shop, country, pincode }).lean();
  if (doc) {
    return {
      source: "pincode",
      minDays: doc.minDays,
      maxDays: doc.maxDays,
      codAvailable: doc.codAvailable,
      zoneName: null,
      prefix: pincode,
    };
  }

  const zones: any[] = await Zone.find({ shop, country, active: true }).lean();
  let best: any = null;
  let bestLen = -1;
  let bestPrefix = "";

  for (const z of zones) {
    for (const p of z.prefixes as string[]) {
      const len = p === "*" ? 0 : p.length;
      if ((p === "*" || pincode.startsWith(p)) && len > bestLen) {
        best = z;
        bestLen = len;
        bestPrefix = p;
      }
    }
  }

  if (!best) return null;
  return {
    source: "zone",
    minDays: best.minDays,
    maxDays: best.maxDays,
    codAvailable: best.codAvailable,
    zoneName: best.name,
    prefix: bestPrefix,
  };
}