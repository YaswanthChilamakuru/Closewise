import { useEffect, useState } from "react";

export default function App() {
  const [health, setHealth] = useState("checking…");

  useEffect(() => {
    fetch("/health")
      .then((r) => r.text())
      .then((t) => setHealth(t.trim() === "ok" ? "API up" : "API unhealthy"))
      .catch(() => setHealth("API unreachable"));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">Closewise</h1>
      <p className="text-slate-600">Proposals written by your own Claude, sent from here.</p>
      <span className="rounded-full bg-white px-3 py-1 text-sm shadow-sm ring-1 ring-slate-200">{health}</span>
    </main>
  );
}
