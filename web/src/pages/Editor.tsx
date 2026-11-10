import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { api, ApiError, type Activity, type Proposal } from "../lib/api";
import { formatDate, formatDateTime, formatMoney, lineTotalMinor, relativeTime, todayYmd } from "../lib/format";
import { Link } from "../lib/router";
import { usePolling } from "../lib/usePolling";
import { AppShell } from "../components/AppShell";
import { Markdown } from "../components/Markdown";
import { Button, ClaudeBadge, CopyButton, IconButton, Modal, Spinner, StatusBadge, cx, useToast } from "../components/ui";
import {
  IconAlert,
  IconArrowLeft,
  IconCheck,
  IconDown,
  IconExternal,
  IconPlus,
  IconSend,
  IconSparkle,
  IconTrash,
  IconUp,
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
      if (d && isDirty() && !Object.keys(validate(d)).length)
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

  // ---------------------------------------------------------------- render
  const errors = useMemo(() => (draft ? validate(draft) : {}), [draft]);

  if (loadError)
    return (
      <AppShell>
        <div className="card mx-auto max-w-md px-6 py-14 text-center">
          <h1 className="text-lg font-semibold">{loadError.status === 404 ? "Proposal not found" : "Couldn't load this proposal"}</h1>
          <p className="mt-2 text-sm text-zinc-500">
            {loadError.status === 404 ? "It may have been deleted, or it belongs to another account." : loadError.message}
          </p>
          <Link to="/" className="mt-6 inline-flex text-sm font-medium text-accent-600 hover:text-accent-700">
            ← Back to proposals
          </Link>
        </div>
      </AppShell>
    );

  if (!meta || !draft)
    return (
      <AppShell wide>
        <div className="flex items-center justify-center py-32 text-zinc-400">
          <Spinner className="size-6" />
        </div>
      </AppShell>
    );

  const locked = meta.locked;
  const published = meta.status !== "DRAFT";

  return (
    <AppShell wide>
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-500 hover:text-zinc-900">
          <IconArrowLeft className="size-4" />
          Proposals
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {!locked && <SaveIndicator state={saveState} onRetry={() => void flush()} />}
          <CopyButton
            text={meta.publicUrl}
            label="Copy public link"
            variant={published ? "primary" : "secondary"}
            toast={published ? "Public link copied" : "Link copied. It goes live once you publish."}
          />
          {!published ? (
            <Button variant="primary" onClick={() => (setPublishError(null), setPublishOpen(true))} disabled={locked}>
              <IconSend className="size-4" />
              Publish
            </Button>
          ) : (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-50 px-3 text-sm font-medium text-emerald-700 ring-1 ring-emerald-200 ring-inset">
              <IconCheck className="size-4" />
              Published
            </span>
          )}
        </div>
      </div>

      {/* Title */}
      <div className="mt-6">
        <input
          aria-label="Proposal title"
          className={cx(
            "w-full rounded-lg bg-transparent px-2 py-1 -mx-2 text-2xl font-semibold tracking-tight text-zinc-900 transition outline-none placeholder:text-zinc-300 hover:bg-white focus:bg-white focus:ring-3 focus:ring-accent-100 sm:text-3xl",
            errors.title && "ring-2 ring-rose-200"
          )}
          value={draft.title}
          placeholder="Proposal title"
          disabled={locked}
          onChange={(e) => update((d) => ({ ...d, title: e.target.value }))}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={meta.status} />
          {meta.source === "CLAUDE" && <ClaudeBadge />}
          <span className="text-sm text-zinc-500">Created {formatDate(meta.createdAt)}</span>
          {errors.title && <span className="text-sm text-rose-600">{errors.title}</span>}
        </div>
      </div>

      {locked && (
        <div
          className={cx(
            "mt-6 flex items-start gap-2 rounded-xl px-4 py-3 text-sm",
            meta.status === "ACCEPTED" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
          )}
        >
          <IconAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {meta.status === "ACCEPTED"
              ? `Accepted${meta.acceptedBy ? ` by ${meta.acceptedBy}` : ""}${meta.acceptedAt ? ` on ${formatDate(meta.acceptedAt)}` : ""}.`
              : "Declined by the client."}{" "}
            This proposal is final and can no longer be edited.
          </span>
        </div>
      )}

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-8">
          {/* Details */}
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
                hint={draft.validUntil && draft.validUntil < todayYmd() ? "In the past" : undefined}
                hintTone={draft.validUntil && draft.validUntil < todayYmd() ? "warn" : undefined}
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

          {/* Sections */}
          <SectionsEditor draft={draft} update={update} locked={locked} />

          {/* Pricing */}
          <LineItemsEditor draft={draft} update={update} locked={locked} meta={meta} errors={errors} />
        </div>

        {/* Sidebar */}
        <aside className="space-y-6 lg:sticky lg:top-20">
          <SummaryCard draft={draft} meta={meta} />
          <ActivityTimeline activities={meta.activities} acceptedBy={meta.acceptedBy} />
        </aside>
      </div>

      <Modal
        open={publishOpen}
        onClose={() => !publishing && setPublishOpen(false)}
        title={`Publish to ${draft.clientName || "your client"}?`}
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
        {publishError && (
          <div className="mt-4 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-rose-700" role="alert">
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

function Panel({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {action}
      </div>
      {children}
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

  const base = "inline-flex h-9 items-center gap-1.5 px-2 text-sm";
  switch (state.kind) {
    case "saving":
      return (
        <span className={cx(base, "text-zinc-500")}>
          <Spinner className="size-3.5" /> Saving…
        </span>
      );
    case "unsaved":
      return <span className={cx(base, "text-zinc-400")}>Unsaved changes</span>;
    case "invalid":
      return (
        <span className={cx(base, "text-amber-700")} title={state.message}>
          <IconAlert className="size-4" /> Not saved: {state.message.toLowerCase()}
        </span>
      );
    case "error":
      return (
        <span className={cx(base, "text-rose-600")}>
          <IconAlert className="size-4" />
          <span className="max-w-60 truncate" title={state.message}>
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
          <IconCheck className="size-4 text-emerald-600" /> Saved
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
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition focus-visible:ring-3 focus-visible:ring-accent-200 focus-visible:outline-none disabled:opacity-50",
        checked ? "bg-accent-600" : "bg-zinc-200"
      )}
    >
      <span className={cx("inline-block size-4 rounded-full bg-white shadow transition", checked ? "translate-x-4.5" : "translate-x-0.5")} />
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
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Sections</h2>
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

      <div className="space-y-4">
        {draft.sections.length === 0 && (
          <div className="card px-6 py-10 text-center text-sm text-zinc-500">No sections yet. Add an overview to get started.</div>
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
    <div className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5 sm:px-5">
        <span className="text-xs font-medium text-zinc-400 tabular-nums">{String(index + 1).padStart(2, "0")}</span>
        <input
          aria-label="Section heading"
          className={cx(
            "min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-1 font-semibold text-zinc-900 outline-none placeholder:text-zinc-300 focus:bg-zinc-50",
            !section.heading.trim() && "ring-1 ring-amber-300"
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
              className={cx("rounded-md px-2 py-1 capitalize", tab === t ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500")}
            >
              {t}
            </button>
          ))}
        </div>
        {!locked && (
          <div className="flex items-center">
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
            className="block min-h-40 w-full resize-none bg-transparent px-4 py-4 text-sm leading-relaxed text-zinc-800 outline-none placeholder:text-zinc-400 sm:px-5"
            value={section.body}
            placeholder={"Write in Markdown…\n\n- Deliverable one\n- Deliverable two"}
            disabled={locked}
            onChange={(e) => onChange({ body: e.target.value })}
          />
        </div>
        <div className={cx("bg-zinc-50/60 px-4 py-4 sm:px-5", tab === "write" && "hidden lg:block")}>
          <div className="mb-2 hidden text-[11px] font-medium tracking-wide text-zinc-400 uppercase lg:block">Preview</div>
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

const ROW_GRID = "md:grid md:grid-cols-[minmax(0,1fr)_72px_128px_116px_56px_88px] md:items-start md:gap-3";

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
    <Panel
      title="Pricing"
      action={<span className="rounded-md bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">{meta.currency}</span>}
    >
      <div className={cx("hidden px-1 pb-2 text-xs font-medium text-zinc-500", ROW_GRID)}>
        <span>Item</span>
        <span>Qty</span>
        <span>Unit price</span>
        <span className="text-right">Amount</span>
        <span className="text-center">Optional</span>
        <span />
      </div>

      <div className="divide-y divide-zinc-100 border-y border-zinc-100">
        {draft.lineItems.length === 0 && <p className="py-8 text-center text-sm text-zinc-500">No line items yet.</p>}
        {draft.lineItems.map((li, i) => {
          const qErr = errors[`qty:${li.id}`];
          const pErr = errors[`price:${li.id}`];
          return (
            <div key={li.id} className={cx("grid grid-cols-2 gap-3 px-1 py-3", ROW_GRID, li.optional && "bg-accent-50/40")}>
              <div className="col-span-2 md:col-span-1">
                <input
                  aria-label="Item name"
                  className={cx("field font-medium", !li.name.trim() && "border-amber-300")}
                  value={li.name}
                  placeholder="e.g. Logo design"
                  disabled={locked}
                  onChange={(e) => setItem(li.id, { name: e.target.value })}
                />
                <input
                  aria-label="Item description"
                  className="mt-1.5 block w-full rounded-md bg-transparent px-3 py-1 text-xs text-zinc-600 outline-none placeholder:text-zinc-400 focus:bg-white focus:ring-2 focus:ring-accent-100"
                  value={li.description}
                  placeholder="Add a short description (optional)"
                  disabled={locked}
                  onChange={(e) => setItem(li.id, { description: e.target.value })}
                />
                {li.optional && (
                  <span className="mt-1 ml-3 inline-flex items-center gap-1 text-[11px] font-medium text-accent-700">
                    <IconSparkle className="size-2.5" /> Optional: client can add it when accepting
                  </span>
                )}
              </div>
              <label className="block">
                <span className="label md:hidden">Qty</span>
                <input
                  aria-label="Quantity"
                  inputMode="decimal"
                  className={cx("field text-right tabular-nums", qErr && "field-invalid")}
                  title={qErr}
                  value={li.quantity}
                  disabled={locked}
                  onChange={(e) => setItem(li.id, { quantity: e.target.value })}
                />
              </label>
              <label className="block">
                <span className="label md:hidden">Unit price</span>
                <div className="relative">
                  <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-400">{symbol}</span>
                  <input
                    aria-label="Unit price"
                    inputMode="decimal"
                    className={cx("field text-right tabular-nums", symbol.length > 1 ? "pl-10" : "pl-7", pErr && "field-invalid")}
                    title={pErr}
                    value={li.unitPrice}
                    disabled={locked}
                    onChange={(e) => setItem(li.id, { unitPrice: e.target.value })}
                  />
                </div>
              </label>
              <div className="col-span-2 flex items-center justify-between md:col-span-1 md:block md:pt-2 md:text-right">
                <span className="text-xs text-zinc-500 md:hidden">Amount</span>
                <span className={cx("text-sm font-medium tabular-nums", li.optional ? "text-zinc-500" : "text-zinc-900")}>
                  {money(totals.lines.get(li.id) ?? 0)}
                </span>
              </div>
              <div className="flex items-center gap-2 md:justify-center md:pt-2">
                <Switch checked={li.optional} onChange={(v) => setItem(li.id, { optional: v })} disabled={locked} label="Optional add-on" />
                <span className="text-xs text-zinc-500 md:hidden">Optional</span>
              </div>
              {!locked && (
                <div className="flex items-center justify-end md:pt-1">
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
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
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
            <dd className="tabular-nums">{money(totals.base)}</dd>
          </div>
          {totals.optional > 0 && (
            <div className="flex justify-between text-zinc-500">
              <dt>Optional add-ons</dt>
              <dd className="tabular-nums">+ {money(totals.optional)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between border-t border-zinc-200 pt-2.5">
            <dt className="font-semibold text-zinc-900">Total</dt>
            <dd className="text-lg font-semibold tracking-tight text-zinc-900 tabular-nums">{money(totals.base)}</dd>
          </div>
          {totals.optional > 0 && (
            <p className="text-right text-xs text-zinc-500">Up to {money(totals.base + totals.optional)} with all add-ons</p>
          )}
        </dl>
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function SummaryCard({ draft, meta }: { draft: Draft; meta: Proposal }) {
  const totals = useTotals(draft, meta.digits);
  const money = (minor: number) => formatMoney(minor, meta.currency, meta.digits);
  const accepted = meta.status === "ACCEPTED";
  return (
    <div className="card p-5">
      <div className="text-xs font-medium text-zinc-500">{accepted ? "Accepted total" : "Proposal total"}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">
        {accepted ? money(meta.totals.total) : money(totals.base)}
      </div>
      {!accepted && totals.optional > 0 && <div className="text-xs text-zinc-500">+ {money(totals.optional)} optional</div>}
      <dl className="mt-5 space-y-2.5 border-t border-zinc-100 pt-4 text-sm">
        <Row label="Client">{draft.clientName || "–"}</Row>
        <Row label="Valid until">{draft.validUntil ? formatDate(draft.validUntil) : "No expiry"}</Row>
        <Row label="Line items">{draft.lineItems.length}</Row>
      </dl>
      <div className="mt-5 rounded-xl bg-zinc-50 p-3">
        <div className="flex items-center justify-between text-xs font-medium text-zinc-500">
          Public link
          {meta.status === "DRAFT" && <span className="text-amber-600">Not live yet</span>}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate text-xs text-zinc-700" title={meta.publicUrl}>
            {meta.publicUrl.replace(/^https?:\/\//, "")}
          </code>
          {meta.status !== "DRAFT" && (
            <a
              href={meta.publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-zinc-400 hover:text-zinc-700"
              aria-label="Open public page"
              title="Open public page"
            >
              <IconExternal className="size-4" />
            </a>
          )}
        </div>
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

function describe(a: Activity, acceptedBy: string | null): { title: string; detail?: string; dot: string } {
  const byClaude = a.meta?.via === "mcp";
  const by = byClaude ? " by Claude" : "";
  switch (a.type) {
    case "CREATED":
      return { title: `Created${by}`, dot: byClaude ? "bg-orange-400" : "bg-zinc-400" };
    case "EDITED": {
      const fields = Array.isArray(a.meta?.fields) ? (a.meta.fields as string[]).map((f) => FIELD_LABELS[f] ?? f) : [];
      return { title: `Edited${by}`, detail: fields.length ? `Changed ${fields.join(", ")}` : undefined, dot: byClaude ? "bg-orange-300" : "bg-zinc-300" };
    }
    case "PUBLISHED":
      return { title: `Published${by}`, detail: "Public link is live", dot: "bg-accent-500" };
    case "VIEWED":
      return { title: "Viewed by client", dot: "bg-amber-500" };
    case "ACCEPTED": {
      const name = (a.meta?.name as string | undefined) ?? acceptedBy;
      const addOns = Array.isArray(a.meta?.addOns) ? (a.meta.addOns as string[]) : [];
      return {
        title: name ? `Accepted by ${name}` : "Accepted",
        detail: addOns.length ? `With ${addOns.join(", ")}` : "No add-ons",
        dot: "bg-emerald-500",
      };
    }
    case "DECLINED": {
      const reason = a.meta?.reason as string | undefined;
      return { title: "Declined by client", detail: reason ? `“${reason}”` : undefined, dot: "bg-rose-500" };
    }
  }
}

function ActivityTimeline({ activities, acceptedBy }: { activities: Activity[]; acceptedBy: string | null }) {
  return (
    <div className="card p-5">
      <h2 className="text-sm font-semibold text-zinc-900">Activity</h2>
      {activities.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">No activity yet.</p>
      ) : (
        <ol className="mt-4">
          {activities.map((a, i) => {
            const d = describe(a, acceptedBy);
            return (
              <li key={a.id} className="relative flex gap-3 pb-5 last:pb-0">
                {i < activities.length - 1 && <span className="absolute top-3 bottom-0 left-[4.5px] w-px bg-zinc-200" aria-hidden />}
                <span className={cx("relative mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-white", d.dot)} />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-zinc-800">{d.title}</div>
                  {d.detail && <div className="truncate text-xs text-zinc-500">{d.detail}</div>}
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
