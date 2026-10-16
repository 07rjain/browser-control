import { AUTO_REVIEW_POLICY_VERSION, REVIEW_MAX_INPUT, type ReviewEvidence, type AutoReviewSettings } from "../shared/auto-review";
import { looksSensitiveField, type PageToolCall } from "../shared/page-tools";
import type { PageTargetDescription } from "./page-policy";

const mandatoryHuman = /\b(delete|remove|erase|discard|send|publish|post|invite|share|book|schedule|purchase|checkout|payment|password|security|permissions?|account|subscribe|unsubscribe|sign.?up|log.?in|sign.?in)\b/i;
const clean = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/g, " ").trim();
const secret = (value: string) => looksSensitiveField([value]) || /\bsk-[a-z0-9_-]{10,}|\bbearer\s+\S+|\b\d{3}-\d{2}-\d{4}\b/i.test(value);

export function reviewedTarget(target: PageTargetDescription): string {
  return JSON.stringify({ refId: target.refId, snapshotId: target.snapshotId, role: target.role, label: target.label, tag: target.tag, inputType: target.inputType,
    disabled: target.disabled, sensitive: target.sensitive, href: target.href, form: target.form, submitter: target.submitter, newTab: target.newTab, download: target.download });
}

export function reviewCandidate(call: PageToolCall, target: PageTargetDescription | undefined, instruction: string | undefined, tabId: number, origin: string): { evidence: ReviewEvidence } | { reason: string } {
  const ask = (reason = "This action needs your review because its intent or effect is not sufficiently verified.") => ({ reason });
  if (!instruction?.trim() || instruction.length > 4000 || secret(instruction)) return ask("The request lacks complete, non-sensitive user instructions for automatic review.");
  if (!target || !["submit", "click", "keypress"].includes(call.tool) || target.disabled || target.sensitive || target.download || target.newTab) return ask();
  if (call.tool === "keypress" && (call.arguments as { key?: string }).key !== "Enter") return ask();
  const form = target.form;
  if (target.label.length >= 180 || !form?.review?.complete || !form.review.values.length || form.fields.some((field) => field.sensitive) || mandatoryHuman.test(`${target.label} ${form.review.label}`)) return ask();
  if (form.target && form.target.toLowerCase() !== "_self") return ask("Actions that open a new browsing context need your review.");
  let destination: URL;
  try { destination = new URL(form.action); if (destination.origin !== origin || !/^https?:$/.test(destination.protocol) || destination.username || destination.password || destination.search || destination.hash) return ask("The action has an unexpected or incomplete destination."); } catch { return ask(); }
  const values = form.review.values;
  if (values.some((field) => (/^visibility$/i.test(field.name) && field.value !== "private") || (/^status$/i.test(field.name) && field.value !== "draft"))) return ask("Privacy or draft status is not established.");
  if (values.some((field) => secret(field.name) || secret(field.value)) || new Set(values.map((field) => field.name)).size !== values.length) return ask();
  const requested = clean(instruction);
  const allValuesRequested = values.filter((field) => !/^(visibility|status)$/i.test(field.name)).every((field) => field.value.trim().length > 0 && requested.includes(clean(field.value)));
  if (!allValuesRequested) return ask("Some proposed values are not stated in your request.");
  let category: ReviewEvidence["category"] | undefined;
  if (form.method.toUpperCase() === "GET" && values.length === 1 && /^(q|query|search|search_query|searchterm)$/i.test(values[0].name) && /\b(search|find|look up)\b/i.test(instruction) &&
    (/\bsearch\b/i.test(`${form.review.role} ${form.review.label} ${target.label}`)) && /(?:^|\/)search\/?$|^\/$/i.test(destination.pathname)) category = "search";
  else if (/\/(preferences|settings\/(appearance|display|preferences))\/?$/i.test(destination.pathname) && /\b(appearance|display|preferences)\b/i.test(form.review.label) && /\b(set|change|switch|save|update)\b/i.test(instruction) && values.every((field) => /^(theme|language|locale|timezone|density|color_scheme|font_size)$/i.test(field.name))) category = "preference";
  else if (values.some((field) => field.name === "visibility" && field.value === "private") && values.every((field) => /^(title|subject|body|content|text|visibility|status)$/i.test(field.name))) {
    if (/\/drafts(?:\/[^/]+)?\/?$/i.test(destination.pathname) && /\bdraft\b/i.test(form.review.label) && /\b(save|create|update)\b.*\bdraft\b/i.test(instruction)) category = "draft";
    else if (/\/(notes|private-notes)(?:\/[^/]+)?\/?$/i.test(destination.pathname) && /\bprivate\b.*\bnote\b/i.test(form.review.label) && /\bprivate\b.*\bnote\b|\bnote\b.*\bprivate\b/i.test(instruction) && /\b(create|save|edit|update|change)\b/i.test(instruction) && form.review.hasUndo) category = "private_record";
  }
  if (!category) return ask();
  const evidence: ReviewEvidence = { policyVersion: AUTO_REVIEW_POLICY_VERSION, category, userInstruction: instruction,
    action: { namespace: "page", tool: call.tool, arguments: call.arguments }, page: { tabId, origin },
    untrustedTarget: { label: target.label, role: target.role, form } };
  if (JSON.stringify(evidence).length > REVIEW_MAX_INPUT) return ask("The complete action context exceeds the automatic-review limit.");
  return { evidence };
}

export async function reviewFingerprint(call: PageToolCall, target: PageTargetDescription, evidence: ReviewEvidence, configuration?: AutoReviewSettings): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify({ threadId: call.threadId, turnId: call.turnId, callId: call.callId, arguments: call.arguments, target: reviewedTarget(target), evidence, configuration }));
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}
