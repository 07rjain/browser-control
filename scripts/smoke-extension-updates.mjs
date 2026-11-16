/* global chrome */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const root = mkdtempSync(join(tmpdir(), "browser-control-updates-"));
const extension = join(root, "extension");
cpSync(resolve("dist"), extension, { recursive: true });
const manifestPath = join(extension, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const nextVersionParts = manifest.version.split(".").map(Number);
nextVersionParts[nextVersionParts.length - 1]++;
const nextVersion = nextVersionParts.join(".");
// Only this disposable unpacked copy simulates a Store-managed installation.
manifest.update_url = "https://clients2.google.com/service/update2/crx";
writeFileSync(manifestPath, JSON.stringify(manifest));
writeFileSync(join(extension, "probe.html"), "<!doctype html><title>Update test</title><body>Disposable extension page</body>");
const backgroundPath = join(extension, "background.js");
writeFileSync(backgroundPath, `
globalThis.updateFixture = { reloads: 0, checks: 0, next: {status: "no_update"}, listener: null };
const originalUpdateListener = chrome.runtime.onUpdateAvailable.addListener.bind(chrome.runtime.onUpdateAvailable);
chrome.runtime.onUpdateAvailable.addListener = (listener) => {
  globalThis.updateFixture.listener = listener;
  originalUpdateListener(listener);
};
chrome.runtime.requestUpdateCheck = async () => {
  globalThis.updateFixture.checks++;
  return globalThis.updateFixture.next;
};
chrome.runtime.reload = () => { globalThis.updateFixture.reloads++; };
// Synthetic signed-in account; never launch the installed companion or send a chat.
chrome.runtime.connectNative = () => {
  const listeners = [];
  const replies = {
    "bridge.status": {connected: true, version: "fixture"},
    "account.read": {account: {type: "chatgpt", email: null, planType: "test"}, requiresOpenaiAuth: true},
    "models.list": {models: [{id: "fixture", name: "Test model", description: "Synthetic", isDefault: true}]},
    "skills.list": {skills: []},
    "chat.settingsRead": {version: 1, systemPrompt: "Synthetic test instructions"},
    "memory.capabilities": {version: 1, automaticChanges: 2, incognito: true},
    "memory.read": {version: 1, identity: null, revision: 0, enabled: false, records: []},
    "approval.capabilities": {version: 2, available: false, configurableModel: true, editableSystemPrompt: true},
  };
  return {
    onMessage: {addListener: (listener) => listeners.push(listener)},
    onDisconnect: {addListener: () => {}},
    postMessage: ({id, method}) => {
      if (!(method in replies)) throw new Error("Unexpected native fixture request: " + method);
      queueMicrotask(() => listeners.forEach(listener => listener({type: "response", id, ok: true, data: replies[method]})));
    },
  };
};
` + readFileSync(backgroundPath, "utf8"));

let context;
try {
  context = await chromium.launchPersistentContext(join(root, "profile"), {
    channel: "chromium", headless: !process.argv.includes("--headed"),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const id = worker.url().split("/")[2];
  assert.equal(id, "mpdfhhhjgbpdpfnkjbnboebdjokfjglf");
  const errors = [];
  worker.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  const probe = await context.newPage();
  await probe.goto(`chrome-extension://${id}/probe.html`);
  const [{ windowId }] = await worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }));
  const probeSession = await context.newCDPSession(probe);
  await probeSession.send("Runtime.evaluate", { expression: `chrome.sidePanel.open({windowId:${windowId}})`, userGesture: true, awaitPromise: true });
  const browserSession = await context.browser().newBrowserCDPSession();
  let panel;
  for (let attempt = 0; attempt < 100 && !panel; attempt++) {
    panel = (await browserSession.send("Target.getTargets")).targetInfos.find(({ url }) => url === `chrome-extension://${id}/sidepanel.html`);
    if (!panel) await delay(100);
  }
  assert.ok(panel, "The real extension side panel did not open.");
  const { sessionId } = await browserSession.send("Target.attachToTarget", { targetId: panel.targetId, flatten: false });
  const pending = new Map();
  let sequence = 0;
  browserSession.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(JSON.stringify(message.params.args));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolveRequest, reject) => {
    const requestId = ++sequence;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Panel ${method} timed out.`)); }, 10_000);
    pending.set(requestId, { resolve: resolveRequest, reject, timer });
    browserSession.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: requestId, method, params }) }).catch(reject);
  });
  await send("Runtime.enable");
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, userGesture: true, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const waitFor = async (expression, description) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`${description}\n${await evaluate("document.body.innerText")}`);
  };
  await waitFor("Boolean(document.querySelector('[aria-label=\"Open settings\"]'))", "Missing Settings");
  await evaluate("document.querySelector('[aria-label=\"Open settings\"]').click()");
  await waitFor("document.body.innerText.includes('Browser Control ' + chrome.runtime.getManifest().version)", "Version was not shown");
  const check = "[...document.querySelectorAll('button')].find(b => b.textContent === 'Check for updates')";
  assert.equal(await worker.evaluate(() => globalThis.updateFixture.checks), 0);
  await evaluate(`${check}.click()`);
  await waitFor("document.body.innerText.includes(\"Chrome isn't offering a newer version right now.\")", "Missing no-update explanation");
  await worker.evaluate(() => { globalThis.updateFixture.next = { status: "throttled" }; });
  await evaluate(`${check}.click()`);
  await waitFor("document.body.innerText.includes('Chrome has checked recently.')", "Missing throttle explanation");
  console.log("PASS: actual Settings shows current version; manual no-update/throttle results are accurate.");

  await worker.evaluate((version) => globalThis.updateFixture.listener({ version }), nextVersion);
  await waitFor(`document.body.innerText.includes(${JSON.stringify(`Version ${nextVersion} is available.`)})`, "Missing pending-update instruction");
  assert.equal(await evaluate(`${check}.disabled`), true);
  await delay(1_200);
  assert.equal(await worker.evaluate(() => globalThis.updateFixture.reloads), 0);
  console.log("PASS: an open sidebar prevents automatic reload.");
  const screenshot = await send("Page.captureScreenshot", { format: "png" });
  const screenshotPath = join(tmpdir(), "browser-control-update-settings.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));

  // Closing the actual panel releases its lifetime port. An extension tab still blocks reload.
  await worker.evaluate(() => chrome.sidePanel.setOptions({ enabled: false }));
  await delay(1_200);
  assert.equal(await worker.evaluate(() => globalThis.updateFixture.reloads), 0);
  await worker.evaluate(() => chrome.storage.session.set({ codexSidebarBrowserTasks: [{ key: "fixture", finished: false, canceled: false }] }));
  await probe.close();
  await delay(1_200);
  assert.equal(await worker.evaluate(() => globalThis.updateFixture.reloads), 0);
  console.log("PASS: a persisted active task blocks reload even after all extension views close.");
  const wakeIdleCheck = async () => {
    // Tab-removal is an actual production wakeup, with no added test-only route.
    const disposable = await context.newPage();
    await disposable.close();
    await delay(1_200);
  };
  await worker.evaluate(() => chrome.storage.session.set({
    codexSidebarBrowserTasks: [{ key: "fixture", finished: true, canceled: false }],
    codexSidebarSkillRecording: { status: "review", nonce: crypto.randomUUID(), description: "Synthetic recording", name: "Test", notes: "", steps: [], truncated: false, updatedAt: Date.now() },
  }));
  await wakeIdleCheck();
  assert.equal(await worker.evaluate(() => globalThis.updateFixture.reloads), 0);
  console.log("PASS: an unsaved skill recording still blocks installation after the task finishes.");
  await worker.evaluate(() => chrome.storage.session.remove("codexSidebarSkillRecording"));
  await wakeIdleCheck();
  assert.equal(await worker.evaluate(() => globalThis.updateFixture.reloads), 1);
  assert.equal(await worker.evaluate(() => globalThis.updateFixture.checks), 2);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ browser: context.browser().version(), extensionId: id, screenshotPath,
    consoleErrors: errors, storeEvents: "synthetic", reload: "intercepted; no Store package installed" }));
} finally {
  await context?.close();
  rmSync(root, { recursive: true, force: true });
}
