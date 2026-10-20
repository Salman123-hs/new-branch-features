// Saare plans ek jagah. Price/limit badalna ho to sirf yahan badlo.
export const TRIAL_DAYS = 14;

export type PlanKey = "free" | "pro" | "plus";
export type Interval = "monthly" | "yearly";

// null = Unlimited
export type Plan = {
  key: PlanKey;
  name: string;
  emoji: string;
  billingName: string; // monthly subscription ka naam (kabhi mat badlna)
  billingNameYearly: string; // yearly subscription ka naam
  price: number; // USD / month
  yearlyPrice: number; // USD / year
  tagline: string;
  highlightsTitle: string;
  highlights: string[];
  limits: {
    pincodes: number | null;
    zones: number | null;
    checks: number | null; // per month
    countries: number | null;
  };
  features: {
    countdown: boolean;
    export: boolean;
    design: boolean;
    removeBadge: boolean;
    analytics: false | "Basic" | "Full";
    prioritySupport: boolean;
  };
};

export const PLANS: Record<PlanKey, Plan> = {
  free: {
    key: "free",
    name: "Free",
    emoji: "🌱",
    billingName: "",
    billingNameYearly: "",
    price: 0,
    yearlyPrice: 0,
    tagline: "Everything you need to get started",
    highlightsTitle: "Includes",
    highlights: [
      "100 postcodes & 2 zones",
      "1,000 checks / month",
      "Delivery dates & COD status",
      "Holidays, cut-off & working days",
    ],
    limits: { pincodes: 100, zones: 2, checks: 1000, countries: 1 },
    features: {
      countdown: false,
      export: false,
      design: false,
      removeBadge: false,
      analytics: false,
      prioritySupport: false,
    },
  },
  pro: {
    key: "pro",
    name: "Pro",
    emoji: "🚀",
    billingName: "Pro",
    billingNameYearly: "Pro Yearly",
    price: 4.99,
    yearlyPrice: 49.9,
    tagline: "For growing stores that want more sales",
    highlightsTitle: "Everything in Free, plus",
    highlights: [
      "Unlimited postcodes & zones",
      "20,000 checks / month",
      "⏰ Live cut-off countdown",
      "All countries",
      "Widget design options",
      "CSV export",
      'Remove "Powered by" badge',
      "Basic analytics",
    ],
    limits: { pincodes: null, zones: null, checks: 20000, countries: null },
    features: {
      countdown: true,
      export: true,
      design: true,
      removeBadge: true,
      analytics: "Basic",
      prioritySupport: false,
    },
  },
  plus: {
    key: "plus",
    name: "Plus",
    emoji: "💎",
    billingName: "Plus",
    billingNameYearly: "Plus Yearly",
    price: 9.99,
    yearlyPrice: 99.9,
    tagline: "For high-traffic stores",
    highlightsTitle: "Everything in Pro, plus",
    highlights: ["Unlimited checks", "Full analytics", "Priority support"],
    limits: { pincodes: null, zones: null, checks: null, countries: null },
    features: {
      countdown: true,
      export: true,
      design: true,
      removeBadge: true,
      analytics: "Full",
      prioritySupport: true,
    },
  },
};

export const PLAN_ORDER: PlanKey[] = ["free", "pro", "plus"];

export function planFromBillingName(name?: string | null): { key: PlanKey; interval: Interval } {
  for (const k of ["pro", "plus"] as PlanKey[]) {
    if (name === PLANS[k].billingName) return { key: k, interval: "monthly" };
    if (name === PLANS[k].billingNameYearly) return { key: k, interval: "yearly" };
  }
  return { key: "free", interval: "monthly" };
}

export const fmtLimit = (n: number | null) =>
  n === null ? "Unlimited" : n.toLocaleString("en-US");