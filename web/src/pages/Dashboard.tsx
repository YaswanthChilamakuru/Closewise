import { useCallback, useEffect, useState, type ComponentType } from "react";
import { ChevronRight } from "lucide-react";
import { api, ApiError, type Proposal, type ProposalRow, type Stats } from "../lib/api";
import { formatDate, formatMoney, formatMoneyList, relativeTime, todayYmd } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { usePolling } from "../lib/usePolling";
import { AppShell } from "../components/AppShell";
import { Avatar, Button, ClaudeBadge, Skeleton, StatusBadge, cx, useToast } from "../components/ui";
import { IconAlert, IconFilePlus, IconPlug, IconPlus, IconSparkle, IconTarget, IconTrending, IconWallet } from "../components/icons";

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
          <h1 className="text-[26px] leading-tight font-semibold tracking-[-0.03em] text-ink">Proposals</h1>
          <p className="mt-1.5 flex items-center gap-2 text-sm text-zinc-500">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent-400 opacity-50" />
              <span className="relative inline-flex size-2 rounded-full bg-accent-500" />
            </span>
            Live: views and acceptances appear automatically
          </p>
        </div>
        <Button variant="primary" onClick={createProposal} loading={creating} className="self-start sm:self-auto">
          {!creating && <IconPlus className="size-4" />}
          New proposal
        </Button>
      </div>

      {error && (
        <div className="mt-6 flex animate-pop-in items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <IconAlert className="size-4 shrink-0" />
          <span>
            {error}
            {data && <span className="text-rose-500"> Showing the last loaded data.</span>}
          </span>
        </div>
      )}

      <StatsRow stats={data?.stats} />

      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-ink">All proposals</h2>
          {data && data.proposals.length > 0 && (
            <span className="text-xs text-zinc-500">
              {data.proposals.length} {data.proposals.length === 1 ? "proposal" : "proposals"}
            </span>
          )}
        </div>
        {!data ? (
          <ListSkeleton />
        ) : data.proposals.length === 0 ? (
          <EmptyState onCreate={createProposal} creating={creating} />
        ) : (
          <div className="card overflow-hidden">
            <div className="hidden grid-cols-[minmax(0,1fr)_200px_130px_96px_20px] items-center gap-4 border-b border-zinc-100 bg-zinc-50/60 px-5 py-2.5 text-xs font-medium text-zinc-500 md:grid">
              <span>Proposal</span>
              <span>Status</span>
              <span className="text-right">Value</span>
              <span className="text-right">Updated</span>
              <span />
            </div>
            <ul className="divide-y divide-zinc-100">
              {data.proposals.map((p) => (
                <ProposalItem key={p.id} p={p} />
              ))}
            </ul>
          </div>
        )}
      </section>
    </AppShell>
  );
}

// ---------------------------------------------------------------- Stats

