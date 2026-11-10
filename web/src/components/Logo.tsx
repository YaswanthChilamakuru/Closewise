import { useId } from "react";
import { cx } from "./ui";

/** The mark's single stroke: a check whose long arm flows into a rounded "C" (24×24 box). */
export const MARK_PATH = "M8.25 12.4 11.4 15.55 19.1 7.35A8.5 8.5 0 1 0 18.7 17.23";

export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 32 32" className={cx("shrink-0", className ?? "size-7")} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366F1" />
          <stop offset="1" stopColor="#4338CA" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <path
        transform="translate(4 4)"
        d={MARK_PATH}
        fill="none"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2", className)}>
      <LogoMark className={markClassName} />
      <span className="text-[15px] font-semibold tracking-[-0.02em] text-ink">Closewise</span>
    </span>
  );
}
