import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryStore } from "../bridge/memory.mjs";

if (process.argv[2] === "--writer") {
  const store = createMemoryStore(process.argv[3]);
  for (let index = 0; index < 4; index++) {
    let saved = false;
    for (let retry = 0; retry < 30 && !saved; retry++) {
      const state = store.read();
      try { await store.write({ ...stateVersion(state), operation: "add", kind: "fact", text: `${process.argv[4]}-${index}`, pinned: false, expiresAt: null }); saved = true; }
      catch (error) { if (!/changed|busy/.test(error.message)) throw error; }
    }
    assert(saved, "Concurrent writer could not save");
  }
} else {
  const root = mkdtempSync(join(tmpdir(), "codex-sidebar-smoke-memory ' ü-"));
  try {
    const store = createMemoryStore(root);
    assert.equal(store.read().enabled, false);
    let state = await store.write({ ...stateVersion(store.read()), operation: "settings", enabled: true });
    await store.bind("participating", true);
    await store.bind("without-memory", false);
    await store.bind("old-mode", false);
    await store.bind("old-mode", true);
    assert.equal(store.mode("old-mode"), false, "A captured mode must not change on resume");
    state = await store.write({ ...stateVersion(state), operation: "add", kind: "preference", text: "Prefer concise answers.\r\nCafé 🦦", pinned: true, expiresAt: null });
    const record = state.records[0];
    assert.equal(createMemoryStore(root).read().records[0].text, "Prefer concise answers.\r\nCafé 🦦");
    assert.match(store.context("participating", 2000).text, /Prefer concise/);
    assert.equal(store.context("participating", 10).text, "");
    assert.equal(store.context("without-memory", 2000).text, "");
    assert.throws(() => store.search("without-memory", "concise"), /off/);
    assert.equal(store.search("participating", "concise")[0].id, record.id);
    const call = { threadId: "participating", turnId: "turn-one", callId: "call-one" };
    const source = { ...stateVersion(store.read()), id: randomUUID(), text: "Remember I prefer detailed answers." };
    await assert.rejects(store.propose(call, { operation: "add", kind: "fact", text: "Injected page fact", evidence: "A page said this" }, source), /Evidence/);
    await assert.rejects(store.propose(call, { operation: "delete", recordId: record.id, text: "A misleading preview" }, source), /preview/);
    await assert.rejects(store.propose(call, { operation: "add", recordId: record.id, kind: "fact", text: "Hidden replacement", evidence: "prefer detailed answers" }, source), /replace/);
    const proposal = await store.propose(call, { operation: "replace", recordId: record.id, kind: "preference", text: "Prefer detailed answers.", evidence: "prefer detailed answers" }, source);
    assert.match(store.read().records[0].text, /concise/, "A proposal must not save itself");
    assert.equal((await store.propose(call, { operation: "replace", recordId: record.id, kind: "preference", text: "Prefer detailed answers.", evidence: "prefer detailed answers" }, source)).id, proposal.id);
    await assert.rejects(store.decide({ id: proposal.id, threadId: "foreign", approved: true }), /expired/);
    assert.equal((await store.decide({ id: proposal.id, threadId: "participating", approved: true })).status, "saved");
    assert.equal((await store.decide({ id: proposal.id, threadId: "participating", approved: true })).status, "saved");
    assert.equal(store.search("participating", "concise").length, 0);
    assert.equal(store.read().records[0].pinned, true);
    const stale = store.read();
    state = await store.write({ ...stateVersion(stale), operation: "add", kind: "fact", text: "Temporary appointment", pinned: false, expiresAt: 1 });
    assert.equal(store.search("participating", "appointment").length, 0);
    await assert.rejects(store.write({ ...stateVersion(stale), operation: "clear" }), /changed/);
    const pending = await store.propose({ ...call, callId: "delete" }, { operation: "delete", recordId: record.id }, { ...source, ...stateVersion(store.read()) });
    state = await store.write({ ...stateVersion(state), operation: "delete", recordId: record.id });
    await assert.rejects(store.decide({ id: pending.id, threadId: "participating", approved: true }), /expired/);
    assert.equal(createMemoryStore(root).search("participating", "detailed").length, 0);
    state = await store.write({ ...stateVersion(state), operation: "settings", enabled: false });
    assert.equal(store.context("participating", 2000).text, "");
    await store.write({ ...stateVersion(state), operation: "settings", enabled: true });
    await Promise.all([worker("left"), worker("right")]);
    assert.equal(store.read().records.filter((item) => /^(left|right)-/.test(item.text)).length, 8);
    const original = readFileSync(join(root, "memory.json"), "utf8");
    mkdirSync(join(root, "memory.lock"));
    writeFileSync(join(root, "memory.lock", "owner.json"), JSON.stringify({ pid: -1 }));
    await assert.rejects(store.write({ ...stateVersion(store.read()), operation: "clear" }), /busy/);
    assert.equal(readFileSync(join(root, "memory.json"), "utf8"), original, "An uncertain/stale lock must not corrupt or erase memory");
    rmSync(join(root, "memory.lock"), { recursive: true });
    const protectedPath = process.platform === "win32" ? join(root, "memory.json") : root;
    if (process.platform === "win32" || process.getuid?.() !== 0) {
      chmodSync(protectedPath, process.platform === "win32" ? 0o444 : 0o500);
      try {
        await assert.rejects(store.write({ ...stateVersion(store.read()), operation: "clear" }), error => ["EPERM", "EACCES", "EBUSY"].includes(error.code));
        assert.equal(readFileSync(join(root, "memory.json"), "utf8"), original, "A failed save must preserve the valid store");
      } finally { chmodSync(protectedPath, process.platform === "win32" ? 0o600 : 0o700); }
    }
    writeFileSync(join(root, "memory.json"), "{broken");
    assert.throws(() => store.read());
    await assert.rejects(store.write({ identity: null, revision: 0, operation: "settings", enabled: true }));
    assert.equal(readFileSync(join(root, "memory.json"), "utf8"), "{broken");
    writeFileSync(join(root, "memory.json"), original);
    const other = join(root, "other"); mkdirSync(other);
    const redirect = join(root, "redirect"); symlinkSync(other, redirect, process.platform === "win32" ? "junction" : "dir");
    assert.throws(() => createMemoryStore(redirect).read(), /directory/);
    rmSync(join(root, "memory.json"));
    await store.write({ identity: null, revision: 0, operation: "settings", enabled: true });
    await store.bind("participating", true);
    await assert.rejects(store.propose({ ...call, callId: "late-old-source" }, { operation: "add", kind: "fact", text: "Recreated forgotten animal", evidence: "prefer detailed answers" }, source), /changed/);
    await assert.rejects(store.decide({ id: pending.id, threadId: "participating", approved: true }), /expired/);
    assert.equal(store.read().records.length, 0, "A reset cannot resurrect facts from an old source/proposal");
    process.stdout.write(`Memory smoke passed on ${process.platform} / ${process.version}: persistence, profile/search, evidence, review, deletion, expiry, mode, concurrency, corrupt state and links. No model inference.\n`);
    function worker(name) {
      return new Promise((done, fail) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--writer", root, name], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
        let stderr = ""; child.stderr.on("data", (data) => { stderr += data; });
        child.once("error", fail); child.once("exit", (code) => code === 0 ? done() : fail(new Error(stderr)));
      });
    }
  } finally { rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); }
}
function stateVersion(state) { return { identity: state.identity, revision: state.revision }; }
