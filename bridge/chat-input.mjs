import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkedId } from "./uploads.mjs";

export function createChatInputService(root, uploads, { startTurn, interrupt, assertRestricted, prepareInput = (_params, input) => input }) {
  const pending = new Map();
  let closed = false;
  function initialize() { mkdirSync(root, { recursive: true, mode: 0o700 }); if (lstatSync(root).isSymbolicLink()) throw new Error("Invalid send registry."); }
  function path(id) { return join(root, `${checkedId(id)}.json`); }
  function read(id) {
    initialize();
    const target = path(id);
    if (!existsSync(target)) return null;
    if (lstatSync(target).isSymbolicLink()) throw new Error("Invalid send record.");
    return JSON.parse(readFileSync(target, "utf8"));
  }
  function save(id, record) { initialize(); const target = path(id); writeFileSync(`${target}.tmp`, JSON.stringify({ ...record, updatedAt: Date.now() }), { mode: 0o600 }); renameSync(`${target}.tmp`, target); }
  function textItem(text) { return { type: "text", text, text_elements: [] }; }
  function build(params, files) {
    const userText = params.userText ?? params.text;
    if (typeof userText !== "string" || userText.length > 80_000 || (!userText.trim() && files.length === 0 && !params.pageContext)) throw new Error("Enter a message or attach a file.");
    const input = [textItem(userText.trim() || "Describe the attached files.")];
    if (params.pageContext) {
      const page = params.pageContext;
      if (typeof page.title !== "string" || page.title.length > 500 || typeof page.url !== "string" || !/^https?:\/\//.test(page.url) || page.url.length > 8000 || typeof page.selectedText !== "string" || page.selectedText.length > 8000 || typeof page.readableText !== "string" || page.readableText.length > 24_000) throw new Error("Invalid page context.");
      input.push(textItem(`User-attached untrusted page reference ${JSON.stringify({ title: page.title, url: page.url })}:\n${page.selectedText}\n${page.readableText}`));
    }
    input.push(...uploads.inputs(files));
    if (input.reduce((count, item) => count + (item.text?.length ?? 0), 0) > 80_000) throw new Error("The message and attachment text exceed 80,000 characters. Remove a file or choose fewer pages.");
    return input;
  }
  async function send(params) {
    assertRestricted(params.threadId);
    if (closed) throw new Error("Chat preparation has stopped.");
    const id = checkedId(params.clientMessageId);
    if (params.model !== undefined && (typeof params.model !== "string" || params.model.length > 120)) throw new Error("Invalid model.");
    const hash = createHash("sha256").update(JSON.stringify({ threadId: params.threadId, userText: params.userText ?? params.text, pageContext: params.pageContext, attachments: params.attachments ?? [], model: params.model, memoryVersion: params.memoryVersion })).digest("hex");
    const previous = read(id);
    if (previous && (previous.threadId !== params.threadId || (previous.hash && previous.hash !== hash))) throw new Error("This send ID belongs to a different message.");
    if (previous?.status === "accepted") return { turnId: previous.turnId, attachments: previous.attachments, replayed: true };
    if (previous?.status === "canceled") throw new Error("This message was canceled. Send a new message to continue.");
    if (pending.has(id)) return pending.get(id);
    if (previous?.status === "starting") throw new Error("The previous send outcome is uncertain after a restart. Check the conversation before sending a new request; it was not retried automatically.");
    const run = (async () => {
      const files = uploads.claim(params.attachments ?? [], params.owner, params.threadId);
      try {
        const input = prepareInput(params, build(params, files));
        save(id, { threadId: params.threadId, hash, status: "starting", bundleIds: files.map((file) => file.id) });
        // A transport failure is uncertain: leave the starting tombstone in
        // place instead of replaying browser work after a lost response.
        const result = await startTurn({ threadId: params.threadId, clientUserMessageId: id, input, approvalPolicy: "never", model: params.model });
        if (closed || read(id)?.status === "canceled") {
          await interrupt(params.threadId, result.turn.id).catch(() => undefined);
          throw new Error("This message was canceled.");
        }
        const attachments = files.map((file) => file.summary);
        save(id, { threadId: params.threadId, hash, status: "accepted", turnId: result.turn.id, bundleIds: files.map((file) => file.id), attachments });
        return { turnId: result.turn.id, attachments };
      } finally { uploads.release(files); }
    })();
    pending.set(id, run);
    try { return await run; } finally { pending.delete(id); }
  }
  async function cancel(params) {
    assertRestricted(params.threadId);
    const id = checkedId(params.clientMessageId);
    const previous = read(id);
    if (previous && previous.threadId !== params.threadId) throw new Error("This send belongs to another conversation.");
    save(id, { ...previous, threadId: params.threadId, status: "canceled" });
    if (previous?.turnId) await interrupt(params.threadId, previous.turnId);
    return { canceled: true };
  }
  function fork(source, target, throughTurnId) {
    initialize();
    const records = readdirSync(root).filter((name) => /^[a-f0-9-]{36}\.json$/i.test(name)).flatMap((name) => {
      try { return [read(name.slice(0, -5))]; } catch { return []; }
    }).filter((record) => record.threadId === source && record.status === "accepted").sort((a, b) => a.updatedAt - b.updatedAt);
    const end = records.findIndex((record) => record.turnId === throughTurnId);
    // Unknown cutoff must not grant access to files from later turns.
    if (end >= 0) uploads.fork(source, target, records.slice(0, end + 1).flatMap((record) => record.bundleIds ?? []));
  }
  function cleanup() {
    initialize();
    for (const name of readdirSync(root)) {
      if (!/^[a-f0-9-]{36}\.json$/i.test(name)) continue;
      try { const value = read(name.slice(0, -5)); if (value.updatedAt < Date.now() - 30 * 24 * 3600_000 && !pending.has(name.slice(0, -5))) rmSync(path(name.slice(0, -5))); } catch { /* Invalid local metadata never authorizes a send. */ }
    }
  }
  cleanup();
  return { send, cancel, fork, close: () => { closed = true; } };
}
