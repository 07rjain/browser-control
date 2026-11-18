/* global chrome */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const browserPathIndex = process.argv.indexOf("--browsers-path");
if (browserPathIndex >= 0) process.env.PLAYWRIGHT_BROWSERS_PATH = process.argv[browserPathIndex + 1];
const { chromium } = await import("playwright");
const root = mkdtempSync(join(tmpdir(), "browser-control-attachment-"));
const extension = join(root, "extension");
cpSync(resolve("dist"), extension, { recursive: true });
const manifestPath = join(extension, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.host_permissions = ["http://127.0.0.1/*"];
writeFileSync(manifestPath, JSON.stringify(manifest));
writeFileSync(join(extension, "probe.html"), "<!doctype html><title>Browser Control probe</title><body>Browser test</body>");
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end("<!doctype html><title>Attachment fixture</title><body><h1>Public attachment heading</h1><p>Public body text.</p></body>");
});
let context;
try {
  await new Promise((resolveListen, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolveListen); });
  context = await chromium.launchPersistentContext(join(root, "profile"), {
    channel: "chromium", headless: !process.argv.includes("--headed"),
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  // Exercise a real Chrome missing-host disconnect without touching the user's
  // registered companion or account.
  await worker.evaluate(() => {
    const connect = chrome.runtime.connectNative.bind(chrome.runtime);
    chrome.runtime.connectNative = () => connect("com.browser_control_missing_fixture");
  });
  const id = worker.url().split("/")[2];
  assert.equal(id, "mpdfhhhjgbpdpfnkjbnboebdjokfjglf");
  const probe = await context.newPage();
  await probe.goto(`chrome-extension://${id}/probe.html`);
  const fixture = await context.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  await fixture.goto(`${origin}/`);
  const [{ windowId }] = await worker.evaluate(() => chrome.tabs.query({ active: true, currentWindow: true }));
  const probeSession = await context.newCDPSession(probe);
  await probeSession.send("Runtime.evaluate", {
    expression: `chrome.sidePanel.open({windowId:${windowId}})`, userGesture: true, awaitPromise: true,
  });
  // Chromium exposes the side panel as a CDP target, outside context.pages().
  // Drive that actual surface: a normal extension tab has a different sender and
  // is correctly rejected by production message validation.
  const browserSession = await context.browser().newBrowserCDPSession();
  let panel;
  for (let attempt = 0; attempt < 100 && !panel; attempt++) {
    panel = (await browserSession.send("Target.getTargets")).targetInfos.find(({ url }) => url === `chrome-extension://${id}/sidepanel.html`);
    if (!panel) await delay(100);
  }
  assert.ok(panel, "The actual extension side panel did not open.");
  const { sessionId } = await browserSession.send("Target.attachToTarget", { targetId: panel.targetId, flatten: false });
  const pending = new Map();
  let nextId = 0;
  const consoleErrors = [];
  browserSession.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") consoleErrors.push(JSON.stringify(message.params.args));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolveRequest, reject) => {
    const requestId = ++nextId;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Side panel ${method} timed out.`)); }, 10_000);
    pending.set(requestId, { resolve: resolveRequest, reject, timer });
    browserSession.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: requestId, method, params }) }).catch((error) => {
      clearTimeout(timer); pending.delete(requestId); reject(error);
    });
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
  const click = async (selector) => {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, `Missing ${selector}`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  await waitFor("document.body.innerText.includes('The companion is not registered in this browser yet.')", "Missing-host installation guidance was lost.");
  await waitFor("[...document.querySelectorAll('button')].some(button => button.textContent === 'Retry connection')", "Missing Retry connection.");
  console.log("PASS: actual native-host disconnect retains installation guidance and Retry.");

  // Only the account transport is synthetic from here on. Page capture,
  // permissions, extension messages, and the packaged UI remain real.
  await worker.evaluate(() => {
    let memory = { version: 1, identity: "11111111-1111-4111-8111-111111111111", revision: 1, enabled: true, records: [{ id: "22222222-2222-4222-8222-222222222222", kind: "fact", text: "My test name is Rishabh", pinned: false, createdAt: 1, updatedAt: 1, expiresAt: null, source: { type: "manual" } }] };
    let reviewSupport = { version: 2, available: false, configurableModel: true, editableSystemPrompt: true, codexVersion: "0.169.0",
      reason: "Auto review is unavailable for Codex CLI 0.169.0. Verified versions: 0.162.1, 0.164.0, 0.165.0. Use Ask every time until this version passes the isolated reviewer checks." };
    globalThis.changeFixtureReviewSupport = (support) => { reviewSupport = support; };
    let accountError = null;
    let signedIn = true;
    const authUrl = "https://auth.openai.com/authorize?fixture=browser-control-recovery";
    globalThis.fixtureAuthRequests = [];
    const createTab = chrome.tabs.create.bind(chrome.tabs);
    chrome.tabs.create = (options) => {
      if (options.url !== authUrl) return createTab(options);
      globalThis.fixtureAuthRequests.push("open-login-page");
      return Promise.resolve({ id: -1 }); // Never open a real sign-in page in this fixture.
    };
    chrome.runtime.connectNative = () => {
      const listeners = [];
      globalThis.expireFixtureSession = () => {
        accountError = "Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.";
        listeners.forEach(listener => listener({ type: "event", event: "auth.updated", data: {} }));
      };
      globalThis.finishFixtureLogin = () => {
        signedIn = true;
        accountError = null;
        listeners.forEach(listener => listener({ type: "event", event: "auth.loginCompleted", data: { loginId: "fixture-login", success: true } }));
      };
      globalThis.changeFixtureMemory = (text) => {
        memory = { ...memory, revision: memory.revision + 1, records: [{ ...memory.records[0], text }] };
        listeners.forEach(listener => listener({ type: "event", event: "memory.changed", data: {} }));
      };
      return {
        onMessage: { addListener: (listener) => listeners.push(listener) },
        onDisconnect: { addListener: () => {} },
        postMessage: ({ id, method, params }) => {
          if (method === "account.read" && accountError) {
            queueMicrotask(() => listeners.forEach(listener => listener({ type: "response", id, ok: false, error: accountError })));
            return;
          }
          if (method === "auth.logout") {
            globalThis.fixtureAuthRequests.push(method);
            signedIn = false;
            accountError = null;
            // The logout notification must not race the new login back to the welcome state.
            listeners.forEach(listener => listener({ type: "event", event: "auth.updated", data: {} }));
          }
          if (method === "auth.login") globalThis.fixtureAuthRequests.push(method);
          if (method === "memory.write") {
            if (params.operation === "replace") memory = { ...memory, revision: memory.revision + 1, records: memory.records.map(record => record.id === params.recordId ? { ...record, ...params, updatedAt: Date.now() } : record) };
            if (params.operation === "settings") memory = { ...memory, enabled: params.enabled, revision: memory.revision + 1 };
          }
          const replies = {
            "bridge.status": { connected: true, version: "fixture" },
            "account.read": { account: signedIn ? { type: "chatgpt", email: null, planType: "test" } : null, requiresOpenaiAuth: true },
            "auth.logout": {},
            "auth.login": { type: "chatgpt", loginId: "fixture-login", authUrl },
            "models.list": { models: [{ id: "fixture", name: "Synthetic test model", description: "Local browser fixture", isDefault: true }] },
            "skills.list": { skills: [] },
            "chat.settingsRead": { version: 1, systemPrompt: "Synthetic browser test instructions" },
            "memory.capabilities": { version: 1, automaticChanges: 2, incognito: true },
            "memory.read": memory,
            "memory.write": memory,
            "approval.capabilities": reviewSupport,
          };
          if (method === "chat.send") throw new Error("This browser check must never send a chat.");
          queueMicrotask(() => listeners.forEach((listener) => listener({ type: "response", id, ok: method in replies, data: replies[method], error: `No fixture for ${method}` })));
        },
      };
    };
  });
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Retry connection').click()");
  await waitFor("Boolean(document.querySelector('[aria-label=\"Attach the current page\"]'))", "Retry did not recover the composer.");
  // Observe the actual response; do not replace it or inject a page attachment.
  await evaluate(`(() => {
    const sendMessage = chrome.runtime.sendMessage.bind(chrome.runtime);
    globalThis.attachmentResults = [];
    chrome.runtime.sendMessage = async (...args) => {
      const result = await sendMessage(...args);
      if (args[0]?.type === 'PAGE_ATTACH') globalThis.attachmentResults.push(result);
      return result;
    };
  })()`);
  for (let cycle = 0; cycle < 2; cycle++) {
    await click('[aria-label="Attach the current page"]');
    await waitFor("Boolean(document.querySelector('.attachment-card'))", "Attach page produced no card.");
    const result = await evaluate("globalThis.attachmentResults.at(-1)");
    assert.equal(result.ok, true);
    assert.equal(result.data.title, "Attachment fixture");
    assert.equal(result.data.origin, origin);
    assert.match(result.data.readableText, /Public attachment heading/);
    assert.match(result.data.readableText, /Public body text\./);
    await click(cycle === 0 ? '[aria-label="Detach the current page"]' : '[aria-label="Remove page attachment"]');
    await waitFor("!document.querySelector('.attachment-card') && Boolean(document.querySelector('[aria-label=\"Attach the current page\"]'))", "Detach did not restore Attach page.");
  }
  console.log("PASS: Attach → Detach → Attach → Remove captures real page text.");
  await click('[aria-label="Open settings"]');
  assert.equal(await evaluate("document.querySelector('[role=tabpanel]:not([hidden]) input').type"), "checkbox", "General controls must precede appearance");
  await click('[role="tab"][id$="-models-tab"]');
  assert.equal(await evaluate("document.querySelector('[role=tabpanel]:not([hidden]) input, [role=tabpanel]:not([hidden]) select').type"), "checkbox", "Model visibility toggles must come first");
  await click('[role="tab"][id$="-agent-tab"]');
  await waitFor("document.querySelector('.companion-support')?.textContent.includes('Codex CLI 0.169.0 is supported')", "The legacy companion's known-version refusal was not diagnosed.");
  assert.equal(await evaluate("document.querySelector('option[value=auto]').disabled"), true);
  const repairScreenshotIndex = process.argv.indexOf("--screenshots-dir");
  if (repairScreenshotIndex >= 0) {
    const directory = resolve(process.argv[repairScreenshotIndex + 1]); mkdirSync(directory, { recursive: true });
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(directory, "companion-repair.png"), Buffer.from(screenshot.data, "base64"));
  }

  assert.equal(await evaluate("document.querySelector('option[value=auto]').parentElement.value"), "full");
  assert.equal(await evaluate("document.querySelector('.companion-support').textContent.includes('supports Linux, macOS, and Windows')"), true);
  await worker.evaluate(() => globalThis.changeFixtureReviewSupport({ version: 2, available: true, configurableModel: true, editableSystemPrompt: true,
    codexVersion: "0.169.0", companionVersion: "0.3.11", verifiedCodexVersions: ["0.169.0"] }));
  await evaluate("[...document.querySelectorAll('.companion-support button')].find(button => button.textContent === 'Check support again').click()");
  await waitFor("document.querySelector('option[value=auto]')?.disabled === false", "Support did not refresh after the companion became compatible.");
  assert.equal(await evaluate("document.querySelector('option[value=auto]').parentElement.value"), "full", "A recheck must not change permission mode.");
  console.log("PASS: legacy 0.169.0 companion refusal shows cross-platform repair; recheck enables Auto review without changing permission.");
  await click('[role="tab"][id$="-memory-tab"]');
  await waitFor("document.querySelector('.memory-list textarea')?.value === 'My test name is Rishabh'", "Saved memory did not load automatically.");
  assert.equal(await evaluate("[...document.querySelectorAll('.memory-settings button')].some(button => /Refresh memory|Start a chat without memory|^Edit$/.test(button.textContent))"), false);
  assert.equal(await evaluate("Boolean(document.querySelector('.memory-settings input[type=datetime-local]'))"), false);
  await evaluate(`(() => { const field = document.querySelector('.memory-list textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'My test name is Alex'); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await evaluate("document.querySelector('.memory-list form').requestSubmit()");
  await waitFor("document.querySelector('.memory-settings [role=status]')?.textContent.includes('Memory saved')", "Inline memory save did not finish.");
  await worker.evaluate(() => globalThis.changeFixtureMemory("My test name is Morgan"));
  await waitFor("document.querySelector('.memory-list textarea')?.value === 'My test name is Morgan'", "Native memory change did not reload the list.");
  const screenshotIndex = process.argv.indexOf("--screenshots-dir");
  if (screenshotIndex >= 0) {
    const directory = resolve(process.argv[screenshotIndex + 1]); mkdirSync(directory, { recursive: true });
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(directory, "memory-settings.png"), Buffer.from(screenshot.data, "base64"));
  }
  await click('[aria-label="Close settings"]');
  await click('[aria-label="Start incognito chat"]');
  await waitFor("Boolean(document.querySelector('.incognito-banner')) && document.querySelector('[aria-label=\"Start incognito chat\"]').getAttribute('aria-pressed') === 'true'", "Incognito entry did not show its visible state.");
  await click('[aria-label="Start a new chat"]');
  await waitFor("!document.querySelector('.incognito-banner')", "Leaving incognito did not restore regular chat.");
  console.log("PASS: Settings controls first, inline memory edit/automatic reload, no expiry/refresh/card controls, and incognito entry/exit. Synthetic companion only; no chat send.");
  await fixture.goto("chrome://version");
  await click('[aria-label="Attach the current page"]');
  await waitFor("Boolean(document.querySelector('[role=\"alert\"]'))", "Protected page failure was silent.");
  assert.equal(await evaluate("Boolean(document.querySelector('.attachment-card'))"), false);
  assert.equal((await evaluate("globalThis.attachmentResults.at(-1)")).ok, false);

  // Authentication recovery through the real sidebar and worker with only the
  // native account boundary simulated. The user's companion is never touched.
  await evaluate(`(() => { const field = document.querySelector('[aria-label="Message Browser Control"]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, 'Keep my unsent draft'); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const beforeRecovery = await worker.evaluate(() => chrome.storage.local.get(null));
  await worker.evaluate(() => globalThis.expireFixtureSession());
  await waitFor("[...document.querySelectorAll('button')].some(button => button.textContent === 'Sign in again')", "Revoked account did not offer sign-in recovery.");
  await waitFor("getComputedStyle(document.querySelector('.welcome-action')).opacity === '1'", "Sign-in recovery button stayed hidden.");
  assert.equal(await evaluate("document.querySelector('h1').textContent"), "Sign in again to continue.");
  assert.equal(await evaluate("document.body.innerText.includes('Companion connected')"), true);
  assert.equal(await evaluate("[...document.querySelectorAll('button')].some(button => /Retry connection|Install or update companion/.test(button.textContent))"), false);
  assert.deepEqual(await worker.evaluate(() => globalThis.fixtureAuthRequests), [], "Recovery must require a click.");
  assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, "Recovery overflows the narrow sidebar.");
  assert.equal(await evaluate("document.querySelector('.welcome-action').getBoundingClientRect().height >= 44"), true, "Recovery needs a comfortable touch target.");
  if (screenshotIndex >= 0) {
    const screenshot = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(resolve(process.argv[screenshotIndex + 1]), "sign-in-recovery.png"), Buffer.from(screenshot.data, "base64"));
  }
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === 'Sign in again').click()");
  await waitFor("document.body.innerText.includes('Finish signing in with ChatGPT')", "Recovery did not start a fresh login.");
  assert.deepEqual(await worker.evaluate(() => globalThis.fixtureAuthRequests), ["auth.logout", "auth.login", "open-login-page"]);
  await worker.evaluate(() => globalThis.finishFixtureLogin());
  await waitFor("document.querySelector('[aria-label=\"Message Browser Control\"]')?.value === 'Keep my unsent draft'", "Login did not restore the unsent draft.");
  assert.deepEqual(await worker.evaluate(() => chrome.storage.local.get(null)), beforeRecovery, "Sign-in recovery changed local saved data.");
  await click('[aria-label="Open settings"]');
  await click('[role="tab"][id$="-memory-tab"]');
  await waitFor("document.querySelector('.memory-list textarea')?.value === 'My test name is Morgan'", "Sign-in recovery lost saved memory.");
  await click('[aria-label="Close settings"]');
  console.log("PASS: revoked-session recovery explicitly logs out then starts login; logout notification does not race login; draft, local data, and memory survive. Synthetic account; no chat replay or real login.");
  assert.deepEqual(consoleErrors, []);
  console.log(`PASS: protected-page failure stays visible; no sidebar console errors. ${process.platform}, Chromium ${context.browser().version()}.`);
} finally {
  await context?.close();
  server.closeAllConnections();
  await new Promise((resolveClose) => server.close(resolveClose));
  rmSync(root, { recursive: true, force: true });
}
