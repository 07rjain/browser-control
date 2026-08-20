import { isBlockedConsequentialTarget, type PageToolCall } from "../shared/page-tools";

export interface PageTargetDescription {
  refId: string;
  snapshotId: string;
  role: string;
  label: string;
  tag: string;
  inputType: string | null;
  disabled: boolean;
  sensitive: boolean;
  href?: string;
  sameOrigin: boolean;
  newTab: boolean;
  download: boolean;
  formAssociated: boolean;
  submitter: boolean;
  form: {
    action: string;
    method: string;
    fields: Array<{ name: string; value: string; sensitive: boolean }>;
  } | null;
}

export type PageActionDecision =
  | { decision: "allow" }
  | { decision: "confirm"; title: string; description: string }
  | { decision: "refuse"; reason: string };

export function decidePageAction(call: PageToolCall, target?: PageTargetDescription): PageActionDecision {
  if (["inspect", "fill", "select", "check", "scroll", "history", "wait"].includes(call.tool)) {
    return { decision: "allow" };
  }

  if (!target) return { decision: "refuse", reason: "The page target could not be inspected safely." };
  if (target.disabled) return { decision: "refuse", reason: "The requested page control is disabled." };
  if (target.sensitive && call.tool === "keypress") {
    return { decision: "refuse", reason: "Keyboard actions are not allowed on sensitive fields." };
  }
  if (isBlockedConsequentialTarget(target.label, target.href ?? target.form?.action)) {
    return { decision: "refuse", reason: "Purchases and financial transactions are not supported." };
  }
  if (target.form && !/^https?:\/\//i.test(target.form.action)) {
    return { decision: "refuse", reason: "This form does not have a safe http or https destination." };
  }
  if (target.form?.fields.some((field) => field.sensitive)) {
    return { decision: "refuse", reason: "Forms containing passwords, uploads, payment data, codes, or other sensitive fields cannot be submitted." };
  }

  if (call.tool === "submit") {
    return {
      decision: "confirm",
      title: "Submit this form?",
      description: `Send the reviewed form to ${target.form?.action ?? "this site"}.`,
    };
  }

  if (call.tool === "keypress" && call.arguments && typeof call.arguments === "object" && "key" in call.arguments && call.arguments.key === "Enter") {
    return {
      decision: "confirm",
      title: "Press Enter here?",
      description: "Enter may submit a form or trigger an external action.",
    };
  }
  if (call.tool === "keypress") return { decision: "allow" };

  if (call.tool === "click") {
    if (target.download) return { decision: "refuse", reason: "File downloads are not supported." };
    if (target.tag === "a" && !target.href) {
      return { decision: "refuse", reason: "This link does not have a safe http or https destination." };
    }
    if (target.tag === "a" && target.sameOrigin && !target.newTab && !target.download && !target.formAssociated) {
      return { decision: "allow" };
    }
    return {
      decision: "confirm",
      title: "Click this page control?",
      description: target.newTab
        ? "This control may open a new tab. Codex will not follow it automatically."
        : "Buttons and external links can change data or trigger an external action.",
    };
  }

  return { decision: "refuse", reason: "This page action is not supported by policy." };
}
