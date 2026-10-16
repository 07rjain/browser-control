import { useState } from "react";
import type { AttachmentSummary } from "../../shared/attachments";
import type { PreparedFile } from "./prepare";
import { readBlob, type AttachmentTransport } from "./transfer";

export function FileCards({ files, disabled, onRemove, onRange }: { files: PreparedFile[]; disabled: boolean; onRemove: (id: string) => void; onRange: (file: PreparedFile, range: string) => void }) {
  return <ul className="file-list">
    {files.map((file) => <li key={file.id} className="file-card">
      <header><strong>{file.name}</strong><button type="button" disabled={disabled} aria-label={`Remove ${file.name}`} onClick={() => onRemove(file.id)}>×</button></header>
      <small>{(file.bytes / 1024).toFixed(0)} KiB · {file.pages.length ? `${file.pages.length} ${file.kind === "image" ? "image" : "page images"}${file.text ? " + text" : ""}` : file.ready ? `${file.text.length.toLocaleString()} characters` : "Choose pages to prepare"}{file.kind === "pdf" && file.pageCount ? ` · ${file.pageCount} total pages` : ""}</small>
      {file.notice && <small>{file.notice}</small>}
      {file.truncated && <strong className="file-warning">Text truncated to 24,000 characters. {file.pages.length ? "Selected page images are included." : "Only the displayed text count will be shared."}</strong>}
      {file.source && <form className="file-range" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onRange(file, String(form.get("range") ?? "")); }}>
        <label>Pages to share<input name="range" aria-label={`Pages for ${file.name}`} defaultValue={file.range} placeholder="1-5, 8" disabled={disabled} /></label>
        <button type="submit" disabled={disabled}>Prepare range</button>
      </form>}
      {file.pages.length > 0 && <div className="file-previews">{file.pages.map((page) => <figure key={page.number}><a href={page.previewUrl} target="_blank" rel="noreferrer" title="Open the exact shared image"><img src={page.previewUrl} alt={`${file.name}, page ${page.number}`} /></a><figcaption>{file.kind === "image" ? `${page.width} × ${page.height}` : `Page ${page.number}`}</figcaption></figure>)}</div>}
    </li>)}
  </ul>;
}

export function SentFiles({ files, threadId, transport }: { files: AttachmentSummary[]; threadId: string | null; transport: AttachmentTransport }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [openedAt] = useState(() => Date.now());
  const preview = async (file: AttachmentSummary) => {
    if (!threadId) return;
    setLoading(file.id); setError(null);
    // Open from the user's gesture before asynchronous native messaging.
    const tab = window.open("about:blank", "_blank");
    try {
      const blob = await readBlob(transport, { operation: "preview", threadId, id: file.id, page: file.pages[0] });
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else throw new Error("Allow the preview tab to open, or reattach the file to preview it.");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) { tab?.close(); setError(error instanceof Error ? error.message : "Reattach this file to preview it."); }
    finally { setLoading(null); }
  };
  return <div className="sent-files">{files.map((file) => <div className="sent-file" key={file.id}>
    <strong>{file.name}</strong><small>{file.kind}{file.pages.length ? ` · pages ${file.pages.join(", ")}` : ""}{file.truncated ? " · text truncated" : ""}</small>
    {file.expiresAt && file.expiresAt < openedAt ? <small>Local copy expired · reattach to reuse</small> : file.pages.length > 0 && <button type="button" disabled={loading !== null || !threadId} onClick={() => void preview(file)}>{loading === file.id ? "Loading…" : "Preview first shared page"}</button>}
  </div>)}{error && <small role="alert">{error}</small>}</div>;
}
