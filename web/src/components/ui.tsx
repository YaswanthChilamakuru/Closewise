import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import type { ProposalStatus } from "../lib/api";
import { IconAlert, IconCheck, IconCopy, IconSparkle, IconX } from "./icons";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
export { cx };

// ---------------------------------------------------------------- Button

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dark";
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent-600 text-white shadow-[0_1px_2px_rgb(79_70_229/0.3),inset_0_1px_0_rgb(255_255_255/0.12)] hover:bg-accent-700 focus-visible:ring-accent-500/30",
  dark: "bg-ink text-white shadow-[0_1px_2px_rgb(11_11_15/0.2)] hover:bg-zinc-800 focus-visible:ring-zinc-400/40",
  secondary:
    "border border-zinc-200 bg-white text-zinc-800 shadow-[0_1px_1px_rgb(11_11_15/0.04)] hover:border-zinc-300 hover:bg-zinc-50 focus-visible:ring-zinc-300/50",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-ink focus-visible:ring-zinc-300/50",
  danger: "bg-rose-600 text-white shadow-xs hover:bg-rose-700 focus-visible:ring-rose-500/30",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean };

export function Button({ variant = "secondary", size = "md", loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition duration-150 select-none focus-visible:ring-4 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-[13px]" : size === "lg" ? "h-10 px-4 text-sm" : "h-9 px-3.5 text-sm",
        VARIANTS[variant],
        className
      )}
      {...rest}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "inline-flex size-7 items-center justify-center rounded-md text-zinc-400 transition duration-150 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:ring-3 focus-visible:ring-zinc-300/60 disabled:pointer-events-none disabled:opacity-30",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className ?? "size-4")} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}

// ---------------------------------------------------------------- Pills, chips, avatars

const STATUS: Record<ProposalStatus, { label: string; cls: string; dot: string }> = {
  DRAFT: { label: "Draft", cls: "bg-zinc-100 text-zinc-600 ring-zinc-200/80", dot: "bg-zinc-400" },
  SENT: { label: "Sent", cls: "bg-accent-50 text-accent-700 ring-accent-200/70", dot: "bg-accent-500" },
  VIEWED: { label: "Viewed", cls: "bg-amber-50 text-amber-700 ring-amber-200/80", dot: "bg-amber-500" },
  ACCEPTED: { label: "Accepted", cls: "bg-success-50 text-success-700 ring-success-200/80", dot: "bg-success-500" },
  DECLINED: { label: "Declined", cls: "bg-rose-50 text-rose-700 ring-rose-200/80", dot: "bg-rose-500" },
};

export function StatusBadge({ status, className }: { status: ProposalStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <span
      className={cx(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        s.cls,
        className
      )}
    >
      <span className={cx("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function ClaudeBadge() {
  return (
    <span
      className="inline-flex h-[22px] items-center gap-1 rounded-full border border-zinc-200 bg-white px-1.5 text-[11px] font-medium whitespace-nowrap text-zinc-600"
      title="Drafted by your Claude over MCP"
    >
      <IconSparkle className="size-3 text-[#D97757]" />
      via Claude
    </span>
  );
}

const AVATAR_TONES = [
  "bg-accent-50 text-accent-700",
  "bg-sky-50 text-sky-700",
  "bg-violet-50 text-violet-700",
  "bg-amber-50 text-amber-700",
  "bg-rose-50 text-rose-700",
  "bg-teal-50 text-teal-700",
  "bg-zinc-100 text-zinc-700",
];

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  if (!words.length) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <span
      className={cx(
        "inline-grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 ring-black/5 ring-inset",
        AVATAR_TONES[h % AVATAR_TONES.length],
        className
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------- Toasts

type Toast = { id: number; message: string; tone: "success" | "error" };
const ToastContext = createContext<(message: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 6000 : 2800);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:right-4 sm:left-auto sm:items-end"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex w-full max-w-sm animate-pop-in items-start gap-2.5 rounded-xl border border-zinc-200/80 bg-white px-3.5 py-3 text-sm text-ink shadow-pop"
          >
            {t.tone === "success" ? (
              <span className="mt-px grid size-[18px] shrink-0 place-items-center rounded-full bg-success-500 text-white">
                <IconCheck className="size-3" strokeWidth={3} />
              </span>
            ) : (
              <IconAlert className="mt-px size-[18px] shrink-0 text-rose-600" />
            )}
            <span className="leading-snug">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------- Copy

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyButton({
  text,
  label = "Copy",
  toast,
  variant = "secondary",
  size = "md",
  className,
}: {
  text: string;
  label?: string;
  toast?: string;
  variant?: Variant;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const notify = useToast();
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          if (toast) notify(toast);
        } else notify("Couldn't copy. Select the text and copy it manually.", "error");
      }}
    >
      {copied ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

// ---------------------------------------------------------------- Modal

export function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0 animate-fade-in bg-ink/30 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-md animate-pop-in rounded-2xl border border-zinc-200/60 bg-white p-6 shadow-pop">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-4 right-4 inline-flex size-7 items-center justify-center rounded-md text-zinc-400 transition duration-150 hover:bg-zinc-100 hover:text-zinc-700"
        >
          <IconX className="size-4" />
        </button>
        {icon && <div className="mb-4">{icon}</div>}
        <h2 className="pr-8 text-base font-semibold text-ink">{title}</h2>
        <div className="mt-2 text-sm leading-relaxed text-zinc-600">{children}</div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>
      </div>
    </div>
  );
}
