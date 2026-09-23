const SENSITIVE_RECORDING_PATTERN =
  /(password|passcode|one[-_\s]?time|otp|verification[-_\s]?code|credit[-_\s]?card|card[-_\s]?number|\bcc-|cvv|cvc|security[-_\s]?code|private[-_\s]?key|secret|recovery|social[-_\s]?security|\bssn\b|aadhaar|pan[-_\s]?number|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|auth[-_]?token|bearer|authorization|cc-exp|card[-_\s]?expir)/i;
const PURCHASE_RECORDING_PATTERN =
  /\b(buy|checkout|pay|purchase|place order|confirm order|transfer|send money|bet|wager)\b/i;
const CONSEQUENTIAL_RECORDING_PATTERN = /\b(send|submit|post|publish|delete|remove|pay|buy|purchase|confirm|save)\b/i;

export const MAX_RECORDING_LABEL_CHARS = 80;
export const MAX_RECORDING_EXAMPLE_CHARS = 200;

export function cleanPageLabel(value: string, max = MAX_RECORDING_LABEL_CHARS): string {
  return value
    // eslint-disable-next-line no-control-regex -- Remove control characters from page-supplied labels.
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[`#"\\]/g, "")
    .replace(/-{3,}/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function cleanRole(value: string): string {
  const role = value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  return role || "control";
}

export function sanitizeSkillField(value: string, max: number): string {
  return value
    // eslint-disable-next-line no-control-regex -- Keep generated skill metadata on one line.
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/["\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function cleanSkillNotes(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex -- Preserve newlines while removing other controls.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => (line.trim() === "---" ? "" : line))
    .join("\n")
    .trim()
    .slice(0, 4_000);
}

export function defaultSkillName(description: string): string {
  const words = sanitizeSkillField(description, 80).split(" ").filter(Boolean).slice(0, 6).join(" ");
  return words.slice(0, 60) || "Taught skill";
}

export function publicLocation(value: string): { origin: string; path: string } | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const path = url.pathname || "/";
    return { origin: url.origin, path: path.startsWith("/") ? path : `/${path}` };
  } catch {
    return null;
  }
}

const EMAIL_ADDRESS_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

export function containsEmailAddress(value: string): boolean {
  return EMAIL_ADDRESS_PATTERN.test(value);
}

export function isSensitiveRecordingText(value: string): boolean {
  return SENSITIVE_RECORDING_PATTERN.test(value);
}

export function isPurchaseRecordingText(value: string): boolean {
  return PURCHASE_RECORDING_PATTERN.test(value);
}

export function isConsequentialRecordingText(value: string): boolean {
  return CONSEQUENTIAL_RECORDING_PATTERN.test(value);
}

export function quotePageText(value: string): string {
  return `"${cleanPageLabel(value)}"`;
}
