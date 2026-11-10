import { useEffect } from "react";
import { AuthProvider, useAuth } from "./lib/auth";
import { navigate, useLocation } from "./lib/router";
import { ToastProvider, Spinner } from "./components/ui";
import { AppShell } from "./components/AppShell";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Editor from "./pages/Editor";
import Connect from "./pages/Connect";
import { Link } from "./lib/router";

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Routes />
      </AuthProvider>
    </ToastProvider>
  );
}

const TITLES: Record<string, string> = { "/": "Proposals", "/connect": "Connect to Claude", "/login": "Sign in" };

function Routes() {
  const { user } = useAuth();
  const { pathname, search } = useLocation();

  // Auth gate: signed-out users go to /login?next=…, signed-in users skip the login page.
  useEffect(() => {
    if (user === undefined) return;
    if (!user && pathname !== "/login") navigate(`/login?next=${encodeURIComponent(pathname + search)}`, { replace: true });
    if (user && pathname === "/login") {
      const next = new URLSearchParams(search).get("next");
      navigate(next && next.startsWith("/") && !next.startsWith("//") ? next : "/", { replace: true });
    }
  }, [user, pathname, search]);

  useEffect(() => {
    document.title = `${TITLES[pathname] ?? (pathname.startsWith("/proposals/") ? "Edit proposal" : "Closewise")} · Closewise`;
  }, [pathname]);

  if (user === undefined)
    return (
      <div className="flex min-h-screen items-center justify-center text-zinc-400">
        <Spinner className="size-6" />
      </div>
    );
  if (!user) return pathname === "/login" ? <Login /> : null;
  if (pathname === "/login") return null;

  if (pathname === "/") return <Dashboard />;
  if (pathname === "/connect") return <Connect />;
  const m = pathname.match(/^\/proposals\/([^/]+)\/?$/);
  if (m) return <Editor key={m[1]} id={decodeURIComponent(m[1])} />;

  return (
    <AppShell>
      <div className="card mx-auto max-w-md px-6 py-14 text-center">
        <h1 className="text-lg font-semibold">Page not found</h1>
        <p className="mt-2 text-sm text-zinc-500">The page you're looking for doesn't exist.</p>
        <Link to="/" className="mt-6 inline-flex text-sm font-medium text-accent-600 hover:text-accent-700">
          ← Back to proposals
        </Link>
      </div>
    </AppShell>
  );
}
