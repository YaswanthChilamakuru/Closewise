import { useEffect, useRef, useState } from "react";
import { formatMoney } from "../lib/format";
import { cx } from "./ui";

// Decorative, hardcoded demo for the login page. No real data, no network requests.

type Sample = { title: string; baseItem: string; base: number; addOn: { name: string; amount: number } };

/** Amounts in paise (INR minor units). Generic examples only: no company, brand or person names. */
const SAMPLES: Sample[] = [
  { title: "Website redesign", baseItem: "Design & development", base: 12_000_000, addOn: { name: "SEO setup", amount: 2_000_000 } },
  { title: "Brand identity package", baseItem: "Logo & identity design", base: 4_500_000, addOn: { name: "Brand guidelines", amount: 800_000 } },
  { title: "Mobile app MVP", baseItem: "App design & build", base: 25_000_000, addOn: { name: "3 months support", amount: 3_000_000 } },
];

const SLIDE_MS = 4000;
// Timeline within one slide (ms from slide start).
const T_IN = 40; // fade/slide in
const T_TICK = 1100; // checkbox ticks on
const T_COUNT = 1300; // total starts counting up
const COUNT_MS = 750;
const T_ACCEPT = 2200; // pill: Viewed → Accepted
const T_OUT = 3650; // fade/slide out

const inr = (minor: number) => formatMoney(Math.round(minor / 100) * 100, "INR", 2, { compact: true });

function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function ProposalPreview() {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);
  const [checked, setChecked] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [total, setTotal] = useState(SAMPLES[0].base);
  const [counting, setCounting] = useState(false);
  const raf = useRef(0);

  const s = SAMPLES[index];

  useEffect(() => {
    const sample = SAMPLES[index];
    if (reduced) {
      // Static final state, no rotation or movement.
      setVisible(true);
      setChecked(true);
      setAccepted(true);
      setCounting(false);
      setTotal(sample.base + sample.addOn.amount);
      return;
    }
    setVisible(false);
    setChecked(false);
    setAccepted(false);
    setCounting(false);
    setTotal(sample.base);

    const timers = [
      window.setTimeout(() => setVisible(true), T_IN),
      window.setTimeout(() => setChecked(true), T_TICK),
      window.setTimeout(() => {
        setCounting(true);
        const from = sample.base;
        const to = sample.base + sample.addOn.amount;
        let start = 0;
        const step = (ts: number) => {
          if (!start) start = ts;
          const k = Math.min(1, (ts - start) / COUNT_MS);
          const eased = 1 - Math.pow(1 - k, 3);
          setTotal(from + (to - from) * eased);
          if (k < 1) raf.current = requestAnimationFrame(step);
          else setCounting(false);
        };
        raf.current = requestAnimationFrame(step);
      }, T_COUNT),
      window.setTimeout(() => setAccepted(true), T_ACCEPT),
      window.setTimeout(() => setVisible(false), T_OUT),
      window.setTimeout(() => setIndex((i) => (i + 1) % SAMPLES.length), SLIDE_MS),
    ];
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      cancelAnimationFrame(raf.current);
    };
  }, [index, reduced]);

  return (
    <div role="img" aria-label="Example: a client ticks an optional add-on and accepts a proposal" className="w-full max-w-md">
      <div aria-hidden className="rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-pop">
        <div
          className={cx(
            "transition-all duration-300 ease-out motion-reduce:transition-none",
            visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
          )}
        >
          <div className="flex items-center justify-between">
            <span
              className={cx(
                "inline-flex h-[22px] items-center gap-1.5 rounded-full px-2 text-xs font-medium ring-1 ring-inset transition-colors duration-300",
                accepted ? "bg-success-50 text-success-700 ring-success-200/80" : "bg-amber-50 text-amber-700 ring-amber-200/80"
              )}
            >
              <span className={cx("size-1.5 rounded-full transition-colors duration-300", accepted ? "bg-success-500" : "bg-amber-500")} />
              {accepted ? "Accepted" : "Viewed"}
            </span>
            <span className="text-[11px] font-medium tracking-wider text-zinc-400 uppercase">Proposal</span>
          </div>

          <div className="mt-4 text-[17px] font-semibold tracking-[-0.02em] text-ink">{s.title}</div>
          <div className="mt-0.5 text-sm text-zinc-500">Prepared for Your client</div>

          <div className="mt-5 space-y-2.5 border-t border-zinc-100 pt-4 text-sm">
            <div className="flex justify-between gap-4">
              <span className="text-zinc-600">{s.baseItem}</span>
              <span className="money text-ink">{inr(s.base)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="flex items-center gap-2 text-zinc-600">
                <span
                  className={cx(
                    "grid size-4 place-items-center rounded-[5px] border transition-colors duration-200",
                    checked ? "border-accent-600 bg-accent-600" : "border-zinc-300 bg-white"
                  )}
                >
                  <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path
                      d="M2.5 6.5 5 9l4.5-6"
                      strokeDasharray="12"
                      strokeDashoffset={checked ? 0 : 12}
                      style={{ transition: reduced ? "none" : "stroke-dashoffset 250ms ease-out 80ms" }}
                    />
                  </svg>
                </span>
                {s.addOn.name}
                <span className="rounded-full bg-zinc-100 px-1.5 py-px text-[10px] font-medium text-zinc-500">Add-on</span>
              </span>
              <span className={cx("money transition-colors duration-200", checked ? "text-ink" : "text-zinc-400")}>+ {inr(s.addOn.amount)}</span>
            </div>
          </div>

          <div className="mt-4 flex items-baseline justify-between border-t border-zinc-100 pt-4">
            <span className="text-sm font-medium text-zinc-600">Total</span>
            <span className={cx("money text-xl font-semibold transition-colors duration-300", counting ? "text-accent-600" : "text-ink")}>
              {inr(total)}
            </span>
          </div>
        </div>
      </div>

      {!reduced && (
        <div aria-hidden className="mt-4 flex justify-center gap-1.5">
          {SAMPLES.map((x, i) => (
            <span
              key={x.title}
              className={cx("h-1.5 rounded-full transition-all duration-300", i === index ? "w-5 bg-accent-500" : "w-1.5 bg-zinc-300")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
