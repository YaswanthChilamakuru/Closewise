import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode, type TextareaHTMLAttributes } from "react";
import { api, ApiError, type Activity, type Proposal } from "../lib/api";
import { addDaysYmd, formatDate, formatDateTime, formatMoney, isExpiredYmd, lineTotalMinor, relativeTime, todayUtcYmd } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { usePolling } from "../lib/usePolling";
import { AppShell } from "../components/AppShell";
import { Markdown } from "../components/Markdown";
import { DeleteProposalDialog } from "../components/DeleteProposalDialog";
import { Button, ClaudeBadge, CopyButton, ExpiredBadge, IconButton, Modal, Skeleton, Spinner, StatusBadge, cx, useToast } from "../components/ui";
import {
  IconAlert,
  IconArrowLeft,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconDown,
  IconDuplicate,
  IconExternal,
  IconEye,
  IconFilePlus,
  IconPencil,
  IconPlus,
  IconSend,
  IconSparkle,
  IconTrash,
  IconUp,
  IconX,
} from "../components/icons";

// ---------------------------------------------------------------------------
// Draft model: what the user is editing. Numbers are kept as strings while typing.
// ---------------------------------------------------------------------------

type DraftSection = { key: string; heading: string; body: string };
type DraftItem = { id: string; name: string; description: string; quantity: string; unitPrice: string; optional: boolean };
type Draft = {
  title: string;
  clientName: string;
  clientEmail: string;
  validUntil: string; // "" = no expiry
  sections: DraftSection[];
  lineItems: DraftItem[];
};

// randomUUID needs a secure context (https/localhost); fall back to getRandomValues elsewhere.
const uid = (): string =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b: number) => b.toString(16).padStart(2, "0")).join("");

const fromServer = (p: Proposal): Draft => ({
  title: p.title,
  clientName: p.clientName,
  clientEmail: p.clientEmail,
  validUntil: p.validUntil ?? "",
  sections: p.sections.map((s) => ({ key: uid(), ...s })),
  lineItems: p.lineItems.map((li) => ({
    id: li.id,
    name: li.name,
    description: li.description,
    quantity: String(li.quantity),
    unitPrice: String(li.unitPrice),
    optional: li.optional,
  })),
});

const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

const toPayload = (d: Draft) => ({
  title: d.title.trim(),
  clientName: d.clientName.trim(),
  clientEmail: d.clientEmail.trim(),
  validUntil: d.validUntil || null,
  sections: d.sections.map(({ heading, body }) => ({ heading, body })),
  lineItems: d.lineItems.map((li) => ({
    id: li.id,
    name: li.name,
    description: li.description,
    quantity: num(li.quantity),
    unitPrice: num(li.unitPrice),
    optional: li.optional,
  })),
});

type Errors = Record<string, string>;
function validate(d: Draft): Errors {
  const e: Errors = {};
  if (!d.title.trim()) e.title = "Give the proposal a title";
  if (!d.clientName.trim()) e.clientName = "Client name is required";
  if (d.clientEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.clientEmail.trim())) e.clientEmail = "Enter a valid email";
  for (const li of d.lineItems) {
    const q = num(li.quantity);
    const p = num(li.unitPrice);
    if (!Number.isFinite(q) || q <= 0) e[`qty:${li.id}`] = "Quantity must be more than 0";
    if (!Number.isFinite(p) || p < 0) e[`price:${li.id}`] = "Enter a price (0 or more)";
  }
  return e;
}

type SaveState =
  | { kind: "saved"; at: number }
  | { kind: "unsaved" }
  | { kind: "saving" }
  | { kind: "invalid"; message: string }
  | { kind: "error"; message: string };

