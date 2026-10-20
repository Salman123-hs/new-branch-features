import "dotenv/config";
import dns from "node:dns";
dns.setServers(["8.8.8.8", "1.1.1.1"]);
import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";
import { PLANS, TRIAL_DAYS } from "./utils/plans";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October25,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new MongoDBSessionStorage(
    new URL(process.env.MONGODB_URI!),
    process.env.MONGODB_DB!,
  ),
  distribution: AppDistribution.AppStore,
  // 💰 Paid plans (prices app/utils/plans.ts se aate hain)
    billing: {
    [PLANS.pro.billingName]: {
      lineItems: [{ amount: PLANS.pro.price, currencyCode: "USD", interval: BillingInterval.Every30Days }],
      trialDays: TRIAL_DAYS,
    },
    [PLANS.pro.billingNameYearly]: {
      lineItems: [{ amount: PLANS.pro.yearlyPrice, currencyCode: "USD", interval: BillingInterval.Annual }],
      trialDays: TRIAL_DAYS,
    },
    [PLANS.plus.billingName]: {
      lineItems: [{ amount: PLANS.plus.price, currencyCode: "USD", interval: BillingInterval.Every30Days }],
      trialDays: TRIAL_DAYS,
    },
    [PLANS.plus.billingNameYearly]: {
      lineItems: [{ amount: PLANS.plus.yearlyPrice, currencyCode: "USD", interval: BillingInterval.Annual }],
      trialDays: TRIAL_DAYS,
    },
  },
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October25;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;