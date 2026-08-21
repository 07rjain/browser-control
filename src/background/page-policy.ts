import {
  isBlockedConsequentialTarget,
  type BrowserPermissionMode,
  type PageToolCall,
} from "../shared/page-tools";

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

const consequentialClickPattern = /^(save|send|publish|delete|book|schedule|invite)\b|\b(create account|sign up)\b/i;

function confirmation(
  permissionMode: BrowserPermissionMode,
  title: string,
  description: string,
): PageActionDecision {
  return permissionMode === "full" ? { decision: "allow" } : { decision: "confirm", title, description };
}

export function decidePageAction(
  call: PageToolCall,
  target: PageTargetDescription | undefined,
  permissionMode: BrowserPermissionMode,
): PageActionDecision {
  if (["inspect", "fill", "select", "check", "drag", "scroll", "history", "wait"].includes(call.tool)) {
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
    return confirmation(
      permissionMode,
      "Submit this form?",
      `Send the reviewed form to ${target.form?.action ?? "this site"}.`,
    );
  }

  if (call.tool === "keypress" && call.arguments && typeof call.arguments === "object" && "key" in call.arguments && call.arguments.key === "Enter") {
    if (!target.formAssociated && !target.submitter && !consequentialClickPattern.test(target.label)) {
      return { decision: "allow" };
    }
    return confirmation(
      permissionMode,
      "Press Enter here?",
      "Enter may submit a form or trigger an external action.",
    );
  }
  if (call.tool === "keypress") return { decision: "allow" };

  if (call.tool === "click") {
    if (target.download) return { decision: "refuse", reason: "File downloads are not supported." };
    if (target.newTab && !target.href) {
      return { decision: "refuse", reason: "This popup has no safe URL that can be opened in the background." };
    }
    if (target.tag === "a" && !target.href) {
      return { decision: "refuse", reason: "This link does not have a safe http or https destination." };
    }
    if (target.submitter || consequentialClickPattern.test(target.label)) {
      return confirmation(
        permissionMode,
        "Confirm this page action?",
        "This control may send, save, publish, book, invite, delete, or otherwise change external data.",
      );
    }
    return { decision: "allow" };
  }

  return { decision: "refuse", reason: "This page action is not supported by policy." };
}
