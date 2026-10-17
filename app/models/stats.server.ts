import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Har store ke liye: customers ne kitni baar pincode check kiya
const StatsSchema = new Schema(
  {
    shop: { type: String, required: true, unique: true },
    checks: { type: Number, default: 0 },
    notAvailable: { type: Number, default: 0 }, // jahan delivery nahi hoti, wahan ke checks
    lastCheckAt: { type: Date },
  },
  { timestamps: true },
);

export type StatsDoc = InferSchemaType<typeof StatsSchema>;

export const Stats: Model<StatsDoc> =
  (mongoose.models.Stats as Model<StatsDoc>) || mongoose.model<StatsDoc>("Stats", StatsSchema);

// Ek check gino (error aaye to bhi customer ka jawab nahi rukna chahiye)
export function recordCheck(shop: string, available: boolean) {
  return Stats.updateOne(
    { shop },
    {
      $inc: { checks: 1, notAvailable: available ? 0 : 1 },
      $set: { lastCheckAt: new Date() },
    },
    { upsert: true },
  ).catch(() => {});
}