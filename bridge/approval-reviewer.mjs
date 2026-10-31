import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { CODEX_THREAD_RESTRICTIONS } from "./protocol.mjs";

const reviewerConfig = JSON.parse(readFileSync(new URL("./reviewer-config.json", import.meta.url), "utf8"));
export const REVIEW_MODEL = reviewerConfig.defaultModel;
const DEFAULT_REVIEW_SYSTEM_PROMPT = reviewerConfig.systemPrompt;
const MAX_REVIEW_SYSTEM_PROMPT = reviewerConfig.maxSystemPromptChars;
const validModel = (model) => typeof model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(model);
const reasons = ["requested_benign_search", "requested_preference", "requested_draft", "requested_private_record", "requires_human", "unclear_intent", "missing_context", "unsafe", "unavailable", "timeout", "canceled", "invalid_result", "busy", "budget", "recovered"];
export const REVIEW_OUTPUT_SCHEMA = { type: "object", properties: {
  decision: { type: "string", enum: ["approve", "ask_user"] }, risk: { type: "string", enum: ["low", "medium", "high", "critical", "unknown"] },
  matchesUserRequest: { type: "boolean" }, missingContext: { type: "boolean" },
  reasonCode: { type: "string", enum: reasons }, reason: { type: "string", minLength: 1, maxLength: 240 },
}, required: ["decision", "risk", "matchesUserRequest", "missingContext", "reasonCode", "reason"], additionalProperties: false };

export function reviewerCapabilities(userAgent) {
  const codexVersion = typeof userAgent === "string" ? userAgent.match(/\/(\d+\.\d+\.\d+)(?=\s|$|\()/)?.[1] ?? "unknown" : "unknown";
  const available = reviewerConfig.verifiedCodexVersions.includes(codexVersion);
  return { version: 2, available, configurableModel: true, editableSystemPrompt: true, codexVersion,
    ...(available ? {} : { reason: `Auto review is unavailable for Codex CLI ${codexVersion}. Verified versions: ${reviewerConfig.verifiedCodexVersions.join(", ")}. Use Ask every time until this version passes the isolated reviewer checks.` }) };
}

export function fallback(reasonCode, reason) { return { decision: "ask_user", risk: "unknown", matchesUserRequest: false, missingContext: true, reasonCode, reason }; }
export function parseReviewVerdict(text) {
  if (typeof text !== "string" || Buffer.byteLength(text) > 2048) throw new Error("Oversized reviewer result.");
  const value = JSON.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...REVIEW_OUTPUT_SCHEMA.required].sort().join()) throw new Error("Invalid reviewer result.");
  if (!["approve", "ask_user"].includes(value.decision) || !["low", "medium", "high", "critical", "unknown"].includes(value.risk) || typeof value.matchesUserRequest !== "boolean" || typeof value.missingContext !== "boolean" || !reasons.includes(value.reasonCode) || typeof value.reason !== "string" || !value.reason.trim() || value.reason.length > 240) throw new Error("Invalid reviewer result.");
  return value;
}

