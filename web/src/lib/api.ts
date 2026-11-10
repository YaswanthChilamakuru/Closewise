export type ProposalStatus = "DRAFT" | "SENT" | "VIEWED" | "ACCEPTED" | "DECLINED";
export type ActivityType = "CREATED" | "EDITED" | "PUBLISHED" | "VIEWED" | "ACCEPTED" | "DECLINED";

export type User = { id: string; email: string; name: string; mcpUrl: string };

/** All amounts in minor units (paise/cents); `digits` = minor-unit digits of the currency. */
export type Totals = { base: number; optionalAll: number; optionalSelected: number; total: number };
export type Money = { currency: string; digits: number; amount: number };

export type ProposalRow = {
  id: string;
  title: string;
  clientName: string;
  status: ProposalStatus;
  source: "CLAUDE" | "MANUAL";
  currency: string;
  digits: number;
  totals: Totals;
  validUntil: string | null;
  updatedAt: string;
};

export type Stats = {
  openValue: Money[];
  openCount: number;
  acceptedThisMonth: Money[];
  acceptedThisMonthCount: number;
  acceptanceRate: number | null;
  acceptedCount: number;
  sentCount: number;
};

export type Section = { heading: string; body: string };
/** unitPrice in MAJOR units (e.g. 1500.5 rupees). */
export type LineItem = { id: string; name: string; description: string; quantity: number; unitPrice: number; optional: boolean };
export type Activity = { id: string; type: ActivityType; meta: Record<string, unknown>; createdAt: string };

export type Proposal = ProposalRow & {
  slug: string;
  clientEmail: string;
  sections: Section[];
  lineItems: LineItem[];
  activities: Activity[];
  acceptedBy: string | null;
  acceptedAt: string | null;
  selectedOptionalIds: string[];
  createdAt: string;
  editUrl: string;
  publicUrl: string;
  locked: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
/** Called when any request (other than sign-in itself) gets a 401. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body === undefined ? "GET" : "POST"),
      headers: opts.body === undefined ? undefined : { "content-type": "application/json" },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      credentials: "same-origin",
      keepalive: opts.keepalive,
    });
  } catch {
    throw new ApiError("Can't reach Closewise. Check your connection.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) onUnauthorized?.();
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}
