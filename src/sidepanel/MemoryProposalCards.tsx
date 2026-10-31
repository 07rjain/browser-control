import { useState } from "react";
import type { MemoryProposal } from "../shared/memory";

export default function MemoryProposalCards({ proposals, disabled, decide }: { proposals: MemoryProposal[]; disabled: boolean; decide: (proposal: MemoryProposal, approved: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function answer(proposal: MemoryProposal, approved: boolean) {
    setBusy(proposal.id); setError(null);
    try { await decide(proposal, approved); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save memory."); }
    finally { setBusy(null); }
  }
  return <div className="memory-proposals" aria-label="Memory review">
    {proposals.map((proposal) => <section className="memory-proposal" key={proposal.id}>
      <strong>{proposal.operation === "delete" ? "Forget saved memory" : proposal.operation === "replace" ? "Update saved memory" : "Remember for future chats"}</strong>
      {proposal.operation === "replace" && proposal.previousText && <small>Currently: {proposal.previousText}</small>}
      <p>{proposal.text}</p>
      {proposal.evidence && <small>From your message: “{proposal.evidence}”</small>}
      {proposal.status === "pending" ? <div className="prompt-settings-actions">
        <button type="button" disabled={disabled || busy !== null} onClick={() => void answer(proposal, true)}>{busy === proposal.id ? "Saving…" : proposal.operation === "delete" ? "Delete memory" : "Save memory"}</button>
        <button type="button" disabled={disabled || busy !== null} onClick={() => void answer(proposal, false)}>Dismiss</button>
      </div> : <p role="status">{proposal.status === "saved" ? "Memory change saved." : "Dismissed; nothing saved."}</p>}
    </section>)}
    {error && <p className="recording-error" role="alert">{error}</p>}
  </div>;
}
