import { useState } from "react";
import { api, ApiError, type ProposalStatus } from "../lib/api";
import { IconAlert, IconTrash } from "./icons";
import { Button, Modal, useToast } from "./ui";

type Target = { id: string; title: string; status: ProposalStatus };

const CONSEQUENCE: Record<ProposalStatus, string> = {
  DRAFT: "This draft was never sent, so no client has seen it.",
  SENT: "Your client has the link. It will stop working and show “Proposal not found”.",
  VIEWED: "Your client has opened it. The link will stop working and show “Proposal not found”.",
  ACCEPTED: "This proposal was accepted. You'll lose the signed record (name, date, chosen add-ons) and the client's link.",
  DECLINED: "You'll lose the decline record, and the client's link will stop working.",
};

/** Confirm + delete. Calls onDeleted after a successful delete (the caller removes it from view / navigates). */
export function DeleteProposalDialog({ target, onClose, onDeleted }: { target: Target | null; onClose: () => void; onDeleted: (id: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setError(null);
    onClose();
  };

  async function confirm() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/proposals/${target.id}`, { method: "DELETE" });
      toast(`Deleted “${target.title}”`);
      onDeleted(target.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete this proposal");
    } finally {
      setBusy(false);
    }
  }

  const serious = target && target.status !== "DRAFT";
  return (
    <Modal
      open={!!target}
      onClose={close}
      title="Delete this proposal?"
      icon={
        <span className="grid size-10 place-items-center rounded-xl bg-rose-50 text-rose-600 ring-1 ring-rose-200/70 ring-inset">
          <IconTrash className="size-5" />
        </span>
      }
      footer={
        <>
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} loading={busy}>
            Delete proposal
          </Button>
        </>
      }
    >
      {target && (
        <>
          <p>
            <span className="font-medium text-ink">“{target.title}”</span> and its line items and activity will be permanently deleted. This
            can't be undone.
          </p>
          <p className={serious ? "mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-800" : "mt-2"}>
            {serious && <IconAlert className="mt-0.5 size-4 shrink-0" />}
            <span>{CONSEQUENCE[target.status]}</span>
          </p>
          {error && (
            <p className="mt-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-rose-700" role="alert">
              <IconAlert className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
