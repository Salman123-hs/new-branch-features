// Widget design: admin (Design page) aur storefront dono ke liye ek hi jagah
export type BaseKey = "classic" | "minimal" | "bold" | "soft" | "dark";
export type PresetKey = BaseKey | "custom";
export type BorderStyle = "none" | "subtle" | "strong";
export type Layout = "inline" | "stacked";

export type Design = {
  preset: PresetKey; // "custom" = merchant ne Pro controls badle
  base: BaseKey; // aakhri chuna hua preset (Free ka look isi se banta hai)
  accent: string; // button ka rang            🌱 Free
  layout: Layout; // ek line / upar-neeche      🌱 Free
  buttonText: string; //                        🚀 Pro
  background: string; //                        🚀 Pro
  text: string; //                              🚀 Pro
  success: string; //                           🚀 Pro
  error: string; //                             🚀 Pro
  radius: number; // 0–24 px                    🚀 Pro
  border: BorderStyle; //                       🚀 Pro
  shadow: boolean; //                           🚀 Pro
  icons: boolean; // 🚚 💵 ⏰ emoji             🚀 Pro
};

// Free plan mein yeh fields merchant khud badal sakta hai
export const FREE_FIELDS: (keyof Design)[] = ["preset", "base", "accent", "layout"];

type Look = Omit<Design, "preset" | "base">;

export const PRESETS: Record<BaseKey, { label: string; look: Look }> = {
  classic: {
    label: "Classic",
    look: {
      accent: "#000000",
      buttonText: "#ffffff",
      background: "#ffffff",
      text: "#303030",
      success: "#0a7d32",
      error: "#c0392b",
      radius: 8,
      border: "subtle",
      shadow: false,
      icons: true,
      layout: "inline",
    },
  },
  minimal: {
    label: "Minimal",
    look: {
      accent: "#303030",
      buttonText: "#ffffff",
      background: "#ffffff",
      text: "#303030",
      success: "#1f6f43",
      error: "#b3261e",
      radius: 2,
      border: "none",
      shadow: false,
      icons: false,
      layout: "inline",
    },
  },
  bold: {
    label: "Bold",
    look: {
      accent: "#005bd3",
      buttonText: "#ffffff",
      background: "#f1f6ff",
      text: "#0b1f44",
      success: "#0a7d32",
      error: "#c0392b",
      radius: 12,
      border: "strong",
      shadow: true,
      icons: true,
      layout: "inline",
    },
  },
  soft: {
    label: "Soft",
    look: {
      accent: "#d9480f",
      buttonText: "#ffffff",
      background: "#fff8f0",
      text: "#4a2c1a",
      success: "#2b7a3d",
      error: "#c0392b",
      radius: 20,
      border: "subtle",
      shadow: true,
      icons: true,
      layout: "stacked",
    },
  },
  dark: {
    label: "Dark",
    look: {
      accent: "#ffd166",
      buttonText: "#1a1a1a",
      background: "#1f1f1f",
      text: "#f5f5f5",
      success: "#6ee7a0",
      error: "#ff8a80",
      radius: 10,
      border: "none",
      shadow: true,
      icons: true,
      layout: "inline",
    },
  },
};

export const BASE_KEYS = Object.keys(PRESETS) as BaseKey[];

export const presetDesign = (key: BaseKey): Design => ({ preset: key, base: key, ...PRESETS[key].look });

export const DEFAULT_DESIGN: Design = presetDesign("classic");

const HEX = /^#[0-9a-fA-F]{6}$/;
const color = (v: any, fallback: string) =>
  typeof v === "string" && HEX.test(v) ? v.toLowerCase() : fallback;

// Bahar se aaya data (form / metafield) hamesha saaf karke use karo
export function sanitizeDesign(raw: any): Design {
  const r = raw && typeof raw === "object" ? raw : {};
  const base: BaseKey = BASE_KEYS.includes(r.base) ? r.base : BASE_KEYS.includes(r.preset) ? r.preset : "classic";
  const d = presetDesign(base);
  const radius = Number(r.radius);
  return {
    preset: r.preset === "custom" || BASE_KEYS.includes(r.preset) ? r.preset : base,
    base,
    accent: color(r.accent, d.accent),
    layout: r.layout === "stacked" ? "stacked" : r.layout === "inline" ? "inline" : d.layout,
    buttonText: color(r.buttonText, d.buttonText),
    background: color(r.background, d.background),
    text: color(r.text, d.text),
    success: color(r.success, d.success),
    error: color(r.error, d.error),
    radius: Number.isFinite(radius) ? Math.min(24, Math.max(0, Math.round(radius))) : d.radius,
    border: ["none", "subtle", "strong"].includes(r.border) ? r.border : d.border,
    shadow: typeof r.shadow === "boolean" ? r.shadow : d.shadow,
    icons: typeof r.icons === "boolean" ? r.icons : d.icons,
  };
}

// Free plan pe store pe yeh dikhega: preset ka look + merchant ka button color + layout
export function freeVersion(d: Design): Design {
  return { ...presetDesign(d.base), accent: d.accent, layout: d.layout };
}

// Design mein koi Pro-only badlav hai?
export function hasProChanges(d: Design) {
  const f = freeVersion(d);
  return (Object.keys(f) as (keyof Design)[]).some(
    (k) => !FREE_FIELDS.includes(k) && f[k] !== d[k],
  );
}

// Background dark hai? (input/border ke rang ke liye)
export function isDarkColor(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b < 140;
}