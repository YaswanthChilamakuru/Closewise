import type { ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { Link, useLocation } from "../lib/router";
import { IconGrid, IconLogout, IconPlug } from "./icons";
import { cx } from "./ui";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2 font-semibold tracking-tight text-zinc-900", className)}>
      <span className="grid size-7 place-items-center rounded-lg bg-accent-600 text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      Closewise
    </span>
  );
}

const NAV = [
  { to: "/", label: "Proposals", icon: IconGrid, match: (p: string) => p === "/" || p.startsWith("/proposals") },
  { to: "/connect", label: "Connect to Claude", icon: IconPlug, match: (p: string) => p.startsWith("/connect") },
];

export function AppShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 backdrop-blur-md">
        <div className={cx("mx-auto flex h-14 items-center gap-6 px-4 sm:px-6", wide ? "max-w-7xl" : "max-w-6xl")}>
          <Link to="/" aria-label="Closewise home">
            <Logo />
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map(({ to, label, icon: Icon, match }) => (
              <Link
                key={to}
                to={to}
                className={cx(
                  "inline-flex h-8 items-center gap-2 rounded-lg px-2.5 text-sm font-medium transition",
                  match(pathname) ? "bg-zinc-100 text-zinc-900" : "text-zinc-500 hover:bg-zinc-50 hover:text-zinc-900"
                )}
              >
                <Icon className="size-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3">
            {user && (
              <div className="hidden text-right leading-tight md:block">
                <div className="text-sm font-medium text-zinc-800">{user.name}</div>
                <div className="text-xs text-zinc-500">{user.email}</div>
              </div>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex size-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
              aria-label="Sign out"
              title="Sign out"
            >
              <IconLogout className="size-4" />
            </button>
          </div>
        </div>
      </header>
      <main className={cx("mx-auto px-4 py-8 sm:px-6 sm:py-10", wide ? "max-w-7xl" : "max-w-6xl")}>{children}</main>
    </div>
  );
}
