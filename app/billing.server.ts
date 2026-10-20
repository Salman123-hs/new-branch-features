import mongoose from "mongoose";
import { connectDB } from "./mongo.server";
import {
  PLANS,
  TRIAL_DAYS,
  planFromBillingName,
  type Interval,
  type PlanKey,
} from "./utils/plans";

// .env mein BILLING_TEST=false karne tak saare charges test rahenge
export const IS_TEST = process.env.BILLING_TEST !== "false";

export const PAID_PLAN_NAMES = [
  PLANS.pro.billingName,
  PLANS.pro.billingNameYearly,
  PLANS.plus.billingName,
  PLANS.plus.billingNameYearly,
];

const DAY = 24 * 60 * 60 * 1000;

// Har shop ka current plan DB mein bhi, taaki storefront limits check kar sake
const shopPlanSchema = new mongoose.Schema(
  {
    shop: { type: String, required: true, unique: true },
    plan: { type: String, default: "free" },
    interval: { type: String, default: "monthly" },
    subscriptionId: { type: String, default: null },
    firstPaidAt: { type: Date, default: null }, // trial abuse rokne ke liye
  },
  { timestamps: true },
);

export const ShopPlan: mongoose.Model<any> =
  mongoose.models.ShopPlan || mongoose.model("ShopPlan", shopPlanSchema);

export type CurrentPlan = {
  key: PlanKey;
  interval: Interval;
  subscriptionId: string | null;
  test: boolean;
  trialDays: number;
};

// ---------- Current plan (Shopify se pucho + DB mein save karo) ----------
export async function getCurrentPlan(billing: any, shop: string): Promise<CurrentPlan> {
  const { appSubscriptions } = await billing.check({
    plans: PAID_PLAN_NAMES,
    isTest: IS_TEST,
  });

  const sub =
    appSubscriptions?.find((s: any) => s.status === "ACTIVE") ??
    appSubscriptions?.[0] ??
    null;

  const { key, interval } = sub
    ? planFromBillingName(sub.name)
    : { key: "free" as PlanKey, interval: "monthly" as Interval };

  await connectDB();
  await ShopPlan.updateOne(
    { shop },
    { $set: { plan: key, interval, subscriptionId: sub?.id ?? null } },
    { upsert: true },
  );

  // Pehli baar paid plan mila? Date yaad rakho (trial ek hi baar milega)
  if (sub) {
    await ShopPlan.updateOne({ shop, firstPaidAt: null }, { $set: { firstPaidAt: new Date() } });
  }

  return {
    key,
    interval,
    subscriptionId: sub?.id ?? null,
    test: Boolean(sub?.test),
    trialDays: sub?.trialDays ?? 0,
  };
}

// ---------- Kitne trial din bache hain ----------
export async function getTrialDaysLeft(shop: string): Promise<number> {
  await connectDB();
  const doc: any = await ShopPlan.findOne({ shop }).lean();
  if (!doc?.firstPaidAt) return TRIAL_DAYS;
  const used = Math.floor((Date.now() - new Date(doc.firstPaidAt).getTime()) / DAY);
  return Math.max(0, TRIAL_DAYS - used);
}

// ---------- Storefront / proxy ke liye ----------
export async function getStoredPlan(shop: string): Promise<PlanKey> {
  await connectDB();
  const doc: any = await ShopPlan.findOne({ shop }).lean();
  return (doc?.plan as PlanKey) || "free";
}

// ---------- Subscription create (GraphQL se) ----------
const CREATE_SUBSCRIPTION = `#graphql
  mutation CreateSubscription(
    $name: String!
    $returnUrl: URL!
    $trialDays: Int
    $test: Boolean
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      trialDays: $trialDays
      test: $test
      lineItems: $lineItems
    ) {
      confirmationUrl
      userErrors { field message }
    }
  }
`;

export async function createSubscription(
  admin: any,
  shop: string,
  key: PlanKey,
  interval: Interval,
): Promise<{ confirmationUrl?: string; error?: string }> {
  const plan = PLANS[key];
  const yearly = interval === "yearly";
  const trialDays = await getTrialDaysLeft(shop); // sirf bache hue din

  const storeHandle = shop.replace(".myshopify.com", "");
  const returnUrl = `https://admin.shopify.com/store/${storeHandle}/apps/${process.env.SHOPIFY_API_KEY}/app/pricing`;

  const res = await admin.graphql(CREATE_SUBSCRIPTION, {
    variables: {
      name: yearly ? plan.billingNameYearly : plan.billingName,
      returnUrl,
      trialDays,
      test: IS_TEST,
      lineItems: [
        {
          plan: {
            appRecurringPricingDetails: {
              price: { amount: yearly ? plan.yearlyPrice : plan.price, currencyCode: "USD" },
              interval: yearly ? "ANNUAL" : "EVERY_30_DAYS",
            },
          },
        },
      ],
    },
  });

  const json = await res.json();
  const data = json?.data?.appSubscriptionCreate;
  if (data?.userErrors?.length) return { error: data.userErrors[0].message };
  if (!data?.confirmationUrl) return { error: "Could not start the subscription" };
  return { confirmationUrl: data.confirmationUrl };
}