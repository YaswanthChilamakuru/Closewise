import type { Money } from "./api";

const locale = (currency: string) => (currency === "INR" ? "en-IN" : "en-US");

/** Minor units → "₹25,000.00" (Indian digit grouping for INR, like the server). */
export function formatMoney(minor: number, currency: string, digits: number, opts: { compact?: boolean } = {}): string {
  const major = minor / 10 ** digits;
  const wholeOnly = opts.compact && Number.isInteger(major);
  try {
    return new Intl.NumberFormat(locale(currency), {
      style: "currency",
      currency,
      minimumFractionDigits: wholeOnly ? 0 : digits,
      maximumFractionDigits: wholeOnly ? 0 : digits,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(digits)}`;
  }
}

export const formatMoneyList = (list: Money[], opts?: { compact?: boolean }) =>
  list.map((m) => formatMoney(m.amount, m.currency, m.digits, opts));

/** Mirrors the server's Math.round(quantity × unitPriceMinor). */
export function lineTotalMinor(quantity: number, unitPriceMajor: number, digits: number): number {
  return Math.round(quantity * Math.round(unitPriceMajor * 10 ** digits));
}

export function relativeTime(iso: string, now = Date.now()): string {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return formatDate(iso);
}

export function formatDate(isoOrYmd: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(isoOrYmd) ? new Date(`${isoOrYmd}T00:00:00Z`) : new Date(isoOrYmd);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: /^\d{4}-\d{2}-\d{2}$/.test(isoOrYmd) ? "UTC" : undefined,
  });
}

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Today in UTC as YYYY-MM-DD. Matches the server: a quote is valid through its validUntil (UTC) day. */
export const todayUtcYmd = () => new Date().toISOString().slice(0, 10);

/** YYYY-MM-DD + n days (UTC). */
export function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Expired = valid-until day has passed and the client hasn't answered. */
export const isExpiredYmd = (validUntil: string | null | undefined, status: string) =>
  !!validUntil && status !== "ACCEPTED" && status !== "DECLINED" && validUntil < todayUtcYmd();

/** Today's date as YYYY-MM-DD in the viewer's timezone. */
export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
