import { useEffect, useRef, useState } from "react";
import memoryConfig from "../../bridge/memory-config.json";
import { memoryStateSchema, type MemoryRecord, type MemoryState, type MemoryWrite } from "../shared/memory";

type Draft = Pick<MemoryRecord, "text" | "kind" | "pinned">;
const blank: Draft = { text: "", kind: "fact", pinned: false };
interface Props {
  request: (operation: "read" | "write", change?: MemoryWrite) => Promise<unknown>;
  refreshKey: number;
  disabled: boolean;
}
export default function MemorySettings({ request, refreshKey, disabled }: Props) {
  const [state, setState] = useState<MemoryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      const current = ++generation.current;
      try {
        const result = memoryStateSchema.parse(await request("read"));
        if (mounted && current === generation.current) { setState(result); setError(null); }
      } catch (cause) {
        if (mounted && current === generation.current) setError(cause instanceof Error ? cause.message : "Memory unavailable. Update or reconnect the companion.");
      }
    };
    void load();
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", load);
    document.addEventListener("visibilitychange", visible);
    return () => { mounted = false; window.removeEventListener("focus", load); document.removeEventListener("visibilitychange", visible); };
  }, [request, refreshKey]);
  async function write(change: MemoryWrite) {
    setBusy(true); setError(null); setNotice(""); generation.current++;
    try {
      const result = memoryStateSchema.parse(await request("write", change));
      generation.current++; setState(result);
      setNotice("Memory saved. Future recall uses this version; existing chat context remains.");
      return true;
    } catch (cause) {
      generation.current++;
      setError(cause instanceof Error ? cause.message : "Unable to save memory.");
      try { setState(memoryStateSchema.parse(await request("read"))); } catch { /* Keep the last readable list and edit drafts. */ }
      return false;
    } finally { setBusy(false); }
  }
  const version = { identity: state?.identity ?? null, revision: state?.revision ?? 0 };
  const blocked = busy || disabled;
  const discard = (id: string) => setDrafts((current) => { const next = { ...current }; delete next[id]; return next; });
  const editor = (id: string, record?: MemoryRecord, index?: number) => {
    const draft = drafts[id] ?? record ?? blank;
    const dirty = !record || draft.text !== record.text || draft.kind !== record.kind || draft.pinned !== record.pinned;
    const update = (change: Partial<Draft>) => setDrafts((current) => ({ ...current, [id]: { text: draft.text, kind: draft.kind, pinned: draft.pinned, ...change } }));
    return <form onSubmit={(event) => {
      event.preventDefault();
      void write({ ...version, operation: record ? "replace" : "add", ...(record ? { recordId: record.id } : {}), text: draft.text, kind: draft.kind, pinned: draft.pinned, expiresAt: null } as MemoryWrite).then((ok) => {
        if (ok) { discard(id); if (!record) setAdding(false); }
      });
    }}>
      <label>{record ? `Memory ${index}` : "New memory"}<textarea value={draft.text} maxLength={500} rows={3} required disabled={blocked} onChange={(event) => update({ text: event.target.value })} /></label>
      <div className="memory-entry-options">
        <label>Type<select value={draft.kind} disabled={blocked} onChange={(event) => update({ kind: event.target.value as Draft["kind"] })}><option value="preference">Preference</option><option value="fact">Fact</option></select></label>
        <label className="toggle-label"><input type="checkbox" checked={draft.pinned} disabled={blocked} onChange={(event) => update({ pinned: event.target.checked })} />Prioritize in recall</label>
      </div>
      <div className="memory-entry-actions">
        <button type="submit" disabled={blocked || !dirty || !draft.text.trim()}>{record ? "Save changes" : "Save memory"}</button>
        {(dirty || !record) && <button type="button" disabled={blocked} onClick={() => { discard(id); if (!record) setAdding(false); }}>Cancel</button>}
        {record && <button type="button" disabled={blocked} onClick={() => void write({ operation: "delete", ...version, recordId: record.id })}>Delete</button>}
      </div>
      {record && <small>Updated {new Date(record.updatedAt).toLocaleString()}</small>}
    </form>;
  };
  return <div className="memory-settings">
    <h3 className="settings-section-title">Memory</h3>
    <label className="toggle-row"><span>Use saved memory<small>Automatically remember useful facts and preferences from your messages.</small></span><input type="checkbox" checked={state?.enabled ?? false} disabled={blocked || !state} onChange={(event) => void write({ operation: "settings", ...version, enabled: event.target.checked })} /></label>
    <p className="menu-hint">Enable it, then start a new regular chat. The agent can add, correct, and forget memories directly. Turning it off keeps saved records and blocks future access.</p>
    {error && <p className="recording-error" role="alert">{error}</p>}
    {state && <>
      <div className="memory-list-heading"><h3 className="settings-subheading">Saved memories <small>{state.records.length} / 200</small></h3><button type="button" disabled={blocked || adding || state.records.length >= 200} onClick={() => { setAdding(true); setQuery(""); }}>Add memory</button></div>
      {state.records.length > 0 && <label>Find saved memory<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>}
      <ul className="memory-list">
        {adding && <li key="new">{editor("new")}</li>}
        {state.records.filter((record) => record.text.toLowerCase().includes(query.toLowerCase())).map((record, index) => <li key={record.id}>{editor(record.id, record, index + 1)}</li>)}
      </ul>
      {!state.records.length && !adding && <p className="menu-hint">No saved memories yet. Tell the agent something you want it to remember, or add one here.</p>}
      {notice && <p className="menu-hint" role="status">{notice}</p>}
      <p className="menu-hint">Memories stay on this computer until edited or deleted, including after a browser reinstall if the companion data is kept. Selected records are sent to your Codex model when used. Removing a memory does not erase existing chat or provider context.</p>
      <details className="prompt-settings"><summary>Memory model guidance</summary><pre className="recording-preview">{memoryConfig.instructions}</pre></details>
      <button type="button" disabled={blocked || !state.records.length} onClick={() => { if (window.confirm("Clear all saved memory? This cannot be undone. Existing chats are kept.")) void write({ operation: "clear", ...version }); }}>Clear saved memory</button>
    </>}
  </div>;
}
