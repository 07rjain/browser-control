import { FILE_LIMITS, parsePageRange, type AttachmentKind } from "../../shared/attachments";

export interface PreparedPage { number: number; blob: Blob; previewUrl: string; width: number; height: number; text: string }
export interface PreparedFile {
  id: string; name: string; kind: AttachmentKind; bytes: number; text: string; truncated: boolean;
  pages: PreparedPage[]; pageCount?: number; range?: string; source?: File; notice?: string; ready: boolean;
}

export function checkCanceled(signal?: AbortSignal) { signal?.throwIfAborted(); }
export function releasePreparedFile(file: PreparedFile) { for (const page of file.pages) URL.revokeObjectURL(page.previewUrl); }

export async function canvasImage(canvas: HTMLCanvasElement): Promise<Blob> {
  for (const quality of [0.9, 0.75, 0.6]) {
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("This image could not be prepared.")), "image/jpeg", quality));
    if (blob.size <= 2 * 1024 * 1024) return blob;
  }
  throw new Error("This page is too detailed to share within the image limit. Select fewer pages or attach a cropped image.");
}

export function imageDimensions(data: Uint8Array): { width: number; height: number; mime: string } {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ascii = (start: number, end: number) => String.fromCharCode(...data.subarray(start, end));
  if (data.length >= 24 && data[0] === 137 && ascii(1, 4) === "PNG") return { width: view.getUint32(16), height: view.getUint32(20), mime: "image/png" };
  if (data.length >= 10 && /^GIF8[79]a$/.test(ascii(0, 6))) return { width: view.getUint16(6, true), height: view.getUint16(8, true), mime: "image/gif" };
  if (data.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    const chunk = ascii(12, 16);
    if (chunk === "VP8X") return { width: 1 + data[24] + (data[25] << 8) + (data[26] << 16), height: 1 + data[27] + (data[28] << 8) + (data[29] << 16), mime: "image/webp" };
    if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff, mime: "image/webp" };
    if (chunk === "VP8L") return { width: 1 + data[21] + ((data[22] & 0x3f) << 8), height: 1 + (data[22] >> 6) + (data[23] << 2) + ((data[24] & 15) << 10), mime: "image/webp" };
  }
  if (data[0] === 255 && data[1] === 216) {
    for (let i = 2; i + 8 < data.length;) {
      if (data[i] !== 255) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(data[i + 1])) return { width: view.getUint16(i + 7), height: view.getUint16(i + 5), mime: "image/jpeg" };
      const size = view.getUint16(i + 2);
      if (size < 2) break;
      i += size + 2;
    }
  }
  throw new Error("Choose a valid PNG, JPEG, WebP, or GIF image.");
}

