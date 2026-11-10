import { useState, type FormEvent } from "react";
import { api, ApiError, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Logo } from "../components/Logo";
import { Button } from "../components/ui";
import { IconAlert, IconCircleCheck, IconSparkle } from "../components/icons";

const POINTS = [
  "Your own Claude drafts the proposal over MCP",
  "Clients review, pick add-ons and accept online",
  "See views and acceptances the moment they happen",
];

export default function Login() {
  const { setUser } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = mode === "login" ? { email, password } : { name, email, password };
      const d = await api<{ user: User }>(`/auth/${mode}`, { body });
      setUser(d.user); // App redirects to ?next= or the dashboard
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  const switchMode = () => {
    setMode((m) => (m === "login" ? "signup" : "login"));
    setError(null);
  };

  return (
    <div className="grid min-h-screen bg-white lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* Form */}
      <div className="relative flex flex-col px-6 py-8 sm:px-10">
        <Logo markClassName="size-7" />
        <div className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[360px] animate-pop-in">
            <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.03em] text-ink">
              {mode === "login" ? "Welcome back" : "Create your account"}
            </h1>
            <p className="mt-2 text-sm text-zinc-500">
              {mode === "login" ? "Sign in to manage your proposals." : "Start sending proposals your Claude writes for you."}
            </p>

            <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
              {mode === "signup" && (
                <div>
                  <label className="label" htmlFor="name">
                    Your name
                  </label>
                  <input id="name" className="field h-10" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
              )}
              <div>
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  className="field h-10"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@studio.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className="field h-10"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "At least 8 characters" : undefined}
                  required
                />
              </div>

              {error && (
                <div className="flex animate-pop-in items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700" role="alert">
                  <IconAlert className="mt-0.5 size-4 shrink-0" />
                  {error}
                </div>
              )}

              <Button type="submit" variant="dark" size="lg" className="w-full" loading={busy}>
                {mode === "login" ? "Sign in" : "Create account"}
              </Button>
            </form>

            <p className="mt-6 text-sm text-zinc-500">
              {mode === "login" ? "New to Closewise?" : "Already have an account?"}{" "}
              <button type="button" onClick={switchMode} className="font-medium text-accent-600 transition duration-150 hover:text-accent-700">
                {mode === "login" ? "Create an account" : "Sign in"}
              </button>
            </p>
          </div>
        </div>
        <p className="text-xs text-zinc-400">Closewise has no AI of its own. Your Claude does the writing.</p>
      </div>

      {/* Showcase */}
      <div className="relative hidden overflow-hidden border-l border-zinc-200/70 bg-zinc-50 lg:block">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_20%,rgb(99_102_241/0.16),transparent_70%),radial-gradient(40%_40%_at_20%_90%,rgb(99_102_241/0.08),transparent_70%)]"
        />
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.35] [background-image:linear-gradient(rgb(11_11_15/0.05)_1px,transparent_1px),linear-gradient(90deg,rgb(11_11_15/0.05)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]"
        />
        <div className="relative flex h-full flex-col justify-center px-14 xl:px-20">
          {/* Mini proposal preview */}
          <div className="w-full max-w-md rounded-2xl border border-zinc-200/80 bg-white p-6 shadow-pop">
            <div className="flex items-center justify-between">
              <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full bg-success-50 px-2 text-xs font-medium text-success-700 ring-1 ring-success-200/80 ring-inset">
                <span className="size-1.5 rounded-full bg-success-500" /> Accepted
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
                <IconSparkle className="size-3 text-[#D97757]" /> via Claude
              </span>
            </div>
            <div className="mt-4 text-[17px] font-semibold tracking-[-0.02em] text-ink">Logo design for Acme Corp</div>
            <div className="mt-0.5 text-sm text-zinc-500">Prepared for Acme Corp</div>
            <div className="mt-5 space-y-2 border-t border-zinc-100 pt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-600">Logo design</span>
                <span className="money text-ink">₹25,000</span>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-2 text-zinc-600">
                  <span className="grid size-4 place-items-center rounded bg-accent-600 text-white">
                    <svg viewBox="0 0 12 12" className="size-2.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2.5 6.5 5 9l4.5-6" />
                    </svg>
                  </span>
                  Brand guidelines
                </span>
                <span className="money text-ink">₹8,000</span>
              </div>
            </div>
            <div className="mt-4 flex items-baseline justify-between border-t border-zinc-100 pt-4">
              <span className="text-sm font-medium text-zinc-600">Total</span>
              <span className="money text-xl font-semibold text-ink">₹33,000</span>
            </div>
          </div>

          <ul className="mt-10 space-y-3">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-2.5 text-sm text-zinc-600">
                <IconCircleCheck className="size-4 text-accent-600" />
                {p}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
