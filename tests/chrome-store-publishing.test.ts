// @vitest-environment node
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The release CLI uses this same API client; no live Store calls in tests.
// @ts-expect-error Release scripts run directly in Node, outside the extension TS build.
import { publishChromeStore } from "../scripts/publish-chrome-store.mjs";

const temporary = mkdtempSync(join(tmpdir(), "browser-control-store-"));
const zip = join(temporary, "extension.zip");
writeFileSync(zip, "fixture package bytes");
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
afterAll(() => rmSync(temporary, { recursive: true, force: true }));
const revision = (version: string, state = "PENDING_REVIEW") => ({ state, distributionChannels: [{ crxVersion: version, deployPercentage: 100 }] });
const options = { token: "test-token", version: "0.3.9", zip, submit: true };
function server(responses: unknown[]) {
  const requests: { url: string; options: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, options: RequestInit) => {
    requests.push({ url, options });
    if (!responses.length) throw new Error("Unexpected network call");
    const response = responses.shift();
    return response instanceof Response ? response : Response.json(response);
  });
  return requests;
}

describe("Chrome Web Store release publishing", () => {
  it("defaults to a read-only status check, even when a different revision is pending", async () => {
    const requests = server([{ submittedItemRevisionStatus: revision("0.3.8") }]);
    await expect(publishChromeStore({ ...options, submit: undefined })).resolves.toMatchObject({ result: "dry-run", submitted: ["0.3.8"] });
    expect(requests.map((request) => request.options.method ?? "GET")).toEqual(["GET"]);
  });
  it.each([
    ["publishedItemRevisionStatus", "PUBLISHED", "already-published"],
    ["submittedItemRevisionStatus", "PENDING_REVIEW", "already-submitted"],
  ])("does not upload a duplicate %s", async (key, state, result) => {
    const requests = server([{ [key]: revision("0.3.9", state) }]);
    await expect(publishChromeStore(options)).resolves.toMatchObject({ result });
    expect(requests).toHaveLength(1);
  });
  it.each([
    { submittedItemRevisionStatus: revision("0.3.8") },
    { submittedItemRevisionStatus: revision("0.3.9", "REJECTED") },
    { publishedItemRevisionStatus: revision("0.4.0", "PUBLISHED") },
    { takenDown: true }, { warned: true }, { lastAsyncUploadState: "IN_PROGRESS" },
  ])("refuses to alter a conflicting or unsafe Store state: %j", async (status) => {
    const requests = server([status]);
    await expect(publishChromeStore(options)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });
  it("uploads the package then requests normal review with automatic publication and warnings blocked", async () => {
    const requests = server([{}, { uploadState: "SUCCEEDED", crxVersion: "0.3.9" }, { state: "PENDING_REVIEW" }]);
    await expect(publishChromeStore(options)).resolves.toMatchObject({ result: "submitted", state: "PENDING_REVIEW" });
    expect(requests[1].url).toBe("https://chromewebstore.googleapis.com/upload/v2/publishers/15ec8284-3e6b-4114-ac69-e0b64977e120/items/mpdfhhhjgbpdpfnkjbnboebdjokfjglf:upload");
    expect(Buffer.from(requests[1].options.body as Uint8Array).toString()).toBe("fixture package bytes");
    expect(JSON.parse(requests[2].options.body as string)).toEqual({ publishType: "DEFAULT_PUBLISH", skipReview: false, blockOnWarnings: true });
  });
  it.each([{ uploadState: "FAILED" }, { uploadState: "SUCCEEDED", crxVersion: "9.0.0" }, {}])("does not submit an unsuccessful or mismatched upload: %j", async (upload) => {
    const requests = server([{}, upload]);
    await expect(publishChromeStore(options)).rejects.toThrow();
    expect(requests).toHaveLength(2);
  });
  it("waits for asynchronous processing before submission", async () => {
    vi.useFakeTimers();
    const requests = server([{}, { uploadState: "IN_PROGRESS" }, { lastAsyncUploadState: "SUCCEEDED" }, { state: "PENDING_REVIEW" }]);
    const result = publishChromeStore(options);
    await vi.runAllTimersAsync();
    await expect(result).resolves.toMatchObject({ result: "submitted" });
    expect(requests.map((request) => request.options.method ?? "GET")).toEqual(["GET", "POST", "GET", "POST"]);
  });
  it("reports HTTP failure without echoing a remote response or credential", async () => {
    server([new Response("sensitive remote error test-token", { status: 403 })]);
    await expect(publishChromeStore(options)).rejects.toThrow("HTTP 403");
    server([new Response("sensitive remote error test-token", { status: 403 })]);
    await expect(publishChromeStore(options)).rejects.not.toThrow("test-token");
  });
});
