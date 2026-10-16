// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readAttachedFile } from "../src/sidepanel/attached-files";
import { attachmentOperationSchema, parsePageRange } from "../src/shared/attachments";
import { imageDimensions } from "../src/sidepanel/attachments/prepare";

describe("attached files", () => {
  it("requires unsupported documents to be exported to PDF without invoking conversion", async () => {
    for (const extension of ["doc", "docx", "ppt", "pptx"]) {
      await expect(readAttachedFile(new File(["unread"], `report.${extension}`))).rejects.toThrow(/export.*PDF/);
    }
    expect(attachmentOperationSchema.safeParse({ operation: "convert", owner: crypto.randomUUID(), id: crypto.randomUUID(), format: "docx" }).success).toBe(false);
  });

  it("validates page selection without silently omitting pages", () => {
    expect(parsePageRange("8, 1-3, 2", 22)).toEqual([1, 2, 3, 8]);
    for (const value of ["", "0", "23", "3-1", "1-21", "1,x"]) expect(() => parsePageRange(value, 22)).toThrow();
  });

  it("rejects invalid images before allocating a canvas", () => {
    expect(() => imageDimensions(new Uint8Array([1, 2, 3]))).toThrow(/valid.*image/);
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71]);
    const header = new DataView(png.buffer);
    header.setUint32(16, 640); header.setUint32(20, 480);
    expect(imageDimensions(png)).toEqual({ width: 640, height: 480, mime: "image/png" });
  });
  it("reads text and Markdown, truncates long files, and refuses unsupported or binary contents", async () => {
    for (const [name, type] of [["notes.txt", "text/plain"], ["notes.md", ""], ["page.data", "text/html"]]) {
      await expect(readAttachedFile(new File(["hello"], name, { type }))).resolves.toMatchObject({ name, kind: "text", text: "hello", truncated: false });
    }
    await expect(readAttachedFile(new File(["hello"], "data.bin", { type: "application/octet-stream" }))).rejects.toThrow(/unsupported/);

    const long = new File(["a".repeat(24_010)], "long.txt", { type: "text/plain" });
    const truncated = await readAttachedFile(long);
    expect(truncated.truncated).toBe(true);
    expect(truncated.text).toHaveLength(24_000);

    const binary = new File([new Uint8Array([65, 0, 66])], "secret.txt", { type: "text/plain" });
    await expect(readAttachedFile(binary)).rejects.toThrow(/not a text file/);
    await expect(readAttachedFile(new File([new Uint8Array([255, 254, 65])], "invalid.txt"))).rejects.toThrow(/UTF-8/);
  });
});
