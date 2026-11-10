import { useState, type FormEvent } from "react";
import { api, ApiError, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Logo } from "../components/AppShell";
import { Button } from "../components/ui";
import { IconAlert, IconSparkle } from "../components/icons";

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
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,var(--color-accent-100),transparent_70%)]"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="text-lg" />
          <h1 className="mt-6 text-2xl font-semibold tracking-tight text-zinc-900">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            {mode === "login" ? "Sign in to manage your proposals." : "Proposals written by your own Claude, sent from here."}
          </p>
        </div>

        <form onSubmit={submit} className="card space-y-4 p-6 sm:p-7" noValidate>
          {mode === "signup" && (
            <div>
              <label className="label" htmlFor="name">
                Your name
              </label>
              <input id="name" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="field"
              autoComplete="email"
              autoFocus
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
              className="field"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "signup" ? "At least 8 characters" : undefined}
              required
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700" role="alert">
              <IconAlert className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          {mode === "login" ? "New to Closewise?" : "Already have an account?"}{" "}
          <button type="button" onClick={switchMode} className="font-medium text-accent-600 hover:text-accent-700">
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>

        <p className="mt-10 flex items-center justify-center gap-1.5 text-xs text-zinc-400">
          <IconSparkle className="size-3 text-orange-400" />
          Your Claude writes the proposal. Closewise sends and tracks it.
        </p>
      </div>
    </div>
  );
}
