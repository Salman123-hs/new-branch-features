// Har desh ke postal code ka pattern (normalize hone ke baad: capital, bina space/dash)
const PATTERNS: Record<string, RegExp> = {
  IN: /^\d{6}$/,                          // 452001
  US: /^\d{5}$/,                          // 90210 (ZIP+4 ko 5 digit bana dete hain)
  GB: /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/, // SW1A1AA
  CA: /^[A-Z]\d[A-Z]\d[A-Z]\d$/,          // K1A0B1
  AU: /^\d{4}$/,                          // 2000
  DE: /^\d{5}$/,                          // 10115
  FR: /^\d{5}$/,                          // 75001
  NL: /^\d{4}[A-Z]{2}$/,                  // 1012AB
  JP: /^\d{7}$/,                          // 1000001
};

// Jo desh list mein nahi, uske liye basic check
const FALLBACK = /^[A-Z0-9]{3,10}$/;

// "in", " gb " → "IN", "GB"; khaali ho to "IN"
export function normalizeCountry(raw: unknown): string {
  const c = String(raw ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : "IN";
}

// "sw1a 1aa" → "SW1A1AA", "452-001" → "452001", "90210-1234" (US) → "90210"
export function normalizePostcode(raw: unknown, country: string): string {
  let code = String(raw ?? "").toUpperCase().replace(/[\s-]/g, "");
  if (country === "US" && /^\d{9}$/.test(code)) code = code.slice(0, 5);
  return code;
}

export function isValidPostcode(code: string, country: string): boolean {
  return (PATTERNS[country] ?? FALLBACK).test(code);
}