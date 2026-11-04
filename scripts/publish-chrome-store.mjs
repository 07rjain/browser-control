import { readFileSync, appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const resource = "publishers/15ec8284-3e6b-4114-ac69-e0b64977e120/items/mpdfhhhjgbpdpfnkjbnboebdjokfjglf";
const origin = "https://chromewebstore.googleapis.com";

export async function publishChromeStore({ token, version, zip, submit = false }) {
  if (!token) throw new Error("CWS_ACCESS_TOKEN is required.");
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Expected a numeric release version.");
  async function request(path, options = {}) {
    const response = await fetch(`${origin}${path}`, {
      ...options,
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, ...options.headers },
      signal: AbortSignal.timeout(120_000),
    });
    // Do not print remote error bodies: they can include request details.
    if (!response.ok) throw new Error(`Chrome Web Store request failed (HTTP ${response.status}). Check the developer dashboard.`);
    return response.json();
  }
  const statusPath = `/v2/${resource}:fetchStatus`;
  const status = await request(statusPath);
  const versions = (revision) => revision?.distributionChannels?.map((channel) => channel.crxVersion) ?? [];
  const published = versions(status.publishedItemRevisionStatus);
  const submitted = versions(status.submittedItemRevisionStatus);
  if (!submit) return { result: "dry-run", version, published, submitted, state: status.submittedItemRevisionStatus?.state ?? null };
  if (status.takenDown || status.warned) throw new Error("Resolve Store policy warnings in the developer dashboard first.");
  if (published.includes(version)) return { result: "already-published", version };
  const revision = status.submittedItemRevisionStatus;
  if (revision) {
    if (submitted.length === 1 && submitted[0] === version && revision.state === "PENDING_REVIEW") {
      return { result: "already-submitted", version };
    }
    throw new Error("A submitted revision exists. Review it in the dashboard; automation will not replace or cancel it.");
  }
  const compare = (a, b) => {
    const left = a.split(".").map(Number);
    const right = b.split(".").map(Number);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      if ((left[i] ?? 0) !== (right[i] ?? 0)) return (left[i] ?? 0) - (right[i] ?? 0);
    }
    return 0;
  };
  if (published.some((value) => compare(value, version) >= 0)) throw new Error("Release must be newer than the published version.");
  if (status.lastAsyncUploadState === "IN_PROGRESS") throw new Error("Another upload is still processing. Retry later.");
  const upload = await request(`/upload/v2/${resource}:upload`, {
    method: "POST", headers: { "Content-Type": "application/zip" }, body: readFileSync(zip),
  });
  if (upload.crxVersion && upload.crxVersion !== version) throw new Error("Uploaded manifest version differs from the release.");
  let state = upload.uploadState;
  for (let attempt = 0; state === "IN_PROGRESS" && attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    state = (await request(statusPath)).lastAsyncUploadState;
  }
  if (state !== "SUCCEEDED") throw new Error(`Upload did not succeed (${state ?? "unknown"}). No publish request sent.`);
  const result = await request(`/v2/${resource}:publish`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publishType: "DEFAULT_PUBLISH", skipReview: false, blockOnWarnings: true }),
  });
  if (!["PENDING_REVIEW", "PUBLISHED"].includes(result.state)) throw new Error(`Unexpected submission state: ${result.state ?? "unknown"}. Check the dashboard before retrying.`);
  return { result: "submitted", version, state: result.state };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const version = JSON.parse(readFileSync("package.json", "utf8")).version;
    if (process.argv.slice(2).some((arg) => arg !== "--submit")) throw new Error("Usage: node scripts/publish-chrome-store.mjs [--submit]");
    const result = await publishChromeStore({ token: process.env.CWS_ACCESS_TOKEN, version,
      zip: `release/browser-control-extension-${version}.zip`, submit: process.argv.includes("--submit") });
    const summary = `Chrome Web Store: ${JSON.stringify(result)}\n`;
    process.stdout.write(summary);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