export async function prepareImage(file: File, signal?: AbortSignal): Promise<PreparedFile> {
  if (file.size > FILE_LIMITS.imageBytes) throw new Error(`${file.name} is larger than 8 MiB.`);
  const data = new Uint8Array(await file.arrayBuffer());
  checkCanceled(signal);
  const dimensions = imageDimensions(data);
  if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 40_000_000 || Math.max(dimensions.width, dimensions.height) > 16_384) throw new Error("This image exceeds the 40 megapixel or 16,384 pixel limit.");
  const bitmap = await createImageBitmap(new Blob([data], { type: dimensions.mime }), { imageOrientation: "from-image" });
  const canvas = document.createElement("canvas");
  try {
    checkCanceled(signal);
    const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height), Math.sqrt(4_000_000 / (bitmap.width * bitmap.height)));
    canvas.width = Math.max(1, Math.floor(bitmap.width * scale));
    canvas.height = Math.max(1, Math.floor(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preparation is unavailable.");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvasImage(canvas);
    checkCanceled(signal);
    return { id: crypto.randomUUID(), name: file.name.slice(0,180), kind: "image", bytes: file.size, text: "", truncated: false, ready: true, pageCount: 1,
      notice: `${dimensions.mime === "image/gif" || dimensions.mime === "image/webp" ? "Static first frame. " : ""}${scale < 1 ? "Resized to fit. " : ""}Metadata removed; transparency flattened on white.`,
      pages: [{ number: 1, blob, previewUrl: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, text: "" }] };
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}

export async function preparePdf(file: File, signal?: AbortSignal, range?: string): Promise<PreparedFile> {
  if (file.size > FILE_LIMITS.documentBytes) throw new Error(`${file.name} is larger than 20 MiB.`);
  const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
  const { default: workerUrl } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  GlobalWorkerOptions.workerSrc = workerUrl;
  checkCanceled(signal);
  const assetRoot = new URL("pdf-assets/", window.location.href).href;
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false, useWasm: false,
    cMapUrl: `${assetRoot}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assetRoot}standard_fonts/`, wasmUrl: `${assetRoot}wasm/`,
    disableFontFace: true, enableXfa: false, stopAtErrors: true, maxImageSize: 40_000_000, canvasMaxAreaInBytes: 64 * 1024 * 1024, verbosity: 0 });
  const abort = () => { void task.destroy(); };
  signal?.addEventListener("abort", abort, { once: true });
  const pages: PreparedPage[] = [];
  let succeeded = false;
  try {
    const pdf = await task.promise;
    checkCanceled(signal);
    if (pdf.numPages > FILE_LIMITS.documentPages) throw new Error(`This document exceeds ${FILE_LIMITS.documentPages} pages. Export a smaller PDF.`);
    const base = { id: crypto.randomUUID(), name: file.name.slice(0,180), kind: "pdf" as const, bytes: file.size, source: file, pageCount: pdf.numPages };
    if (!range && pdf.numPages > FILE_LIMITS.visualPages) return { ...base, pages: [], text: "", truncated: false, range: "", ready: false };
    const selected = parsePageRange(range ?? `1-${pdf.numPages}`, pdf.numPages);
    let characters = 0;
    let truncated = false;
    for (const number of selected) {
      checkCanceled(signal);
      const page = await pdf.getPage(number);
      const canvas = document.createElement("canvas");
      try {
        const rawViewport = page.getViewport({ scale: 1 });
        if (!Number.isFinite(rawViewport.width) || !Number.isFinite(rawViewport.height) || rawViewport.width <= 0 || rawViewport.height <= 0) throw new Error("This PDF has invalid page dimensions.");
        const viewport = page.getViewport({ scale: Math.min(2, 2048 / Math.max(rawViewport.width, rawViewport.height), Math.sqrt(4_000_000 / (rawViewport.width * rawViewport.height))) });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("PDF rendering is unavailable.");
        const render = page.render({ canvas, canvasContext: context, viewport, background: "white" });
        const cancelRender = () => render.cancel();
        signal?.addEventListener("abort", cancelRender, { once: true });
        try { await render.promise; } finally { signal?.removeEventListener("abort", cancelRender); }
        checkCanceled(signal);
        const content = await page.getTextContent();
        const fullText = content.items.map((item) => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("");
        const text = fullText.slice(0, Math.max(0, FILE_LIMITS.fileCharacters - characters));
        if (text.length < fullText.length) truncated = true;
        characters += text.length;
        const blob = await canvasImage(canvas);
        checkCanceled(signal);
        pages.push({ number, blob, previewUrl: URL.createObjectURL(blob), width: canvas.width, height: canvas.height, text });
      } finally { canvas.width = 0; canvas.height = 0; page.cleanup(); }
    }
    succeeded = true;
    return { ...base, pages, range: range ?? `1-${pdf.numPages}`, text: pages.map((page) => page.text).join("\n"), truncated, ready: true, notice: "Selected pages shared as images and available text. Images resized to fit." };
  } catch (error) {
    checkCanceled(signal);
    if (error instanceof Error && error.name === "PasswordException") throw new Error("Encrypted PDFs are not supported. Attach an unlocked copy without sharing its password.", { cause: error });
    throw error;
  } finally {
    if (!succeeded) for (const page of pages) URL.revokeObjectURL(page.previewUrl);
    signal?.removeEventListener("abort", abort);
    await task.destroy();
  }
}
