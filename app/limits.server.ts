import { connectDB } from "./mongo.server";
import { Pincode } from "./models/pincode.server";
import { Zone } from "./models/zone.server";
import { getStoredPlan } from "./billing.server";
import { PLANS, type Plan } from "./utils/plans";

export async function getShopPlan(shop: string): Promise<Plan> {
  return PLANS[await getStoredPlan(shop)];
}

// Store ne kaun-kaun se countries use kiye (pincodes + zones)
export async function usedCountries(shop: string): Promise<string[]> {
  await connectDB();
  const [a, b] = await Promise.all([
    Pincode.distinct("country", { shop }),
    Zone.distinct("country", { shop }),
  ]);
  return [...new Set([...(a as string[]), ...(b as string[])])];
}

// Free = 1 country. Nayi country allowed hai?
export async function countryAllowed(shop: string, country: string, plan: Plan) {
  const limit = plan.limits.countries;
  if (limit === null) return true;
  const used = await usedCountries(shop);
  return used.includes(country) || used.length < limit;
}

// Kitne aur pincodes add ho sakte hain (null = unlimited)
export async function pincodeRoom(shop: string, plan: Plan): Promise<number | null> {
  if (plan.limits.pincodes === null) return null;
  await connectDB();
  const count = await Pincode.countDocuments({ shop });
  return Math.max(0, plan.limits.pincodes - count);
}

// Kitne aur zones ban sakte hain (null = unlimited)
export async function zoneRoom(shop: string, plan: Plan): Promise<number | null> {
  if (plan.limits.zones === null) return null;
  await connectDB();
  const count = await Zone.countDocuments({ shop });
  return Math.max(0, plan.limits.zones - count);
}