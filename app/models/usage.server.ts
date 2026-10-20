import mongoose from "mongoose";
import { connectDB } from "../mongo.server";

// Har shop ke har mahine ke checks: { shop, month: "2026-10", checks: 523 }
const usageSchema = new mongoose.Schema(
  {
    shop: { type: String, required: true },
    month: { type: String, required: true },
    checks: { type: Number, default: 0 },
  },
  { timestamps: true },
);
usageSchema.index({ shop: 1, month: 1 }, { unique: true });

export const Usage: mongoose.Model<any> =
  mongoose.models.Usage || mongoose.model("Usage", usageSchema);

export const currentMonth = () => new Date().toISOString().slice(0, 7);

// Proxy se har check pe (await nahi karte, taaki widget slow na ho)
export function recordMonthlyCheck(shop: string) {
  return Usage.updateOne(
    { shop, month: currentMonth() },
    { $inc: { checks: 1 } },
    { upsert: true },
  ).catch(() => {});
}

export async function getMonthlyChecks(shop: string): Promise<number> {
  await connectDB();
  const doc: any = await Usage.findOne({ shop, month: currentMonth() }).lean();
  return doc?.checks ?? 0;
}