function StatsRow({ stats }: { stats?: Stats }) {
  const rate = stats?.acceptanceRate;
  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-3 sm:gap-4">
      <StatCard
        icon={IconWallet}
        label="Open value"
        values={stats ? formatMoneyList(stats.openValue, { compact: true }) : undefined}
        hint={stats && (stats.openCount ? `${stats.openCount} awaiting a response` : "Nothing out with clients")}
      />
      <StatCard
        icon={IconTrending}
        label="Accepted this month"
        values={stats ? formatMoneyList(stats.acceptedThisMonth, { compact: true }) : undefined}
        hint={stats && `${stats.acceptedThisMonthCount} ${stats.acceptedThisMonthCount === 1 ? "deal" : "deals"} won`}
        success
      />
      <StatCard
        icon={IconTarget}
        label="Acceptance rate"
        values={stats ? [rate == null ? "–" : `${Math.round(rate * 100)}%`] : undefined}
        hint={stats && (stats.sentCount ? `${stats.acceptedCount} of ${stats.sentCount} sent` : "No proposals sent yet")}
        meter={rate ?? undefined}
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  values,
  hint,
  success,
  meter,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  values?: string[];
  hint?: string | false;
  success?: boolean;
  meter?: number;
}) {
  const [primary, ...rest] = values ?? [];
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-zinc-500">{label}</span>
        <span
          className={cx(
            "grid size-7 place-items-center rounded-lg ring-1 ring-inset",
            success && primary ? "bg-success-50 text-success-600 ring-success-200/70" : "bg-zinc-50 text-zinc-500 ring-zinc-200/80"
          )}
        >
          <Icon className="size-4" />
        </span>
      </div>
      {values === undefined ? (
        <>
          <Skeleton className="mt-3 h-8 w-32" />
          <Skeleton className="mt-2.5 h-4 w-24" />
        </>
      ) : (
        <>
          <div className="money mt-2 truncate text-[28px] leading-9 font-semibold tracking-[-0.03em] text-ink">
            {primary ?? "–"}
            {rest.length > 0 && <span className="ml-2 align-middle text-sm font-medium tracking-normal text-zinc-500">+ {rest.join(" + ")}</span>}
          </div>
          <div className="mt-1 flex items-center gap-3">
            <span className="text-[13px] text-zinc-500">{hint || ""}</span>
            {meter !== undefined && (
              <span className="ml-auto h-1.5 w-16 overflow-hidden rounded-full bg-zinc-100">
                <span className="block h-full rounded-full bg-accent-500 transition-all duration-500" style={{ width: `${Math.round(meter * 100)}%` }} />
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- List

function ProposalItem({ p }: { p: ProposalRow }) {
  const amount = p.status === "ACCEPTED" ? p.totals.total : p.totals.base;
  const open = p.status === "SENT" || p.status === "VIEWED";
  const expired = open && p.validUntil && p.validUntil < todayYmd();
  const sub =
    p.status === "ACCEPTED"
      ? p.totals.optionalSelected
        ? `incl. ${formatMoney(p.totals.optionalSelected, p.currency, p.digits, { compact: true })} add-ons`
        : ""
      : p.totals.optionalAll
        ? `+ ${formatMoney(p.totals.optionalAll, p.currency, p.digits, { compact: true })} optional`
        : "";
  return (
    <li>
      <Link
        to={`/proposals/${p.id}`}
        className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-4 transition duration-150 hover:bg-zinc-50/80 focus-visible:bg-zinc-50 sm:px-5 md:grid-cols-[minmax(0,1fr)_200px_130px_96px_20px] md:py-3.5"
      >
        {/* Proposal */}
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={p.clientName} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">{p.title}</div>
            <div className="truncate text-[13px] text-zinc-500">
              {p.clientName}
              {p.validUntil && open && (
                <span className={cx("hidden sm:inline", expired && "text-rose-600")}>
                  {" · "}
                  {expired ? "Expired" : "Valid until"} {formatDate(p.validUntil)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Value (mobile: top right) */}
        <div className="text-right md:order-3">
          <div className="money text-sm font-semibold text-ink">{formatMoney(amount, p.currency, p.digits, { compact: true })}</div>
          {sub && <div className="money truncate text-xs text-zinc-500">{sub}</div>}
        </div>

        {/* Status */}
        <div className="col-span-2 flex flex-wrap items-center gap-1.5 pl-12 md:order-2 md:col-span-1 md:pl-0">
          <StatusBadge status={p.status} />
          {p.source === "CLAUDE" && <ClaudeBadge />}
          <span className="ml-auto text-xs text-zinc-500 md:hidden">{relativeTime(p.updatedAt)}</span>
        </div>

        <span className="hidden text-right text-[13px] text-zinc-500 md:order-4 md:block" title={new Date(p.updatedAt).toLocaleString()}>
          {relativeTime(p.updatedAt)}
        </span>
        <ChevronRight
          className="hidden size-4 text-zinc-300 transition duration-150 group-hover:translate-x-0.5 group-hover:text-zinc-500 md:order-5 md:block"
          strokeWidth={1.75}
          aria-hidden
        />
      </Link>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="card divide-y divide-zinc-100 overflow-hidden">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-4">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-1/2 max-w-64" />
            <Skeleton className="mt-2 h-3 w-1/4 max-w-32" />
          </div>
          <Skeleton className="hidden h-5 w-16 rounded-full md:block" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCreate, creating }: { onCreate: () => void; creating: boolean }) {
  return (
    <div className="card relative overflow-hidden px-6 py-16 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(50%_100%_at_50%_0%,rgb(99_102_241/0.10),transparent)]"
      />
      <div className="relative mx-auto grid size-12 place-items-center rounded-xl border border-zinc-200 bg-white text-accent-600 shadow-card">
        <IconFilePlus className="size-5" />
      </div>
      <h3 className="relative mt-5 text-base font-semibold text-ink">No proposals yet</h3>
      <p className="relative mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-500">
        Connect Closewise to your Claude and ask it to draft one. It shows up here within seconds. Or start from scratch.
      </p>
      <div className="relative mt-6 flex flex-wrap justify-center gap-2">
        <Link
          to="/connect"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent-600 px-3.5 text-sm font-medium text-white shadow-[0_1px_2px_rgb(79_70_229/0.3)] transition duration-150 hover:bg-accent-700"
        >
          <IconPlug className="size-4" />
          Connect to Claude
        </Link>
        <Button onClick={onCreate} loading={creating}>
          Start from scratch
        </Button>
      </div>
      <p className="relative mt-8 inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-500">
        <IconSparkle className="size-3 text-[#D97757]" />
        Try: “Draft a proposal for a logo design for Acme Corp, ₹25,000.”
      </p>
    </div>
  );
}
