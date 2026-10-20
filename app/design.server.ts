import { freeVersion, sanitizeDesign, type Design } from "./utils/design";

// Design Shopify ke app metafield mein save hota hai:
// currentAppInstallation → namespace "pdc", key "design" (JSON)
//   design = merchant ka poora design (kabhi delete nahi hota)
//   active = jo store pe dikhega (Free pe sirf basic, Pro pe poora)
// Theme widget Liquid mein {{ app.metafields.pdc.design.value.active }} padhta hai.
const NAMESPACE = "pdc";
const KEY = "design";

const GET_DESIGN = `#graphql
  query AppDesign {
    currentAppInstallation {
      id
      metafield(namespace: "pdc", key: "design") {
        value
      }
    }
  }
`;

const SET_DESIGN = `#graphql
  mutation SetDesign($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      userErrors { field message }
    }
  }
`;

type Stored = { design: Design; active: Design; publishedAt: string };

async function read(admin: any): Promise<{ ownerId: string; stored: Stored | null }> {
  const res = await admin.graphql(GET_DESIGN);
  const json: any = await res.json();
  const inst = json?.data?.currentAppInstallation;
  let stored: any = null;
  try {
    stored = inst?.metafield?.value ? JSON.parse(inst.metafield.value) : null;
  } catch {
    stored = null;
  }
  return { ownerId: inst?.id, stored: stored?.design ? stored : null };
}

async function write(admin: any, ownerId: string, value: Stored) {
  const res = await admin.graphql(SET_DESIGN, {
    variables: {
      metafields: [
        { ownerId, namespace: NAMESPACE, key: KEY, type: "json", value: JSON.stringify(value) },
      ],
    },
  });
  const json: any = await res.json();
  const err = json?.data?.metafieldsSet?.userErrors?.[0];
  if (err) throw new Error(err.message);
}

const activeFor = (design: Design, full: boolean) => (full ? design : freeVersion(design));

// Design page ke liye: merchant ka design + kya publish ho chuka hai
export async function getDesign(admin: any): Promise<{ design: Design; published: boolean }> {
  const { stored } = await read(admin);
  return { design: sanitizeDesign(stored?.design), published: Boolean(stored) };
}

export async function saveDesign(admin: any, design: Design, full: boolean) {
  const { ownerId } = await read(admin);
  const clean = sanitizeDesign(design);
  await write(admin, ownerId, {
    design: clean,
    active: activeFor(clean, full),
    publishedAt: new Date().toISOString(),
  });
}

// Plan badla? Store pe dikhne wala design update karo
// (downgrade = basic look, upgrade = merchant ka poora design wapas)
export async function syncDesignAccess(admin: any, full: boolean) {
  const { ownerId, stored } = await read(admin);
  if (!stored || !ownerId) return;
  const design = sanitizeDesign(stored.design);
  const active = activeFor(design, full);
  if (JSON.stringify(active) === JSON.stringify(sanitizeDesign(stored.active))) return;
  await write(admin, ownerId, { ...stored, design, active });
}