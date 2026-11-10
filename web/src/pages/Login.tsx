import { useState, type FormEvent } from "react";
import { api, ApiError, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Logo } from "../components/Logo";
import { Button } from "../components/ui";
import { ProposalPreview } from "../components/ProposalPreview";
import { IconAlert, IconCircleCheck } from "../components/icons";

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
  const [submitted, setSubmitted] = useState(false);

  // Client-side checks mirror the server's rules; errors show after the first submit attempt.
  const fieldErrors: Partial<Record<"name" | "email" | "password", string>> = {};
  if (mode === "signup" && !name.trim()) fieldErrors.name = "Enter your name";
  if (!email.trim()) fieldErrors.email = "Enter your email";
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fieldErrors.email = "Enter a valid email address";
  if (!password) fieldErrors.password = "Enter your password";
  else if (mode === "signup" && password.length < 8) fieldErrors.password = "Use at least 8 characters";
  const shown = submitted ? fieldErrors : {};

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitted(true);
    const first = (["name", "email", "password"] as const).find((k) => fieldErrors[k]);
    if (first) {
      document.getElementById(first)?.focus();
      return;
    }
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
    setSubmitted(false);
  };

  const errorText = (k: keyof typeof fieldErrors) =>
    shown[k] ? (
      <p id={`${k}-error`} className="mt-1.5 animate-fade-in text-xs text-rose-600">
        {shown[k]}
      </p>
    ) : null;
  const invalidProps = (k: keyof typeof fieldErrors) =>
    shown[k] ? { "aria-invalid": true, "aria-describedby": `${k}-error` } : {};

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
                  <input
                    id="name"
                    className={`field h-10 ${shown.name ? "field-invalid" : ""}`}
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    {...invalidProps("name")}
                  />
                  {errorText("name")}
                </div>
              )}
              <div>
                <label className="label" htmlFor="email">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  className={`field h-10 ${shown.email ? "field-invalid" : ""}`}
                  autoComplete="email"
                  autoFocus
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  {...invalidProps("email")}
                />
                {errorText("email")}
              </div>
              <div>
                <label className="label" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className={`field h-10 ${shown.password ? "field-invalid" : ""}`}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "signup" ? "At least 8 characters" : undefined}
                  {...invalidProps("password")}
                />
                {errorText("password")}
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
          {/* Animated demo card: hardcoded generic samples only, no data fetched */}
          <ProposalPreview />

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