export function createApprovalReviewer({ request, workspace, timeoutMs = 10_000 }) {
  const threads = new Map();
  const quarantinedThreads = new Set();
  const jobs = new Map();
  let closed = false;
  function finish(job, result) {
    if (job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    job.resolve(result);
    // Keep the thread quarantined for this process even after cancellation.
    if (job.threadId) {
      if (job.turnId) void request("turn/interrupt", { threadId: job.threadId, turnId: job.turnId }).catch(() => undefined);
      void request("thread/unsubscribe", { threadId: job.threadId }).catch(() => undefined);
      threads.delete(job.threadId);
    }
    jobs.delete(job.id);
  }
  async function review(params) {
    if (closed) return fallback("unavailable", "The reviewer is unavailable. Review this action yourself.");
    if (jobs.has(params.reviewId)) return jobs.get(params.reviewId).promise;
    if (jobs.size) return fallback("busy", "The reviewer is busy. Review this action yourself.");
    if (quarantinedThreads.size >= 4096) return fallback("unavailable", "Restart the companion to continue automatic review.");
    if (!/^[a-f0-9-]{36}$/i.test(params.reviewId ?? "") || !validModel(params.model) || !params.evidence || params.evidence.policyVersion !== 1 || typeof params.parentThreadId !== "string" || typeof params.parentTurnId !== "string" || JSON.stringify(params.evidence).length > 8000) throw new Error("Invalid bounded review request.");
    const model = params.model;
    const systemPrompt = params.systemPrompt ?? DEFAULT_REVIEW_SYSTEM_PROMPT;
    if (typeof systemPrompt !== "string" || !systemPrompt.trim() || systemPrompt.length > MAX_REVIEW_SYSTEM_PROMPT || systemPrompt.includes("\0")) throw new Error("Invalid reviewer system prompt.");
    const remaining = params.deadline === undefined ? timeoutMs : Math.min(timeoutMs, params.deadline - Date.now());
    if (!Number.isFinite(remaining) || remaining <= 0) return fallback("timeout", "The review expired. Review this action yourself.");
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    const job = { id: params.reviewId, parentThreadId: params.parentThreadId, parentTurnId: params.parentTurnId, promise, resolve, done: false, text: "", timer: null, threadId: null, turnId: null };
    jobs.set(job.id, job);
    job.timer = setTimeout(() => finish(job, fallback("timeout", "The review timed out. Review this action yourself.")), remaining);
    void (async () => {
      try {
        const started = await request("thread/start", { cwd: workspace, runtimeWorkspaceRoots: [workspace], ...CODEX_THREAD_RESTRICTIONS, model, ephemeral: true, approvalPolicy: "never", sandbox: "read-only", dynamicTools: [], baseInstructions: systemPrompt, developerInstructions: reviewerConfig.requiredInstructions });
        job.threadId = started.thread.id;
        quarantinedThreads.add(job.threadId);
        if (job.done) { void request("thread/unsubscribe", { threadId: job.threadId }).catch(() => undefined); return; }
        threads.set(job.threadId, job);
        const result = await request("turn/start", { threadId: job.threadId, model, approvalPolicy: "never", ...(model === REVIEW_MODEL ? { effort: "low" } : {}), outputSchema: REVIEW_OUTPUT_SCHEMA, input: [{ type: "text", text: JSON.stringify(params.evidence), text_elements: [] }], clientUserMessageId: randomUUID() });
        job.turnId = result.turn.id;
        if (job.done) void request("turn/interrupt", { threadId: job.threadId, turnId: job.turnId }).catch(() => undefined);
      } catch { finish(job, fallback("unavailable", "The reviewer could not complete this request. Review the action yourself.")); }
    })();
    return promise;
  }
  function handle(message) {
    const threadId = message.params?.threadId ?? message.params?.thread?.id;
    if (!quarantinedThreads.has(threadId)) return false;
    const job = threads.get(threadId);
    if (message.id !== undefined && message.method) {
      if (job) finish(job, fallback("invalid_result", "The reviewer attempted a tool call. Review the action yourself."));
      return { reject: true };
    }
    if (!job) return true;
    if (message.params?.turnId) job.turnId = message.params.turnId;
    if (message.method === "item/agentMessage/delta") {
      job.text += message.params.delta ?? "";
      if (Buffer.byteLength(job.text) > 2048) finish(job, fallback("invalid_result", "The reviewer returned an oversized result. Review the action yourself."));
    } else if (message.method === "item/completed" && message.params?.item?.type === "agentMessage") {
      job.text = message.params.item.text;
      if (typeof job.text !== "string" || Buffer.byteLength(job.text) > 2048) finish(job, fallback("invalid_result", "The reviewer returned an invalid result. Review the action yourself."));
    } else if (message.method === "turn/completed") {
      if (message.params.turn?.status !== "completed") finish(job, fallback("unavailable", "The reviewer did not finish. Review the action yourself."));
      else { try { finish(job, parseReviewVerdict(job.text)); } catch { finish(job, fallback("invalid_result", "The reviewer returned an invalid decision. Review the action yourself.")); } }
    } else if (message.method === "error") finish(job, fallback("unavailable", "The reviewer is unavailable. Review the action yourself."));
    return true;
  }
  function cancel(parentThreadId, parentTurnId) {
    for (const job of jobs.values()) if (job.parentThreadId === parentThreadId && (!parentTurnId || job.parentTurnId === parentTurnId)) finish(job, fallback("canceled", "The review was canceled."));
  }
  const cancelAll = () => { for (const job of jobs.values()) finish(job, fallback("canceled", "The review was canceled.")); };
  return { review, handle, cancel, cancelAll, close: () => { closed = true; cancelAll(); } };
}
