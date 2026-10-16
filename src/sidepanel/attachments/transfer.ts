import { FILE_LIMITS, attachmentSummarySchema, type AttachmentOperation, type AttachmentSummary } from "../../shared/attachments";
import { checkCanceled, type PreparedFile } from "./prepare";

export type AttachmentTransport = <T>(request: AttachmentOperation) => Promise<T>;

function toBase64(data: Uint8Array) {
  let binary = "";
  for (let i = 0; i < data.length; i += 8192) binary += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(binary);
}

export async function uploadBlob(transport: AttachmentTransport, owner: string, blob: Blob, mime: "image/jpeg" | "image/png" | "text/plain", signal?: AbortSignal) {
  checkCanceled(signal);
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  checkCanceled(signal);
  const sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  const { id, offset: received } = await transport<{ id: string; offset: number }>({ operation: "begin", owner, bytes: blob.size, mime, sha256 });
  if (!Number.isSafeInteger(received) || received < 0 || received > blob.size) throw new Error("Invalid attachment resume offset.");
  for (let offset = received; offset < blob.size; offset += FILE_LIMITS.chunkBytes) {
    checkCanceled(signal);
    const data = toBase64(new Uint8Array(await blob.slice(offset, offset + FILE_LIMITS.chunkBytes).arrayBuffer()));
    await transport({ operation: "chunk", owner, id, offset, data });
  }
  checkCanceled(signal);
  await transport({ operation: "finalize", owner, id });
  return id;
}

export async function readBlob(transport: AttachmentTransport, request: { operation: "read"; owner: string; id: string } | { operation: "preview"; threadId: string; id: string; page?: number }, signal?: AbortSignal) {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (;;) {
    checkCanceled(signal);
    const result = await transport<{ data: string; bytes: number; mime: string; done: boolean }>({ ...request, offset });
    if (result.bytes > FILE_LIMITS.documentBytes || result.data.length > FILE_LIMITS.chunkBytes * 4 / 3) throw new Error("The companion returned an oversized attachment.");
    const data = Uint8Array.from(atob(result.data), (character) => character.charCodeAt(0));
    chunks.push(data);
    offset += data.length;
    if (offset > result.bytes || (!result.done && data.length === 0)) throw new Error("Invalid attachment download.");
    if (result.done) { if (offset !== result.bytes) throw new Error("Incomplete attachment download."); return new Blob(chunks, { type: result.mime }); }
  }
}

export async function uploadPreparedFiles(transport: AttachmentTransport, owner: string, files: PreparedFile[], signal?: AbortSignal, progress?: (label: string) => void): Promise<AttachmentSummary[]> {
  const result: AttachmentSummary[] = [];
  for (const file of files) {
    checkCanceled(signal);
    progress?.(`Transferring ${file.name}…`);
    const assets: Array<{ id: string; role: "text" | "image"; page?: number }> = [];
    if (file.pages.length) {
      for (const page of file.pages) {
        assets.push({ id: await uploadBlob(transport, owner, page.blob, "image/jpeg", signal), role: "image", page: page.number });
        if (page.text) assets.push({ id: await uploadBlob(transport, owner, new Blob([page.text]), "text/plain", signal), role: "text", page: page.number });
      }
    } else {
      // Empty text files still get a nonempty, harmless representation.
      assets.push({ id: await uploadBlob(transport, owner, new Blob([file.text || "(Empty file)"]), "text/plain", signal), role: "text" });
    }
    result.push(attachmentSummarySchema.parse(await transport({ operation: "bundle", owner,
      file: { name: file.name, kind: file.kind, bytes: file.bytes, pages: file.pages.map((page) => page.number), pageCount: file.pageCount, truncated: file.truncated, notice: file.notice }, assets })));
  }
  return result;
}
