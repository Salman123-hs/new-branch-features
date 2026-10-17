import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

// Jab tak merchant kuch save na kare, ye values chalengi
export const DEFAULT_SETTINGS = {
  timezone: "Asia/Kolkata",
  processingDays: 1,
  cutoffHour: 14, // 14 = 2:00 PM, 24 = koi cut-off nahi
  workingDays: [1, 2, 3, 4, 5, 6], // 0 = Sunday ... 6 = Saturday
  holidays: [] as string[], // "2026-11-08" format
  availableMessage: "Delivery by {from} – {to}",
  unavailableMessage: "Sorry, we don't deliver to this pincode yet",
};

export type ShopSettings = typeof DEFAULT_SETTINGS;

const SettingsSchema = new Schema(
  {
    shop: { type: String, required: true, unique: true }, // har store ki ek hi settings
    timezone: { type: String, default: DEFAULT_SETTINGS.timezone },
    processingDays: { type: Number, default: DEFAULT_SETTINGS.processingDays, min: 0, max: 30 },
    cutoffHour: { type: Number, default: DEFAULT_SETTINGS.cutoffHour, min: 0, max: 24 },
    workingDays: { type: [Number], default: () => [...DEFAULT_SETTINGS.workingDays] },
    holidays: { type: [String], default: () => [] },
    availableMessage: { type: String, default: DEFAULT_SETTINGS.availableMessage },
    unavailableMessage: { type: String, default: DEFAULT_SETTINGS.unavailableMessage },
  },
  { timestamps: true },
);

export type SettingsDoc = InferSchemaType<typeof SettingsSchema>;

export const Settings: Model<SettingsDoc> =
  (mongoose.models.Settings as Model<SettingsDoc>) ||
  mongoose.model<SettingsDoc>("Settings", SettingsSchema);

// Store ki settings laao; save nahi ki to defaults
export async function getSettings(shop: string): Promise<ShopSettings> {
  const doc = await Settings.findOne({ shop }).lean();
  return {
    timezone: doc?.timezone ?? DEFAULT_SETTINGS.timezone,
    processingDays: doc?.processingDays ?? DEFAULT_SETTINGS.processingDays,
    cutoffHour: doc?.cutoffHour ?? DEFAULT_SETTINGS.cutoffHour,
    workingDays: doc?.workingDays?.length ? [...doc.workingDays] : [...DEFAULT_SETTINGS.workingDays],
    holidays: doc?.holidays ? [...doc.holidays] : [],
    availableMessage: doc?.availableMessage || DEFAULT_SETTINGS.availableMessage,
    unavailableMessage: doc?.unavailableMessage || DEFAULT_SETTINGS.unavailableMessage,
  };
}