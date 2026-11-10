import { useState } from "react";
import { api, ApiError, type User } from "../lib/api";
import { useAuth } from "../lib/auth";
import { AppShell } from "../components/AppShell";
import { Button, CopyButton, Modal, copyText, useToast } from "../components/ui";
import { IconAlert, IconCopy, IconEye, IconEyeOff, IconRefresh, IconSparkle } from "../components/icons";

const EXAMPLE_PROMPTS = [
  "Use Closewise to draft a proposal for a 5-page website redesign for my client, ₹1,20,000, valid for 14 days. Add an optional SEO setup add-on.",
  "Create a Closewise proposal for my client: logo design for ₹25,000, with brand guidelines (₹8,000) as an optional extra.",
  "List my Closewise proposals and tell me which ones the client has viewed but not accepted yet.",
  "Open my latest draft in Closewise and make the scope section more persuasive. Keep the prices as they are.",
  "Publish my brand identity proposal in Closewise and give me the link to send.",
];

export default function Connect() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [revealed, setRevealed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  if (!user) return null;

  const url = user.mcpUrl;
  const cut = url.lastIndexOf("/") + 1;
  const masked = `${url.slice(0, cut)}${"•".repeat(16)}`;

  async function regenerate() {
    setRegenerating(true);
    try {
      const d = await api<{ user: User }>("/me/mcp-token", { method: "POST" });
      setUser(d.user);
      setRevealed(true);
      setConfirmOpen(false);
      toast("New URL created. Update the connector in Claude.");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Couldn't regenerate the URL", "error");
    } finally {
      setRegenerating(false);
    }
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-600 shadow-card">
          <IconSparkle className="size-3.5 text-[#D97757]" />
          MCP connector
        </div>
        <h1 className="mt-4 text-[26px] leading-tight font-semibold tracking-[-0.03em] text-ink">Connect to Claude</h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-500">
          Closewise has no AI of its own. Your Claude writes the proposals and saves them here through this private URL. Then
          you review, publish and track them in Closewise.
        </p>

        {/* URL */}
        <section className="card mt-8 p-5 sm:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Your MCP URL</h2>
            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
              <IconAlert className="size-3.5" />
              Keep it secret, like a password
            </span>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <div className="flex h-10 min-w-0 flex-1 items-center rounded-lg border border-zinc-200 bg-zinc-50/80 pr-1 shadow-[inset_0_1px_2px_rgb(11_11_15/0.04)]">
              <code className="min-w-0 flex-1 truncate px-3 py-2 font-mono text-sm text-zinc-800" title={revealed ? url : undefined}>
                {revealed ? url : masked}
              </code>
              <button
                type="button"
                onClick={() => setRevealed((r) => !r)}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-700"
                aria-label={revealed ? "Hide URL" : "Show URL"}
                title={revealed ? "Hide" : "Show"}
              >
                {revealed ? <IconEyeOff className="size-4" /> : <IconEye className="size-4" />}
              </button>
            </div>
            <CopyButton text={url} label="Copy URL" variant="primary" size="lg" toast="MCP URL copied" />
          </div>
          {/localhost|127\.0\.0\.1/.test(url) && (
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">
              This URL points to <code className="rounded bg-zinc-100 px-1">localhost</code>, so claude.ai can't reach it. Once
              Closewise is deployed with <code className="rounded bg-zinc-100 px-1">APP_URL</code> set, the public URL appears here.
            </p>
          )}
        </section>

        {/* Steps */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-ink">Connect in three steps</h2>
          <ol className="mt-4 grid gap-4 sm:grid-cols-3">
            <Step n={1} title="Open connectors">
              In <span className="font-medium text-zinc-700">claude.ai</span>, go to <span className="font-medium text-zinc-700">Settings → Connectors</span> and click{" "}
              <span className="font-medium text-zinc-700">Add custom connector</span>.
            </Step>
            <Step n={2} title="Paste your URL">
              Name it <span className="font-medium text-zinc-700">Closewise</span>, paste the MCP URL above, and click{" "}
              <span className="font-medium text-zinc-700">Add</span>. No sign-in is needed: the URL is the key.
            </Step>
            <Step n={3} title="Ask Claude">
              In a new chat, make sure Closewise is enabled in the tools menu, then ask for a proposal. It shows up on your dashboard within seconds.
            </Step>
          </ol>
        </section>

        {/* Prompts */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-ink">Things to ask Claude</h2>
          <ul className="mt-4 space-y-2">
            {EXAMPLE_PROMPTS.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  onClick={async () => (await copyText(p)) && toast("Prompt copied")}
                  className="group flex w-full items-start gap-3 rounded-xl border border-zinc-200/80 bg-white px-4 py-3 text-left text-sm text-zinc-700 shadow-card transition duration-150 hover:-translate-y-px hover:border-zinc-300 hover:shadow-lift"
                >
                  <span className="flex-1 leading-relaxed">“{p}”</span>
                  <IconCopy className="mt-0.5 size-4 shrink-0 text-zinc-300 transition duration-150 group-hover:text-accent-600" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* Regenerate */}
        <section className="card mt-10 flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="text-sm font-semibold text-ink">Regenerate URL</h2>
            <p className="mt-1 max-w-md text-sm text-zinc-500">
              Shared it by accident? Create a new URL. The current one stops working immediately.
            </p>
          </div>
          <Button onClick={() => setConfirmOpen(true)} className="shrink-0">
            <IconRefresh className="size-4" />
            Regenerate
          </Button>
        </section>
      </div>

      <Modal
        open={confirmOpen}
        onClose={() => !regenerating && setConfirmOpen(false)}
        title="Regenerate your MCP URL?"
        footer={
          <>
            <Button onClick={() => setConfirmOpen(false)} disabled={regenerating}>
              Cancel
            </Button>
            <Button variant="danger" onClick={regenerate} loading={regenerating}>
              Regenerate URL
            </Button>
          </>
        }
      >
        Claude loses access until you replace the URL in <span className="font-medium text-zinc-800">Settings → Connectors</span>{" "}
        with the new one. Your proposals aren't affected.
      </Modal>
    </AppShell>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="card p-5">
      <span className="grid size-7 place-items-center rounded-lg border border-zinc-200 bg-zinc-50 font-mono text-xs font-medium text-zinc-600">{n}</span>
      <h3 className="mt-4 text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">{children}</p>
    </li>
  );
}
