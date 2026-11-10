import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type Proposal, type ProposalRow, type Stats } from "../lib/api";
import { formatDate, formatMoney, formatMoneyList, relativeTime, todayYmd } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { usePolling } from "../lib/usePolling";
import { AppShell } from "../components/AppShell";
import { Button, ClaudeBadge, StatusBadge, cx, useToast } from "../components/ui";
import { IconAlert, IconClock, IconFile, IconPlug, IconPlus, IconSparkle } from "../components/icons";

type Data = { proposals: ProposalRow[]; stats: Stats };

export default function Dashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [, setNow] = useState(Date.now()); // re-render relative times
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setData(await api<Data>("/proposals"));
      setError(null);
      setNow(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load proposals");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  usePolling(load, 10_000);

  async function createProposal() {
    setCreating(true);
    try {
      const d = await api<{ proposal: Proposal }>("/proposals", { method: "POST" });
      navigate(`/proposals/${d.proposal.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't create a proposal", "error");
      setCreating(false);
    }
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Proposals</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            Live: views and acceptances show up here automatically.
          </p>
        </div>
        <Button variant="primary" onClick={createProposal} loading={creating}>
          {!creating && <IconPlus className="size-4" />}
          New proposal
        </Button>
      </div>

      {error && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <IconAlert className="size-4 shrink-0" />
          {error}
          {data && <span className="text-rose-500">Showing the last loaded data.</span>}
        </div>
      )}

      <StatsRow stats={data?.stats} />

      <div className="mt-10">
        {!data ? (
          <CardSkeletons />
        ) : data.proposals.length === 0 ? (
          <EmptyState onCreate={createProposal} creating={creating} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.proposals.map((p) => (
              <ProposalCard key={p.id} p={p} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------- Stats

function StatsRow({ stats }: { stats?: Stats }) {
  const rate = stats?.acceptanceRate;
  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-3">
      <StatCard
        label="Open value"
        values={stats ? formatMoneyList(stats.openValue, { compact: true }) : undefined}
        hint={stats && (stats.openCount ? `${stats.openCount} awaiting a response` : "Nothing out with clients")}
      />
      <StatCard
        label="Accepted this month"
        values={stats ? formatMoneyList(stats.acceptedThisMonth, { compact: true }) : undefined}
        hint={stats && `${stats.acceptedThisMonthCount} ${stats.acceptedThisMonthCount === 1 ? "deal" : "deals"} won`}
        accent
      />
      <StatCard
        label="Acceptance rate"
        values={stats ? [rate == null ? "–" : `${Math.round(rate * 100)}%`] : undefined}
        hint={stats && (stats.sentCount ? `${stats.acceptedCount} of ${stats.sentCount} sent` : "No proposals sent yet")}
      />
    </div>
  );
}

function StatCard({ label, values, hint, accent }: { label: string; values?: string[]; hint?: string | false; accent?: boolean }) {
  const [primary, ...rest] = values ?? [];
  return (
    <div className="card p-5">
      <div className="text-sm font-medium text-zinc-500">{label}</div>
      {values === undefined ? (
        <div className="mt-3 h-8 w-32 animate-pulse rounded-md bg-zinc-100" />
      ) : (
        <div className={cx("mt-2 text-[1.7rem] leading-9 font-semibold tracking-tight tabular-nums", accent && primary ? "text-emerald-600" : "text-zinc-900")}>
          {primary ?? "–"}
          {rest.length > 0 && <span className="ml-2 align-middle text-sm font-medium text-zinc-500">+ {rest.join(" + ")}</span>}
        </div>
      )}
      <div className="mt-1 h-5 text-sm text-zinc-500">{hint || ""}</div>
    </div>
  );
}

// ---------------------------------------------------------------- Cards

function ProposalCard({ p }: { p: ProposalRow }) {
  const amount = p.status === "ACCEPTED" ? p.totals.total : p.totals.base;
  const open = p.status === "SENT" || p.status === "VIEWED";
  const expired = open && p.validUntil && p.validUntil < todayYmd();
  return (
    <Link
      to={`/proposals/${p.id}`}
      className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:border-zinc-300 hover:shadow-md focus-visible:ring-3 focus-visible:ring-accent-200 focus-visible:outline-none"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge status={p.status} />
        {p.source === "CLAUDE" && <ClaudeBadge />}
      </div>
      <h3 className="mt-3 line-clamp-2 font-semibold text-zinc-900 group-hover:text-accent-700">{p.title}</h3>
      <p className="mt-1 truncate text-sm text-zinc-500">{p.clientName}</p>

      <div className="mt-auto pt-6">
        <div className="text-xl font-semibold tracking-tight text-zinc-900 tabular-nums">
          {formatMoney(amount, p.currency, p.digits, { compact: true })}
        </div>
        <div className="h-5 text-xs text-zinc-500">
          {p.status === "ACCEPTED"
            ? p.totals.optionalSelected
              ? `incl. ${formatMoney(p.totals.optionalSelected, p.currency, p.digits, { compact: true })} add-ons`
              : ""
            : p.totals.optionalAll
              ? `+ ${formatMoney(p.totals.optionalAll, p.currency, p.digits, { compact: true })} optional`
              : ""}
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 text-xs text-zinc-500">
          <span className="flex items-center gap-1" title={new Date(p.updatedAt).toLocaleString()}>
            <IconClock className="size-3.5" />
            Updated {relativeTime(p.updatedAt)}
          </span>
          {p.validUntil && open && (
            <span className={cx(expired && "font-medium text-rose-600")}>
              {expired ? "Expired" : "Valid until"} {formatDate(p.validUntil)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

function CardSkeletons() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="card h-52 animate-pulse p-5">
          <div className="h-5 w-16 rounded-full bg-zinc-100" />
          <div className="mt-4 h-4 w-3/4 rounded bg-zinc-100" />
          <div className="mt-2 h-3 w-1/3 rounded bg-zinc-100" />
          <div className="mt-12 h-6 w-28 rounded bg-zinc-100" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCreate, creating }: { onCreate: () => void; creating: boolean }) {
  return (
    <div className="card flex flex-col items-center px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-accent-50 text-accent-600">
        <IconFile className="size-6" />
      </div>
      <h2 className="mt-5 text-lg font-semibold text-zinc-900">No proposals yet</h2>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-zinc-500">
        Connect Closewise to your Claude and ask it to draft one. It'll appear here within seconds. Or start from scratch.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link
          to="/connect"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 text-sm font-medium text-white shadow-xs transition hover:bg-accent-700"
        >
          <IconPlug className="size-4" />
          Connect to Claude
        </Link>
        <Button onClick={onCreate} loading={creating}>
          Start from scratch
        </Button>
      </div>
      <p className="mt-8 flex items-center gap-1.5 text-xs text-zinc-400">
        <IconSparkle className="size-3 text-orange-400" />
        Try: "Draft a proposal for a logo design for Acme Corp, ₹25,000."
      </p>
    </div>
  );
}
