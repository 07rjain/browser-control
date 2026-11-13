/* global chrome, document */
// Tests the packaged executor over real extension messages, without a model,
// companion installation, user profile, or external website mutations.
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const root = mkdtempSync(join(tmpdir(), "browser-control-inspection-"));
const extension = join(root, "extension");
cpSync(resolve("dist"), extension, { recursive: true });
const manifestPath = join(extension, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
// Only the disposable test copy gets a loopback grant.
manifest.host_permissions = ["http://127.0.0.1/*"];
writeFileSync(manifestPath, JSON.stringify(manifest));
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><title>Thread inspection fixture</title>
    <main><article id="post">Opening post: the account was closed without an explanation.</article>
    <article>A reply: explain the edge case publicly.</article></main>
    <div contenteditable="true" role="textbox" aria-label="Post text">Keep my reply draft</div>
    <div style="display:none"><span>hidden-fixture-marker</span></div>
    <div style="opacity:0"><span>transparent-fixture-marker</span></div>
    <textarea aria-label="API key">secret-fixture-marker</textarea>
    <div style="height:2000px"></div><footer>Bottom of fixture</footer>`);
});
let context;
try {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  context = await chromium.launchPersistentContext(join(root, "profile"), {
    channel: "chromium", headless: !process.argv.includes("--headed"),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const id = worker.url().split("/")[2];
  assert.equal(id, "mpdfhhhjgbpdpfnkjbnboebdjokfjglf");
  const errors = [];
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  worker.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(`${origin}/`);
  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}/*` }))[0].id, origin);
  await worker.evaluate(async (targetId) => {
    await chrome.scripting.executeScript({ target: { tabId: targetId }, files: ["page-executor.js"] });
  }, tabId);
  const command = async (message) => {
    const response = await worker.evaluate(({ targetId, commandMessage }) => chrome.tabs.sendMessage(targetId, {
      type: "CODEX_PAGE_EXECUTOR", ...commandMessage,
    }), { targetId: tabId, commandMessage: message });
    assert.equal(response.ok, true, response.error);
    return response.data;
  };
  const first = await command({ action: "INSPECT" });
  assert.match(first.readableText, /Opening post: the account was closed/);
  assert.match(first.readableText, /explain the edge case publicly/);
  assert.doesNotMatch(first.readableText, /Keep my reply draft|hidden-fixture-marker|transparent-fixture-marker|secret-fixture-marker/);
  assert.doesNotMatch(JSON.stringify(first), /secret-fixture-marker/);
  assert.equal(first.elements.find(({ label }) => label === "Post text").value, "Keep my reply draft");
  assert.equal(first.textTruncated, false);
  console.log("PASS: static posts and draft control values; hidden text and secrets excluded.");

  assert.equal((await command({ action: "SCROLL", direction: "bottom" })).scrolled, true);
  // Simulate a virtualized thread mounting a different post after scrolling.
  await page.locator("#post").evaluate((post) => { post.textContent = "Newly mounted post after scrolling"; });
  const second = await command({ action: "INSPECT" });
  assert.match(second.readableText, /Newly mounted post after scrolling/);
  assert.doesNotMatch(second.readableText, /Opening post: the account/);
  assert.notEqual(first.snapshotId, second.snapshotId);
  assert.equal(await page.locator("[contenteditable]").textContent(), "Keep my reply draft");
  console.log("PASS: scroll and reinspection refresh text without altering the draft.");

  await page.evaluate(() => {
    document.querySelector("main").innerHTML = `<article>Dense thread post</article>${"<button>Reply</button>".repeat(90)}`;
  });
  const dense = await command({ action: "INSPECT" });
  assert.equal(dense.truncated, true);
  assert.equal(dense.textTruncated, false);
  assert.match(dense.readableText, /Dense thread post/);
  await page.locator("main").evaluate((main) => { main.textContent = "x".repeat(12_001); });
  const limited = await command({ action: "INSPECT" });
  assert.equal(limited.readableText.length, 12_000);
  assert.equal(limited.textTruncated, true);
  console.log("PASS: text remains readable beyond 80 controls; character budget is independent.");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: context.browser().version(), extensionId: id, consoleErrors: errors }));
} finally {
  await context?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(root, { recursive: true, force: true });
}