const AUTOSAVE_MS = 800;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Editor({ id }: { id: string }) {
  const toast = useToast();
  const [meta, setMeta] = useState<Proposal | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [saveState, setSaveState] = useState<SaveState>({ kind: "saved", at: Date.now() });
  const [publishOpen, setPublishOpen] = useState(false);

  // Autosave bookkeeping lives in refs so timers always see the latest values.
  const draftRef = useRef<Draft | null>(null);
  const version = useRef(0);
  const savedVersion = useRef(0);
  const inflight = useRef<Promise<boolean> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const syncedAt = useRef("");
  const lastStatus = useRef<string | null>(null);
  const deleted = useRef(false);

  const isDirty = () => version.current !== savedVersion.current;

  const applyServer = useCallback((p: Proposal, opts: { replaceDraft?: boolean } = {}) => {
    setMeta(p);
    if (opts.replaceDraft) {
      const d = fromServer(p);
      draftRef.current = d;
      setDraft(d);
      syncedAt.current = p.updatedAt;
    }
  }, []);

  // ---------------------------------------------------------------- load + poll
  useEffect(() => {
    let cancelled = false;
    api<{ proposal: Proposal }>(`/proposals/${id}`)
      .then((d) => {
        if (cancelled) return;
        applyServer(d.proposal, { replaceDraft: true });
        lastStatus.current = d.proposal.status;
      })
      .catch((err) => !cancelled && setLoadError({ status: err instanceof ApiError ? err.status : 0, message: err.message }));
    return () => {
      cancelled = true;
    };
  }, [id, applyServer]);

  usePolling(
    async () => {
      const { proposal: p } = await api<{ proposal: Proposal }>(`/proposals/${id}`);
      const changedElsewhere = p.updatedAt !== syncedAt.current;
      // Only pull remote content when there are no local edits in flight (e.g. Claude edited it).
      const clean = !isDirty() && !inflight.current;
      applyServer(p, { replaceDraft: changedElsewhere && clean });
      if (lastStatus.current && p.status !== lastStatus.current) {
        if (p.status === "VIEWED") toast(`${p.clientName} just opened the proposal`);
        if (p.status === "ACCEPTED") toast(`${p.clientName} accepted the proposal 🎉`);
        if (p.status === "DECLINED") toast(`${p.clientName} declined the proposal`, "error");
      } else if (changedElsewhere && clean && p.activities[0]?.meta?.via === "mcp") {
        toast("Updated with Claude's latest changes");
      }
      lastStatus.current = p.status;
    },
    10_000,
    !!meta
  );

  // ---------------------------------------------------------------- autosave
  const save = useCallback((): Promise<boolean> => {
    if (inflight.current) return inflight.current; // completion re-schedules if more edits arrived
    const d = draftRef.current;
    if (!d || !isDirty()) return Promise.resolve(true);
    const errors = validate(d);
    const first = Object.values(errors)[0];
    if (first) {
      setSaveState({ kind: "invalid", message: first });
      return Promise.resolve(false);
    }
    const v = version.current;
    setSaveState({ kind: "saving" });
    const run = (async () => {
      try {
        const { proposal } = await api<{ proposal: Proposal }>(`/proposals/${id}`, { method: "PATCH", body: toPayload(d) });
        savedVersion.current = v;
        syncedAt.current = proposal.updatedAt;
        setMeta(proposal);
        if (isDirty()) {
          setSaveState({ kind: "unsaved" });
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => void save(), 300);
        } else setSaveState({ kind: "saved", at: Date.now() });
        return true;
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "Couldn't save";
        setSaveState({ kind: "error", message });
        if (err instanceof ApiError && err.status === 409) {
          // Locked meanwhile (client accepted/declined): reload the read-only version.
          api<{ proposal: Proposal }>(`/proposals/${id}`)
            .then((r) => {
              savedVersion.current = version.current;
              applyServer(r.proposal, { replaceDraft: true });
            })
            .catch(() => {});
        }
        return false;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [id, applyServer]);

  const update = useCallback(
    (fn: (d: Draft) => Draft) => {
      const next = fn(draftRef.current!);
      draftRef.current = next;
      setDraft(next);
      version.current++;
      setSaveState({ kind: "unsaved" });
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
    },
    [save]
  );

  /** Save now and wait for everything to be persisted (used before publishing). */
  const flush = useCallback(async (): Promise<boolean> => {
    window.clearTimeout(timer.current);
    for (let i = 0; i < 5; i++) {
      if (inflight.current) {
        await inflight.current;
        window.clearTimeout(timer.current);
        continue;
      }
      if (!isDirty()) return true;
      if (!(await save())) return false;
    }
    return !isDirty();
  }, [save]);

  // Warn before leaving with unsaved edits; best-effort save when navigating away inside the app.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty() || inflight.current) e.preventDefault();
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void flush();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer.current);
      const d = draftRef.current;
      if (d && !deleted.current && isDirty() && !Object.keys(validate(d)).length)
        void api(`/proposals/${id}`, { method: "PATCH", body: toPayload(d), keepalive: true }).catch(() => {});
    };
  }, [id, flush]);

  // ---------------------------------------------------------------- publish
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  async function publish() {
    setPublishing(true);
    setPublishError(null);
    try {
      if (!(await flush())) throw new ApiError("Fix the highlighted fields first. Your latest changes aren't saved yet.", 400);
      const { proposal } = await api<{ proposal: Proposal }>(`/proposals/${id}/publish`, { method: "POST" });
      syncedAt.current = proposal.updatedAt;
      lastStatus.current = proposal.status;
      setMeta(proposal);
      setPublishOpen(false);
      toast("Published. Copy the link and send it to your client.");
    } catch (err) {
      setPublishError(err instanceof ApiError ? err.message : "Couldn't publish");
    } finally {
      setPublishing(false);
    }
  }

  // ---------------------------------------------------------------- duplicate
  const [duplicating, setDuplicating] = useState(false);
  async function duplicate() {
    setDuplicating(true);
    try {
      await flush(); // copy the latest saved content (invalid unsaved edits are skipped)
      const { proposal } = await api<{ proposal: Proposal }>(`/proposals/${id}/duplicate`, { method: "POST" });
      toast(`Duplicated as “${proposal.title}”`);
      navigate(`/proposals/${proposal.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't duplicate this proposal", "error");
      setDuplicating(false);
    }
  }

  // ---------------------------------------------------------------- delete
  const [deleteOpen, setDeleteOpen] = useState(false);
  function onDeleted() {
    // Stop autosave from touching a proposal that no longer exists, then leave.
    deleted.current = true;
    window.clearTimeout(timer.current);
    savedVersion.current = version.current;
    navigate("/", { replace: true });
  }

  // ---------------------------------------------------------------- render
  const errors = useMemo(() => (draft ? validate(draft) : {}), [draft]);

  if (loadError)
    return (
      <AppShell>
        <div className="card mx-auto max-w-md animate-pop-in px-6 py-14 text-center">
          <div className="mx-auto grid size-11 place-items-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-500">
            <IconAlert className="size-5" />
          </div>
          <h1 className="mt-4 text-base font-semibold text-ink">
            {loadError.status === 404 ? "Proposal not found" : "Couldn't load this proposal"}
          </h1>
          <p className="mt-1.5 text-sm text-zinc-500">
            {loadError.status === 404 ? "It may have been deleted, or it belongs to another account." : loadError.message}
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent-600 transition duration-150 hover:text-accent-700"
          >
            <IconArrowLeft className="size-4" /> Back to proposals
          </Link>
        </div>
      </AppShell>
    );

  if (!meta || !draft)
    return (
      <AppShell wide>
        <EditorSkeleton />
      </AppShell>
    );

  const locked = meta.locked;
  const published = meta.status !== "DRAFT";
  const expired = isExpiredYmd(draft.validUntil, meta.status);
  const openPublish = () => {
    setPublishError(null);
    setPublishOpen(true);
  };

  return (
    <AppShell wide>
      {/* Breadcrumb + save state */}
      <div className="flex min-h-9 items-center gap-2 text-sm">
        <Link to="/" className="inline-flex shrink-0 items-center gap-1.5 font-medium text-zinc-500 transition duration-150 hover:text-ink">
          <IconArrowLeft className="size-4" />
          Proposals
        </Link>
        <span className="text-zinc-300">/</span>
        <span className="min-w-0 truncate text-zinc-700">{draft.title || "Untitled"}</span>
        <div className="ml-auto shrink-0">{!locked && <SaveIndicator state={saveState} onRetry={() => void flush()} />}</div>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
        <div className="min-w-0 space-y-6">
          {/* Title */}
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <StatusBadge status={meta.status} />
              {expired && <ExpiredBadge />}
              {meta.source === "CLAUDE" && <ClaudeBadge />}
              <span className="ml-1 text-[13px] text-zinc-500">Created {formatDate(meta.createdAt)}</span>
            </div>
            <input
              aria-label="Proposal title"
              className={cx(
                "-mx-2.5 w-[calc(100%+1.25rem)] rounded-xl border border-transparent bg-transparent px-2.5 py-1.5 text-[26px] leading-tight font-semibold tracking-[-0.03em] text-ink transition duration-150 outline-none placeholder:text-zinc-300 hover:border-zinc-200 hover:bg-white focus:border-accent-500 focus:bg-white focus:ring-4 focus:ring-accent-500/10 disabled:hover:border-transparent disabled:hover:bg-transparent sm:text-[32px]",
                errors.title && "border-rose-300"
              )}
              value={draft.title}
              placeholder="Proposal title"
              disabled={locked}
              onChange={(e) => update((d) => ({ ...d, title: e.target.value }))}
            />
            {errors.title && <p className="mt-1 text-[13px] text-rose-600">{errors.title}</p>}
          </div>

          {locked && (
            <div
              className={cx(
                "flex animate-pop-in items-start gap-2.5 rounded-xl border px-4 py-3 text-sm",
                meta.status === "ACCEPTED" ? "border-success-200 bg-success-50 text-success-700" : "border-rose-200 bg-rose-50 text-rose-700"
              )}
            >
              {meta.status === "ACCEPTED" ? <IconCircleCheck className="mt-0.5 size-4 shrink-0" /> : <IconAlert className="mt-0.5 size-4 shrink-0" />}
              <span>
                {meta.status === "ACCEPTED"
                  ? `Accepted${meta.acceptedBy ? ` by ${meta.acceptedBy}` : ""}${meta.acceptedAt ? ` on ${formatDate(meta.acceptedAt)}` : ""}.`
                  : "Declined by the client."}{" "}
                This proposal is final and can no longer be edited.
              </span>
              <Button size="sm" onClick={duplicate} loading={duplicating} className="ml-auto shrink-0">
                {!duplicating && <IconDuplicate className="size-3.5" />}
                Duplicate
              </Button>
            </div>
          )}

          {expired && !locked && (
            <div className="flex animate-pop-in flex-col gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800 sm:flex-row sm:items-center">
              <span className="flex items-start gap-2.5">
                <IconClock className="mt-0.5 size-4 shrink-0" />
                <span>
                  <span className="font-medium">Expired on {formatDate(draft.validUntil)}.</span>{" "}
                  {published ? "The client can still view it but can't accept" : "Once published, the client won't be able to accept"} until
                  you extend the valid-until date.
                </span>
              </span>
              <div className="flex shrink-0 gap-2 sm:ml-auto">
                <Button size="sm" variant="dark" onClick={() => update((d) => ({ ...d, validUntil: addDaysYmd(todayUtcYmd(), 14) }))}>
                  Extend 14 days
                </Button>
                <Button size="sm" onClick={duplicate} loading={duplicating}>
                  Duplicate
                </Button>
              </div>
            </div>
          )}

          {/* Mobile/tablet actions (desktop has them in the sticky summary) */}
          <div className="flex flex-wrap gap-2 lg:hidden">
            <PublishControls published={published} locked={locked} onPublish={openPublish} />
            <CopyButton
              text={meta.publicUrl}
              label="Copy link"
              toast={published ? "Public link copied" : "Link copied. It goes live once you publish."}
            />
            <Button variant="ghost" onClick={duplicate} loading={duplicating}>
              {!duplicating && <IconDuplicate className="size-4" />}
              Duplicate
            </Button>
            {meta.source === "MANUAL" && (
              <Button variant="ghost" onClick={() => setDeleteOpen(true)} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700">
                <IconTrash className="size-4" />
                Delete
              </Button>
            )}
          </div>

          <Panel title="Client & validity">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Client name" error={errors.clientName}>
                <input
                  className={cx("field", errors.clientName && "field-invalid")}
                  value={draft.clientName}
                  disabled={locked}
                  onChange={(e) => update((d) => ({ ...d, clientName: e.target.value }))}
                />
              </Field>
              <Field label="Client email" hint="Optional" error={errors.clientEmail}>
                <input
                  type="email"
                  className={cx("field", errors.clientEmail && "field-invalid")}
                  value={draft.clientEmail}
                  placeholder="name@company.com"
                  disabled={locked}
                  onChange={(e) => update((d) => ({ ...d, clientEmail: e.target.value }))}
                />
              </Field>
              <Field
                label="Valid until"
                hint={expired ? "Expired" : draft.validUntil ? undefined : "No expiry"}
                hintTone={expired ? "warn" : undefined}
              >
                <input
                  type="date"
                  className="field"
                  value={draft.validUntil}
                  disabled={locked}
                  onChange={(e) => update((d) => ({ ...d, validUntil: e.target.value }))}
                />
              </Field>
            </div>
          </Panel>

          <SectionsEditor draft={draft} update={update} locked={locked} />
          <LineItemsEditor draft={draft} update={update} locked={locked} meta={meta} errors={errors} />
        </div>

        <aside className="space-y-4 lg:sticky lg:top-20">
          <SummaryCard
            draft={draft}
            meta={meta}
            published={published}
            locked={locked}
            expired={expired}
            onPublish={openPublish}
            onDuplicate={duplicate}
            duplicating={duplicating}
            onDelete={meta.source === "MANUAL" ? () => setDeleteOpen(true) : undefined}
          />
          <ActivityTimeline activities={meta.activities} acceptedBy={meta.acceptedBy} />
        </aside>
      </div>

      <DeleteProposalDialog
        target={deleteOpen ? { id: meta.id, title: draft.title || meta.title, status: meta.status } : null}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onDeleted}
      />

      <Modal
        open={publishOpen}
        onClose={() => !publishing && setPublishOpen(false)}
        title={`Publish to ${draft.clientName || "your client"}?`}
        icon={
          <span className="grid size-10 place-items-center rounded-xl bg-accent-50 text-accent-600 ring-1 ring-accent-200/60 ring-inset">
            <IconSend className="size-5" />
          </span>
        }
        footer={
          <>
            <Button onClick={() => setPublishOpen(false)} disabled={publishing}>
              Cancel
            </Button>
            <Button variant="primary" onClick={publish} loading={publishing}>
              Publish proposal
            </Button>
          </>
        }
      >
        <p>
          The public link starts working right away, and you'll see here when the client opens or accepts it. You can keep
          editing afterwards: changes go live immediately.
        </p>
        {expired && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5 text-orange-800">
            <IconClock className="mt-0.5 size-4 shrink-0" />
            <span>
              The valid-until date ({formatDate(draft.validUntil)}) has passed, so the client won't be able to accept. Use “Extend 14 days” first.
            </span>
          </div>
        )}
        {publishError && (
          <div className="mt-4 flex animate-pop-in items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-rose-700" role="alert">
            <IconAlert className="mt-0.5 size-4 shrink-0" />
            {publishError}
          </div>
        )}
      </Modal>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function EditorSkeleton() {
  return (
    <div>
      <Skeleton className="h-5 w-48" />
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <div>
            <Skeleton className="h-5 w-40 rounded-full" />
            <Skeleton className="mt-4 h-9 w-2/3" />
          </div>
          <div className="card space-y-4 p-6">
            <Skeleton className="h-4 w-32" />
            <div className="grid gap-4 sm:grid-cols-3">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          </div>
          <div className="card h-56 p-6">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-6 h-3 w-full" />
            <Skeleton className="mt-3 h-3 w-5/6" />
            <Skeleton className="mt-3 h-3 w-4/6" />
          </div>
        </div>
        <div className="card hidden h-80 p-6 lg:block">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="mt-4 h-9 w-40" />
          <Skeleton className="mt-8 h-10 w-full" />
          <Skeleton className="mt-2 h-10 w-full" />
        </div>
      </div>
    </div>
  );
}

function PublishControls({
  published,
  locked,
  onPublish,
  block,
}: {
  published: boolean;
  locked: boolean;
  onPublish: () => void;
  block?: boolean;
}) {
  if (!published)
    return (
      <Button variant="primary" size={block ? "lg" : "md"} onClick={onPublish} disabled={locked} className={cx(block && "w-full")}>
        <IconSend className="size-4" />
        Publish proposal
      </Button>
    );
  return (
    <span
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 text-sm font-medium text-zinc-700",
        block ? "h-10 w-full" : "h-9"
      )}
    >
      <IconCheck className="size-4 text-accent-600" />
      Published
    </span>
  );
}

function Panel({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-zinc-500">{description}</p>}
        </div>
        {action}
      </div>
      <div className="p-5 sm:p-6">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  hintTone,
  error,
  children,
}: {
  label: string;
  hint?: string;
  hintTone?: "warn";
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="label flex justify-between">
        {label}
        {hint && !error && <span className={cx("font-normal", hintTone === "warn" ? "text-amber-600" : "text-zinc-400")}>{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-rose-600">{error}</span>}
    </label>
  );
}

function SaveIndicator({ state, onRetry }: { state: SaveState; onRetry: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (state.kind !== "saved") return;
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [state.kind]);

  const base = "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] transition duration-150";
  switch (state.kind) {
    case "saving":
      return (
        <span className={cx(base, "text-zinc-500")}>
          <Spinner className="size-3.5" /> Saving…
        </span>
      );
    case "unsaved":
      return (
        <span className={cx(base, "text-zinc-500")}>
          <span className="size-1.5 rounded-full bg-amber-400" /> Unsaved changes
        </span>
      );
    case "invalid":
      return (
        <span className={cx(base, "max-w-[60vw] bg-amber-50 text-amber-700")} title={state.message}>
          <IconAlert className="size-3.5 shrink-0" />
          <span className="truncate">Not saved: {state.message.toLowerCase()}</span>
        </span>
      );
    case "error":
      return (
        <span className={cx(base, "max-w-[60vw] bg-rose-50 text-rose-700")}>
          <IconAlert className="size-3.5 shrink-0" />
          <span className="truncate" title={state.message}>
            {state.message}
          </span>
          <button type="button" onClick={onRetry} className="font-medium underline underline-offset-2 hover:text-rose-800">
            Retry
          </button>
        </span>
      );
    case "saved":
      return (
        <span className={cx(base, "text-zinc-500")} title={`Saved ${new Date(state.at).toLocaleTimeString()}`}>
          <IconCheck className="size-3.5" /> Saved
        </span>
      );
  }
}

function AutoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [props.value]);
  return <textarea ref={ref} rows={6} {...props} />;
}

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition duration-150 focus-visible:ring-3 focus-visible:ring-accent-500/25 disabled:opacity-50",
        checked ? "bg-accent-600" : "bg-zinc-200 hover:bg-zinc-300"
      )}
    >
      <span
        className={cx(
          "inline-block size-4 rounded-full bg-white shadow-[0_1px_2px_rgb(0_0_0/0.2)] transition duration-150",
          checked ? "translate-x-4.5" : "translate-x-0.5"
        )}
      />
    </button>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it);
  return next;
}

type UpdateFn = (fn: (d: Draft) => Draft) => void;

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function SectionsEditor({ draft, update, locked }: { draft: Draft; update: UpdateFn; locked: boolean }) {
  const setSection = (key: string, patch: Partial<DraftSection>) =>
    update((d) => ({ ...d, sections: d.sections.map((s) => (s.key === key ? { ...s, ...patch } : s)) }));

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Sections</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Markdown supported: **bold**, lists, links.</p>
        </div>
        {!locked && (
          <Button
            size="sm"
            onClick={() => update((d) => ({ ...d, sections: [...d.sections, { key: uid(), heading: "New section", body: "" }] }))}
            disabled={draft.sections.length >= 20}
          >
            <IconPlus className="size-3.5" />
            Add section
          </Button>
        )}
      </div>

      <div className="space-y-3">
        {draft.sections.length === 0 && (
          <div className="card flex flex-col items-center px-6 py-10 text-center">
            <IconPencil className="size-5 text-zinc-400" />
            <p className="mt-3 text-sm text-zinc-500">No sections yet. Add an overview to get started.</p>
          </div>
        )}
        {draft.sections.map((s, i) => (
          <SectionCard
            key={s.key}
            section={s}
            index={i}
            count={draft.sections.length}
            locked={locked}
            onChange={(patch) => setSection(s.key, patch)}
            onMove={(dir) => update((d) => ({ ...d, sections: move(d.sections, i, i + dir) }))}
            onRemove={() => update((d) => ({ ...d, sections: d.sections.filter((x) => x.key !== s.key) }))}
          />
        ))}
      </div>
    </section>
  );
}

function SectionCard({
  section,
  index,
  count,
  locked,
  onChange,
  onMove,
  onRemove,
}: {
  section: DraftSection;
  index: number;
  count: number;
  locked: boolean;
  onChange: (p: Partial<DraftSection>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [tab, setTab] = useState<"write" | "preview">("write");
  return (
    <div className="card group/section overflow-hidden transition duration-150 focus-within:border-zinc-300 focus-within:shadow-lift">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-3 py-2 sm:px-4">
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-zinc-100 text-[11px] font-semibold text-zinc-500 tabular-nums">
          {index + 1}
        </span>
        <input
          aria-label="Section heading"
          className={cx(
            "min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-[15px] font-semibold tracking-[-0.01em] text-ink transition duration-150 outline-none placeholder:text-zinc-300 hover:border-zinc-200 focus:border-accent-500 focus:ring-3 focus:ring-accent-500/10 disabled:hover:border-transparent",
            !section.heading.trim() && "border-amber-300"
          )}
          value={section.heading}
          placeholder="Section heading"
          disabled={locked}
          onChange={(e) => onChange({ heading: e.target.value })}
        />
        <div className="flex rounded-lg bg-zinc-100 p-0.5 text-xs font-medium lg:hidden">
          {(["write", "preview"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cx(
                "rounded-md px-2 py-1 capitalize transition duration-150",
                tab === t ? "bg-white text-ink shadow-[0_1px_2px_rgb(0_0_0/0.08)]" : "text-zinc-500"
              )}
            >
              {t}
            </button>
          ))}
        </div>
        {!locked && (
          <div className="flex items-center transition duration-150 lg:opacity-0 lg:group-focus-within/section:opacity-100 lg:group-hover/section:opacity-100">
            <IconButton label="Move up" onClick={() => onMove(-1)} disabled={index === 0}>
              <IconUp className="size-4" />
            </IconButton>
            <IconButton label="Move down" onClick={() => onMove(1)} disabled={index === count - 1}>
              <IconDown className="size-4" />
            </IconButton>
            <IconButton label="Delete section" onClick={onRemove} className="hover:bg-rose-50 hover:text-rose-600">
              <IconTrash className="size-4" />
            </IconButton>
          </div>
        )}
      </div>
      <div className="grid lg:grid-cols-2 lg:divide-x lg:divide-zinc-100">
        <div className={cx(tab === "preview" && "hidden lg:block")}>
          <AutoTextarea
            aria-label={`${section.heading || "Section"} content`}
            className="block min-h-40 w-full resize-none bg-transparent px-4 py-4 font-mono text-[13px] leading-relaxed text-zinc-700 outline-none placeholder:text-zinc-400 sm:px-5"
            value={section.body}
            placeholder={"Write in Markdown…\n\n- Deliverable one\n- Deliverable two"}
            disabled={locked}
            onChange={(e) => onChange({ body: e.target.value })}
          />
        </div>
        <div className={cx("bg-zinc-50/50 px-4 py-4 sm:px-5", tab === "write" && "hidden lg:block")}>
          <div className="mb-2 hidden text-[11px] font-medium tracking-wider text-zinc-400 uppercase lg:block">Preview</div>
          {section.body.trim() ? <Markdown>{section.body}</Markdown> : <p className="text-sm text-zinc-400 italic">Nothing to preview yet.</p>}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line items
// ---------------------------------------------------------------------------

function currencySymbol(currency: string) {
  try {
    return (
      new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? currency
    );
  } catch {
    return currency;
  }
}

function useTotals(draft: Draft, digits: number) {
  return useMemo(() => {
    let base = 0;
    let optional = 0;
    const lines = new Map<string, number>();
    for (const li of draft.lineItems) {
      const q = num(li.quantity);
      const p = num(li.unitPrice);
      const t = Number.isFinite(q) && Number.isFinite(p) && q > 0 && p >= 0 ? lineTotalMinor(q, p, digits) : 0;
      lines.set(li.id, t);
      if (li.optional) optional += t;
      else base += t;
    }
    return { base, optional, lines };
  }, [draft.lineItems, digits]);
}

const ROW_GRID = "md:grid md:grid-cols-[minmax(0,1fr)_72px_132px_112px_60px_84px] md:items-start md:gap-3";
// Inline-edit cells: quiet until hovered/focused.
const CELL =
  "block h-9 w-full rounded-lg border border-transparent bg-transparent px-2.5 text-sm text-ink transition duration-150 outline-none placeholder:text-zinc-400 hover:border-zinc-200 hover:bg-white focus:border-accent-500 focus:bg-white focus:ring-3 focus:ring-accent-500/10 disabled:hover:border-transparent disabled:hover:bg-transparent";

function LineItemsEditor({
  draft,
  update,
  locked,
  meta,
  errors,
}: {
  draft: Draft;
  update: UpdateFn;
  locked: boolean;
  meta: Proposal;
  errors: Errors;
}) {
  const totals = useTotals(draft, meta.digits);
  const money = (minor: number) => formatMoney(minor, meta.currency, meta.digits);
  const symbol = currencySymbol(meta.currency);
  const setItem = (id: string, patch: Partial<DraftItem>) =>
    update((d) => ({ ...d, lineItems: d.lineItems.map((li) => (li.id === id ? { ...li, ...patch } : li)) }));
  const addItem = (optional: boolean) =>
    update((d) => ({
      ...d,
      lineItems: [...d.lineItems, { id: uid(), name: "", description: "", quantity: "1", unitPrice: "0", optional }],
    }));

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-3.5 sm:px-6">
        <div>
          <h2 className="text-sm font-semibold text-ink">Pricing</h2>
          <p className="mt-0.5 text-xs text-zinc-500">Toggle “Optional” for add-ons the client can choose.</p>
        </div>
        <span className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 font-mono text-[11px] font-medium text-zinc-600">{meta.currency}</span>
      </div>

      <div className={cx("hidden border-b border-zinc-100 bg-zinc-50/60 px-3 py-2 text-xs font-medium text-zinc-500 sm:px-4", ROW_GRID)}>
        <span className="pl-2.5">Item</span>
        <span className="pr-2.5 text-right">Qty</span>
        <span className="pr-2.5 text-right">Unit price</span>
        <span className="text-right">Amount</span>
        <span className="text-center">Optional</span>
        <span />
      </div>

      <div className="divide-y divide-zinc-100">
        {draft.lineItems.length === 0 && (
          <div className="flex flex-col items-center px-6 py-10 text-center">
            <span className="grid size-10 place-items-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-400">
              <IconPlus className="size-4" />
            </span>
            <p className="mt-3 text-sm font-medium text-ink">No line items yet</p>
            <p className="mt-1 text-xs text-zinc-500">Add at least one priced item. Clients can't accept a proposal without one.</p>
          </div>
        )}
        {draft.lineItems.map((li, i) => {
          const qErr = errors[`qty:${li.id}`];
          const pErr = errors[`price:${li.id}`];
          return (
            <div
              key={li.id}
              className={cx(
                "group/row grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-3 transition duration-150 sm:px-4",
                ROW_GRID,
                li.optional ? "bg-accent-50/30 hover:bg-accent-50/60" : "hover:bg-zinc-50/70"
              )}
            >
              <div className="col-span-2 min-w-0 md:col-span-1">
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Item name"
                    className={cx(CELL, "font-medium", !li.name.trim() && "border-amber-300 bg-white")}
                    value={li.name}
                    placeholder="e.g. Logo design"
                    disabled={locked}
                    onChange={(e) => setItem(li.id, { name: e.target.value })}
                  />
                  {li.optional && (
                    <span className="hidden shrink-0 rounded-full bg-accent-100/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-accent-700 uppercase sm:inline-flex">
                      Add-on
                    </span>
                  )}
                </div>
                <input
                  aria-label="Item description"
                  className={cx(CELL, "mt-0.5 h-7 text-xs text-zinc-500")}
                  value={li.description}
                  placeholder="Add a short description (optional)"
                  disabled={locked}
                  onChange={(e) => setItem(li.id, { description: e.target.value })}
                />
              </div>
              <label className="block">
                <span className="label pl-2.5 md:hidden">Qty</span>
                <input
                  aria-label="Quantity"
                  inputMode="decimal"
                  className={cx(CELL, "money text-right", qErr && "border-rose-300 bg-white")}
                  title={qErr}
                  value={li.quantity}
                  disabled={locked}
                  onChange={(e) => setItem(li.id, { quantity: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="label pl-2.5 md:hidden">Unit price</span>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-zinc-400">{symbol}</span>
                  <input
                    aria-label="Unit price"
                    inputMode="decimal"
                    className={cx(CELL, "money text-right", symbol.length > 1 ? "pl-10" : "pl-6", pErr && "border-rose-300 bg-white")}
                    title={pErr}
                    value={li.unitPrice}
                    disabled={locked}
                    onChange={(e) => setItem(li.id, { unitPrice: e.target.value })}
                  />
                </div>
              </label>
              <div className="col-span-2 flex items-center justify-between px-2.5 md:col-span-1 md:block md:h-9 md:px-0 md:pt-2 md:text-right">
                <span className="text-xs text-zinc-500 md:hidden">Amount</span>
                <span className={cx("money text-sm font-medium", li.optional ? "text-zinc-500" : "text-ink")}>
                  {money(totals.lines.get(li.id) ?? 0)}
                </span>
              </div>
              <div className="flex items-center gap-2 px-2.5 md:h-9 md:justify-center md:px-0">
                <Switch checked={li.optional} onChange={(v) => setItem(li.id, { optional: v })} disabled={locked} label="Optional add-on" />
                <span className="text-xs text-zinc-500 md:hidden">Optional</span>
              </div>
              {!locked && (
                <div className="flex items-center justify-end transition duration-150 md:h-9 md:opacity-0 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100">
                  <IconButton label="Move up" onClick={() => update((d) => ({ ...d, lineItems: move(d.lineItems, i, i - 1) }))} disabled={i === 0}>
                    <IconUp className="size-4" />
                  </IconButton>
                  <IconButton
                    label="Move down"
                    onClick={() => update((d) => ({ ...d, lineItems: move(d.lineItems, i, i + 1) }))}
                    disabled={i === draft.lineItems.length - 1}
                  >
                    <IconDown className="size-4" />
                  </IconButton>
                  <IconButton
                    label="Remove item"
                    onClick={() => update((d) => ({ ...d, lineItems: d.lineItems.filter((x) => x.id !== li.id) }))}
                    className="hover:bg-rose-50 hover:text-rose-600"
                  >
                    <IconTrash className="size-4" />
                  </IconButton>
                </div>
              )}
              {(qErr || pErr || !li.name.trim()) && !locked && (
                <p className="col-span-2 -mt-1 px-2.5 text-xs md:col-span-6">
                  {qErr || pErr ? (
                    <span className="text-rose-600">{qErr || pErr}</span>
                  ) : (
                    <span className="text-amber-700">Add a name. It's required before publishing.</span>
                  )}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-6 border-t border-zinc-100 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        {!locked ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => addItem(false)} disabled={draft.lineItems.length >= 100}>
              <IconPlus className="size-3.5" /> Add item
            </Button>
            <Button size="sm" variant="ghost" onClick={() => addItem(true)} disabled={draft.lineItems.length >= 100}>
              <IconPlus className="size-3.5" /> Add optional add-on
            </Button>
          </div>
        ) : (
          <span />
        )}
        <dl className="w-full space-y-1.5 text-sm sm:w-72">
          <div className="flex justify-between text-zinc-600">
            <dt>Subtotal</dt>
            <dd className="money">{money(totals.base)}</dd>
          </div>
          {totals.optional > 0 && (
            <div className="flex justify-between text-zinc-500">
              <dt>Optional add-ons</dt>
              <dd className="money">+ {money(totals.optional)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between border-t border-zinc-200 pt-2.5">
            <dt className="font-medium text-ink">Total</dt>
            <dd className="money text-lg font-semibold text-ink">{money(totals.base)}</dd>
          </div>
          {totals.optional > 0 && <p className="money text-right text-xs text-zinc-500">Up to {money(totals.base + totals.optional)} with all add-ons</p>}
        </dl>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function SummaryCard({
  draft,
  meta,
  published,
  locked,
  expired,
  onPublish,
  onDuplicate,
  duplicating,
  onDelete,
}: {
  draft: Draft;
  meta: Proposal;
  published: boolean;
  locked: boolean;
  expired: boolean;
  onPublish: () => void;
  onDuplicate: () => void;
  duplicating: boolean;
  /** Only manually created proposals can be deleted (undefined for Claude-created ones). */
  onDelete?: () => void;
}) {
  const totals = useTotals(draft, meta.digits);
  const money = (minor: number) => formatMoney(minor, meta.currency, meta.digits);
  const accepted = meta.status === "ACCEPTED";
  return (
    <div className="card overflow-hidden">
      <div className="p-5">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium text-zinc-500">{accepted ? "Accepted total" : "Total"}</span>
          <span className="flex items-center gap-1.5">
            {expired && <ExpiredBadge />}
            <StatusBadge status={meta.status} />
          </span>
        </div>
        <div className={cx("money mt-1.5 text-[30px] leading-10 font-semibold tracking-[-0.03em]", accepted ? "text-success-600" : "text-ink")}>
          {accepted ? money(meta.totals.total) : money(totals.base)}
        </div>
        <div className="money h-5 text-[13px] text-zinc-500">
          {!accepted && totals.optional > 0 ? `+ ${money(totals.optional)} in optional add-ons` : ""}
        </div>

        <div className="mt-5 hidden space-y-2 lg:block">
          <PublishControls published={published} locked={locked} onPublish={onPublish} block />
          <CopyButton
            text={meta.publicUrl}
            label="Copy public link"
            size="lg"
            className="w-full"
            toast={published ? "Public link copied" : "Link copied. It goes live once you publish."}
          />
          <Button variant="ghost" className="w-full" onClick={onDuplicate} loading={duplicating}>
            {!duplicating && <IconDuplicate className="size-4" />}
            Duplicate proposal
          </Button>
        </div>
      </div>

      <div className="border-t border-zinc-100 bg-zinc-50/50 px-5 py-4">
        <dl className="space-y-2 text-[13px]">
          <Row label="Client">{draft.clientName || "–"}</Row>
          <Row label="Valid until">
            <span className={cx(expired && "text-orange-700")}>{draft.validUntil ? formatDate(draft.validUntil) : "No expiry"}</span>
          </Row>
          <Row label="Line items">{draft.lineItems.length}</Row>
        </dl>
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-2">
          <span className={cx("size-1.5 shrink-0 rounded-full", published ? "bg-accent-500" : "bg-zinc-300")} title={published ? "Live" : "Not live yet"} />
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-600" title={meta.publicUrl}>
            {meta.publicUrl.replace(/^https?:\/\//, "")}
          </code>
          {published ? (
            <a
              href={meta.publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 transition duration-150 hover:text-ink"
              aria-label="Open public page"
              title="Open public page"
            >
              <IconExternal className="size-3.5" />
            </a>
          ) : (
            <span className="text-[11px] font-medium whitespace-nowrap text-zinc-400">Not live</span>
          )}
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="mt-3 hidden w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-[13px] font-medium text-zinc-500 transition duration-150 hover:bg-rose-50 hover:text-rose-600 lg:flex"
          >
            <IconTrash className="size-3.5" />
            Delete proposal
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="truncate text-right font-medium text-zinc-800">{children}</dd>
    </div>
  );
}

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  clientName: "client",
  clientEmail: "client email",
  validUntil: "validity",
  sections: "sections",
  lineItems: "line items",
  currency: "currency",
};

type Described = { title: string; detail?: string; icon: ComponentType<{ className?: string }>; tone: string };

const CLAUDE_TONE = "bg-orange-50 text-[#D97757] ring-orange-200/70";
const NEUTRAL_TONE = "bg-white text-zinc-500 ring-zinc-200";

function describe(a: Activity, acceptedBy: string | null): Described {
  const byClaude = a.meta?.via === "mcp";
  const by = byClaude ? " by Claude" : "";
  switch (a.type) {
    case "CREATED": {
      const from = a.meta?.duplicatedTitle as string | undefined;
      return {
        title: from ? "Duplicated" : `Created${by}`,
        detail: from ? `From “${from}”` : undefined,
        icon: from ? IconDuplicate : byClaude ? IconSparkle : IconFilePlus,
        tone: byClaude ? CLAUDE_TONE : NEUTRAL_TONE,
      };
    }
    case "EDITED": {
      const fields = Array.isArray(a.meta?.fields) ? (a.meta.fields as string[]).map((f) => FIELD_LABELS[f] ?? f) : [];
      return {
        title: `Edited${by}`,
        detail: fields.length ? `Changed ${fields.join(", ")}` : undefined,
        icon: byClaude ? IconSparkle : IconPencil,
        tone: byClaude ? CLAUDE_TONE : NEUTRAL_TONE,
      };
    }
    case "PUBLISHED":
      return { title: `Published${by}`, detail: "Public link is live", icon: IconSend, tone: "bg-accent-50 text-accent-600 ring-accent-200/70" };
    case "VIEWED":
      return { title: "Viewed by client", icon: IconEye, tone: "bg-amber-50 text-amber-600 ring-amber-200/70" };
    case "ACCEPTED": {
      const name = (a.meta?.name as string | undefined) ?? acceptedBy;
      const addOns = Array.isArray(a.meta?.addOns) ? (a.meta.addOns as string[]) : [];
      return {
        title: name ? `Accepted by ${name}` : "Accepted",
        detail: addOns.length ? `With ${addOns.join(", ")}` : "No add-ons",
        icon: IconCheck,
        tone: "bg-success-50 text-success-600 ring-success-200/70",
      };
    }
    case "DECLINED": {
      const reason = a.meta?.reason as string | undefined;
      return { title: "Declined by client", detail: reason ? `“${reason}”` : undefined, icon: IconX, tone: "bg-rose-50 text-rose-600 ring-rose-200/70" };
    }
  }
}

function ActivityTimeline({ activities, acceptedBy }: { activities: Activity[]; acceptedBy: string | null }) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-ink">Activity</h2>
      {activities.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No activity yet.</p>
      ) : (
        <ol className="mt-4 max-h-[420px] overflow-y-auto pr-1">
          {activities.map((a, i) => {
            const d = describe(a, acceptedBy);
            const Icon = d.icon;
            return (
              <li key={a.id} className="relative flex gap-3 pb-5 last:pb-0">
                {i < activities.length - 1 && <span className="absolute top-7 bottom-1 left-[11.5px] w-px bg-zinc-200" aria-hidden />}
                <span className={cx("relative grid size-6 shrink-0 place-items-center rounded-full ring-1 ring-inset", d.tone)}>
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 pt-0.5">
                  <div className="text-[13px] leading-5 font-medium text-ink">{d.title}</div>
                  {d.detail && (
                    <div className="truncate text-xs text-zinc-500" title={d.detail}>
                      {d.detail}
                    </div>
                  )}
                  <time className="text-xs text-zinc-400" dateTime={a.createdAt} title={formatDateTime(a.createdAt)}>
                    {relativeTime(a.createdAt)}
                  </time>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
