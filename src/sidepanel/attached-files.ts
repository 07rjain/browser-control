import { FILE_LIMITS } from "../shared/attachments";
import { checkCanceled, prepareImage, preparePdf, type PreparedFile } from "./attachments/prepare";

export const MAX_ATTACHED_FILES = FILE_LIMITS.count;
export const MAX_FILE_CHARACTERS = FILE_LIMITS.fileCharacters;
const MAX_FILE_BYTES = FILE_LIMITS.documentBytes;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "csv", "tsv", "xml", "html", "css", "js", "jsx", "ts", "tsx",
  "mjs", "cjs", "py", "rb", "go", "rs", "java", "c", "h", "cc", "cpp", "hpp", "sh", "yml", "yaml",
  "toml", "ini", "log", "sql", "svg",
]);

const TEXT_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/sql",
  "image/svg+xml",
]);

export type AttachedFile = PreparedFile;

export function isTextFile(file: { name: string; type: string }): boolean {
  if (file.type.startsWith("text/") || TEXT_TYPES.has(file.type)) return true;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return TEXT_EXTENSIONS.has(extension);
}

export async function readAttachedFile(file: File, options: { signal?: AbortSignal; range?: string } = {}): Promise<AttachedFile> {
  const name = file.name.replace(/[\r\n]/g, " ").trim().slice(0, 180) || "file";
  checkCanceled(options.signal);
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (["png","jpg","jpeg","gif","webp"].includes(extension ?? "")) return prepareImage(file, options.signal);
  if (extension === "pdf") return preparePdf(file, options.signal, options.range);
  if (["doc","docx","ppt","pptx"].includes(extension ?? "")) {
    throw new Error(`${name}: export this document or presentation to PDF, then attach the PDF.`);
  }
  if (!isTextFile(file)) throw new Error(`${name} is unsupported. Attach an image, PDF, Markdown, or text file.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`${name} is larger than 20 MiB.`);
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()); }
  catch (cause) { throw new Error(`${name} is not a UTF-8 text file. Save it as UTF-8 and try again.`, { cause }); }
  checkCanceled(options.signal);
  if (raw.includes("\u0000")) throw new Error(`${name} is not a text file.`);
  return {
    id: crypto.randomUUID(),
    name,
    text: raw.slice(0, MAX_FILE_CHARACTERS),
    truncated: raw.length > MAX_FILE_CHARACTERS,
    kind: "text", bytes: file.size, pages: [], ready: true,
  };
}

export function formatFileContext(files: readonly (Pick<AttachedFile, "name" | "text" | "truncated"> & { id?: string })[]): string {
  return files.map((file) => {
    const note = file.truncated ? " (truncated)" : "";
    return `\n\n--- BEGIN USER-ATTACHED UNTRUSTED FILE: ${file.name}${note} ---\n${file.text}\n--- END USER-ATTACHED UNTRUSTED FILE ---`;
  }).join("");
}
