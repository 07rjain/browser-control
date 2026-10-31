import { useCallback, useEffect, useState } from "react";
import memoryConfig from "../../bridge/memory-config.json";
import { memoryStateSchema, type MemoryRecord, type MemoryState, type MemoryWrite } from "../shared/memory";

interface Props {
  request: (operation: "read" | "write", change?: MemoryWrite) => Promise<unknown>;
  onNewChatWithoutMemory: () => void;
  disabled: boolean;
}
export default function MemorySettings({ request, onNewChatWithoutMemory, disabled }: Props) {
  const [state, setState] = useState<MemoryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<MemoryRecord | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"preference" | "fact">("preference");
  const [pinned, setPinned] = useState(false);
  const [expiry, setExpiry] = useState("");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    try { const result = memoryStateSchema.parse(await request("read")); setState(result); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Memory is unavailable. Update the companion and retry."); }
  }, [request]);
  useEffect(() => {
    let current = true;
    void request("read").then((value) => { if (current) { setState(memoryStateSchema.parse(value)); setError(null); } }).catch((cause: unknown) => { if (current) setError(cause instanceof Error ? cause.message : "Memory unavailable. Update the companion and retry."); });
    return () => { current = false; };
  }, [request]);
  async function write(change: MemoryWrite) {
    setBusy(true); setError(null); setNotice("");
    try { setState(memoryStateSchema.parse(await request("write", change))); setNotice("Memory saved. Changes apply to future recall; existing chat context remains."); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save memory."); await request("read").then((value) => setState(memoryStateSchema.parse(value))).catch(() => undefined); return false; }
    finally { setBusy(false); }
  }
  const version = { identity: state?.identity ?? null, revision: state?.revision ?? 0 };
  const blocked = busy || disabled;
  function edit(record: MemoryRecord) {
    setEditing(record); setText(record.text); setKind(record.kind); setPinned(record.pinned);
    setExpiry(record.expiresAt === null ? "" : new Date(record.expiresAt - new Date(record.expiresAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16));
  }
  return <div className="memory-settings">
    <h3 className="settings-section-title">Saved memory</h3>
    <p className="menu-hint">Keep preferences and facts on this computer. Selected records are sent to your Codex model when used. Saving here starts no inference.</p>
    <details className="prompt-settings"><summary>Memory model guidance</summary><pre className="recording-preview">{memoryConfig.instructions}</pre></details>
    {error && <p className="recording-error" role="alert">{error}</p>}
    <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh memory</button>
    {state && <>
      <label className="toggle-label"><input type="checkbox" checked={state.enabled} disabled={blocked} onChange={(event) => void write({ operation: "settings", ...version, enabled: event.target.checked })} />Use saved memory</label>
      <p className="menu-hint">Enable it, then start a new chat to use memory. Existing chats keep their captured mode. Turning it off blocks future reads and writes; it keeps saved records.</p>
      <button type="button" disabled={blocked} onClick={onNewChatWithoutMemory}>Start a chat without memory</button>
      <p className="menu-hint">A chat without memory still appears in conversation history. Forgetting a saved fact does not erase existing chat or provider context.</p>
      <form onSubmit={(event) => {
        event.preventDefault();
        void write({ ...version, operation: editing ? "replace" : "add", ...(editing ? { recordId: editing.id } : {}), text, kind, pinned, expiresAt: expiry ? new Date(expiry).getTime() : null } as MemoryWrite).then((ok) => { if (ok) { setText(""); setEditing(null); setExpiry(""); setPinned(false); } });
      }}>
        <label>{editing ? "Edit memory" : "Add a memory"}<textarea value={text} maxLength={500} rows={3} required disabled={blocked} onChange={(event) => setText(event.target.value)} /></label>
        <label>Type<select value={kind} disabled={blocked} onChange={(event) => setKind(event.target.value as "preference" | "fact")}><option value="preference">Preference</option><option value="fact">Fact</option></select></label>
        <label className="toggle-label"><input type="checkbox" checked={pinned} disabled={blocked} onChange={(event) => setPinned(event.target.checked)} />Prioritize in the profile</label>
        <label>Expires (optional, local time)<input type="datetime-local" value={expiry} disabled={blocked} onChange={(event) => setExpiry(event.target.value)} /></label>
        <button type="submit" disabled={blocked || !text.trim()}>{busy ? "Saving…" : editing ? "Save changes" : "Save memory"}</button>
        {editing && <button type="button" disabled={blocked} onClick={() => { setEditing(null); setText(""); setExpiry(""); setPinned(false); }}>Cancel edit</button>}
      </form>
      {notice && <p className="menu-hint" role="status">{notice}</p>}
      <label>Find saved memory<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <p className="menu-hint">{state.records.length} / 200 records · Automatic learning is not enabled in this release.</p>
      <ul className="memory-list">{state.records.filter((record) => record.text.toLowerCase().includes(query.toLowerCase())).map((record) => <li key={record.id}>
        <p>{record.text}</p>
        <small>{record.kind} · {record.source.type === "manual" ? "Saved in Settings" : "Reviewed user message"} · {new Date(record.updatedAt).toLocaleString()}{record.expiresAt !== null ? ` · Expires ${new Date(record.expiresAt).toLocaleString()}` : ""}</small>
        {record.source.evidence && <details><summary>Source excerpt</summary><p>{record.source.evidence}</p></details>}
        <button type="button" disabled={blocked} onClick={() => edit(record)}>Edit</button>
        <button type="button" disabled={blocked} onClick={() => { if (window.confirm(`Forget this saved memory?\n\n${record.text}\n\nExisting chat history is separate.`)) void write({ operation: "delete", ...version, recordId: record.id }); }}>Delete</button>
      </li>)}</ul>
      <button type="button" disabled={blocked || !state.records.length} onClick={() => { if (window.confirm("Clear all saved memory? This cannot be undone. Existing chats are kept.")) void write({ operation: "clear", ...version }); }}>Clear saved memory</button>
    </>}
  </div>;
}
