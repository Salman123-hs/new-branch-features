import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

const PincodeSchema = new Schema(
  {
    shop: { type: String, required: true, index: true },
    country: { type: String, required: true, default: "IN", uppercase: true, trim: true },
    pincode: { type: String, required: true },
    minDays: { type: Number, default: 3 },
    maxDays: { type: Number, default: 5 },
    codAvailable: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// ek store + ek desh mein same postcode do baar na aaye
PincodeSchema.index({ shop: 1, country: 1, pincode: 1 }, { unique: true });

export type PincodeDoc = InferSchemaType<typeof PincodeSchema>;

export const Pincode: Model<PincodeDoc> =
  (mongoose.models.Pincode as Model<PincodeDoc>) ||
  mongoose.model<PincodeDoc>("Pincode", PincodeSchema);