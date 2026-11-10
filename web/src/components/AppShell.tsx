import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "../lib/auth";
import { Link, useLocation } from "../lib/router";
import { IconLogout, IconPlug } from "./icons";
import { Logo } from "./Logo";
import { Avatar, cx } from "./ui";

export { Logo } from "./Logo";

const NAV = [
  { to: "/", label: "Proposals", match: (p: string) => p === "/" || p.startsWith("/proposals") },
  { to: "/connect", label: "Connect to Claude", short: "Connect", match: (p: string) => p.startsWith("/connect") },
];

function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!user) return null;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="flex items-center gap-2 rounded-full p-0.5 transition duration-150 hover:bg-zinc-100 focus-visible:ring-3 focus-visible:ring-accent-500/25"
      >
        <Avatar name={user.name} className="size-7 text-[11px]" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-60 origin-top-right animate-pop-in rounded-xl border border-zinc-200/80 bg-white p-1 shadow-pop"
        >
          <div className="px-3 py-2.5">
            <div className="truncate text-sm font-medium text-ink">{user.name}</div>
            <div className="truncate text-xs text-zinc-500">{user.email}</div>
          </div>
          <div className="my-1 h-px bg-zinc-100" />
          <Link
            to="/connect"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-zinc-700 transition duration-150 hover:bg-zinc-50 hover:text-ink"
          >
            <IconPlug className="size-4 text-zinc-400" /> Connect to Claude
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={() => void logout()}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-zinc-700 transition duration-150 hover:bg-zinc-50 hover:text-ink"
          >
            <IconLogout className="size-4 text-zinc-400" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AppShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
  const { pathname } = useLocation();
  const width = wide ? "max-w-7xl" : "max-w-6xl";
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-white/85 backdrop-blur-xl backdrop-saturate-150">
        <div className={cx("mx-auto flex h-14 items-center gap-4 px-4 sm:gap-8 sm:px-6", width)}>
          <Link to="/" aria-label="Closewise home" className="rounded-md focus-visible:ring-3 focus-visible:ring-accent-500/25">
            <Logo markClassName="size-6" />
          </Link>
          <nav className="flex h-full items-center gap-1">
            {NAV.map(({ to, label, short, match }) => {
              const active = match(pathname);
              return (
                <Link
                  key={to}
                  to={to}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "relative flex h-full items-center px-2.5 text-[13px] font-medium transition duration-150",
                    active ? "text-ink" : "text-zinc-500 hover:text-ink"
                  )}
                >
                  <span className="sm:hidden">{short ?? label}</span>
                  <span className="hidden sm:inline">{label}</span>
                  {active && <span className="absolute inset-x-2.5 -bottom-px h-[2px] rounded-full bg-ink" />}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </div>
      </header>
      <main className={cx("mx-auto px-4 py-8 sm:px-6 sm:py-10", width)}>{children}</main>
    </div>
  );
}
