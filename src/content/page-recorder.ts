// Chrome injects this file as a classic script, so it cannot import other chunks.
const RECORDER_PORT_NAME = "codex-page-recorder";
const SENSITIVE_RECORDING_PATTERN =
  /(password|passcode|one[-_\s]?time|otp|verification[-_\s]?code|credit[-_\s]?card|card[-_\s]?number|\bcc-|cvv|cvc|security[-_\s]?code|private[-_\s]?key|secret|recovery|social[-_\s]?security|\bssn\b|aadhaar|pan[-_\s]?number|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|auth[-_]?token|bearer|authorization|cc-exp|card[-_\s]?expir)/i;
const PURCHASE_RECORDING_PATTERN =
  /\b(buy|checkout|pay|purchase|place order|confirm order|transfer|send money|bet|wager)\b/i;

function cleanPageLabel(value: string, max = 80): string {
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/[`#"\\]/g, "")
    .replace(/-{3,}/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function cleanRole(value: string): string {
  const role = value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 40);
  return role || "control";
}

interface RecorderGlobal {
  __codexPageRecorderInstalled?: boolean;
}

interface RecordingEvent {
  isTrusted: boolean;
  type: string;
  composedPath: () => EventTarget[];
  key?: string;
  deltaY?: number;
}

type AllowedKey = "Enter" | "Escape" | "Tab" | "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight";

type RecorderReport =
  | { kind: "click"; role: string; label: string }
  | { kind: "fill"; role: string; label: string; example: string }
  | { kind: "select"; role: string; label: string; option: string }
  | { kind: "check"; role: string; label: string; checked: boolean }
  | { kind: "keypress"; key: AllowedKey }
  | { kind: "scroll"; direction: "up" | "down" | "top" | "bottom" }
  | { kind: "submit"; label: string }
  | { kind: "drag"; sourceLabel: string; targetLabel: string }
  | { kind: "skipped"; reason: "sensitive" | "purchase" };

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='tab']",
  "[role='checkbox']",
  "[role='radio']",
  "[role='combobox']",
  "[role='textbox']",
].join(",");

const ALLOWED_KEYS = new Set(["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

const recorderGlobal = globalThis as typeof globalThis & RecorderGlobal;

if (!recorderGlobal.__codexPageRecorderInstalled) {
  recorderGlobal.__codexPageRecorderInstalled = true;

  let port: chrome.runtime.Port | null = null;
  let nonce = "";
  let listening = false;
  let stopped = false;
  let retries = 0;
  let frameHost: HTMLDivElement | null = null;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let scrollDirection: "up" | "down" | null = null;
  let dragSource: Element | null = null;
  const passwordFields = new WeakSet<Element>();
  const reportedSkips = new WeakSet<Element>();
  const fillTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

  function clearFrame(): void {
    frameHost?.remove();
    frameHost = null;
  }

  function showFrame(): void {
    if (frameHost?.isConnected) return;
    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.dataset.browserControlRecording = "active";
    host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;display:block!important;pointer-events:none!important;z-index:2147483646!important;";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .frame { position: fixed; inset: 0; box-sizing: border-box; border: 3px solid rgba(226, 163, 58, .92); box-shadow: inset 0 0 22px rgba(226, 163, 58, .16); }
      .badge { position: fixed; top: 10px; left: 50%; transform: translateX(-50%); max-width: calc(100vw - 32px); padding: 7px 11px; border: 1px solid rgba(255, 255, 255, .18); border-radius: 999px; background: rgba(20, 22, 27, .92); color: #fff; font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; white-space: nowrap; }
    `;
    const frame = document.createElement("div");
    frame.className = "frame";
    const badge = document.createElement("div");
    badge.className = "badge";
    badge.textContent = "Recording a skill";
    shadow.append(style, frame, badge);
    document.documentElement.append(host);
    frameHost = host;
  }

  function isContentEditable(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    const attribute = element.getAttribute("contenteditable");
    return element.isContentEditable || attribute === "" || attribute === "true" || attribute === "plaintext-only";
  }

  function rawLabel(element: Element): string {
    const aria = element.getAttribute("aria-label") ?? "";
    if (aria.trim()) return aria;
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      if (label.trim()) return label;
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      const associated = element.labels
        ? Array.from(element.labels).map((label) => label.textContent ?? "").join(" ")
        : "";
      if (associated.trim()) return associated;
      if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.placeholder) return element.placeholder;
    }
    return element.textContent || element.getAttribute("title") || element.getAttribute("alt") || element.getAttribute("name") || "";
  }

  function fieldHaystack(element: Element): string {
    return [
      element instanceof HTMLInputElement ? element.type : "",
      element.getAttribute("autocomplete") ?? "",
      element.getAttribute("name") ?? "",
      element.id,
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("placeholder") ?? "",
      rawLabel(element),
    ].join(" ");
  }

  function rememberPassword(element: Element): void {
    if (element instanceof HTMLInputElement && element.type === "password") passwordFields.add(element);
  }

  function isSensitiveElement(element: Element): boolean {
    rememberPassword(element);
    if (passwordFields.has(element)) return true;
    if (element instanceof HTMLInputElement && element.type === "file") return true;
    const field = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || isContentEditable(element);
    if (!field) return false;
    return SENSITIVE_RECORDING_PATTERN.test(fieldHaystack(element));
  }

  function nearestControl(event: RecordingEvent): Element | null {
    for (const node of event.composedPath()) {
      if (!(node instanceof Element)) continue;
      if (node.matches(INTERACTIVE_SELECTOR)) return node;
    }
    return null;
  }

  function report(step: RecorderReport): void {
    if (!listening || !nonce || !port) return;
    try {
      port.postMessage({ type: "STEP", nonce, step });
    } catch {
      listening = false;
    }
  }

  function skip(element: Element, reason: "sensitive" | "purchase"): void {
    if (reportedSkips.has(element)) return;
    reportedSkips.add(element);
    report({ kind: "skipped", reason });
  }

  function roleAndLabel(element: Element): { role: string; label: string } {
    const explicit = element.getAttribute("role");
    let role = explicit ?? "";
    if (!role) {
      if (element instanceof HTMLAnchorElement) role = "link";
      else if (element instanceof HTMLButtonElement) role = "button";
      else if (element instanceof HTMLTextAreaElement || isContentEditable(element)) role = "textbox";
      else if (element instanceof HTMLSelectElement) role = "combobox";
      else if (element instanceof HTMLInputElement) {
        if (element.type === "checkbox") role = "checkbox";
        else if (element.type === "radio") role = "radio";
        else if (["button", "submit", "reset"].includes(element.type)) role = "button";
        else role = "textbox";
      } else role = element.tagName.toLowerCase();
    }
    return { role: cleanRole(role), label: cleanPageLabel(rawLabel(element)) };
  }

  function fieldValue(element: Element): string {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      return cleanPageLabel(element.value, 200);
    }
    if (isContentEditable(element)) return cleanPageLabel(element.textContent ?? "", 200);
    return "";
  }

  function scheduleFill(element: Element): void {
    const existing = fillTimers.get(element);
    if (existing) clearTimeout(existing);
    fillTimers.set(element, setTimeout(() => {
      fillTimers.delete(element);
      if (!listening || isSensitiveElement(element)) {
        if (listening && isSensitiveElement(element)) skip(element, "sensitive");
        return;
      }
      const identity = roleAndLabel(element);
      if (!identity.label) return;
      report({ kind: "fill", ...identity, example: fieldValue(element) });
    }, 400));
  }

  function connect(): void {
    if (stopped) return;
    port = chrome.runtime.connect({ name: RECORDER_PORT_NAME });
    port.onMessage.addListener((message: unknown) => {
      if (!message || typeof message !== "object") return;
      const command = message as { type?: string; nonce?: string };
      if (command.type === "STOP") {
        stopped = true;
        listening = false;
        clearFrame();
        port?.disconnect();
        return;
      }
      if (command.type === "START" && typeof command.nonce === "string" && command.nonce.length > 0) {
        nonce = command.nonce;
        listening = true;
        retries = 0;
        showFrame();
      }
    });
    port.onDisconnect.addListener(() => {
      port = null;
      listening = false;
      clearFrame();
      if (stopped || retries >= 3) return;
      retries += 1;
      setTimeout(connect, 250);
    });
  }

  function onClick(event: RecordingEvent): void {
    if (!listening || !event.isTrusted || event.type !== "click") return;
    const target = nearestControl(event);
    if (!target) return;
    if (isSensitiveElement(target)) {
      skip(target, "sensitive");
      return;
    }
    const identity = roleAndLabel(target);
    const href = target instanceof HTMLAnchorElement ? target.href : "";
    if (PURCHASE_RECORDING_PATTERN.test(`${identity.label} ${href}`)) {
      skip(target, "purchase");
      return;
    }
    if (!identity.label) return;
    report({ kind: "click", ...identity });
  }

  function onInput(event: RecordingEvent): void {
    if (!listening || !event.isTrusted || (event.type !== "input" && event.type !== "change")) return;
    const target = nearestControl(event);
    if (!target) return;
    rememberPassword(target);
    if (isSensitiveElement(target)) {
      skip(target, "sensitive");
      return;
    }
    if (target instanceof HTMLSelectElement && event.type === "change") {
      const identity = roleAndLabel(target);
      const option = cleanPageLabel(target.selectedOptions[0]?.textContent ?? target.value);
      if (SENSITIVE_RECORDING_PATTERN.test(`${fieldHaystack(target)} ${option}`)) {
        skip(target, "sensitive");
        return;
      }
      if (identity.label && option) report({ kind: "select", ...identity, option });
      return;
    }
    if ((target instanceof HTMLInputElement && (target.type === "checkbox" || target.type === "radio")) && event.type === "change") {
      const identity = roleAndLabel(target);
      if (identity.label) report({ kind: "check", ...identity, checked: target.checked });
      return;
    }
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      isContentEditable(target)
    ) {
      scheduleFill(target);
    }
  }

  function allowedKey(value: string | undefined): AllowedKey | null {
    if (value === "Enter" || value === "Escape" || value === "Tab" || value === "ArrowUp" || value === "ArrowDown" || value === "ArrowLeft" || value === "ArrowRight") {
      return value;
    }
    return null;
  }

  function onKeyDown(event: RecordingEvent): void {
    const key = allowedKey(event.key);
    if (!listening || !event.isTrusted || event.type !== "keydown" || !key || !ALLOWED_KEYS.has(key)) return;
    const target = nearestControl(event);
    if (target && isSensitiveElement(target)) {
      skip(target, "sensitive");
      return;
    }
    report({ kind: "keypress", key });
  }

  function onSubmit(event: RecordingEvent): void {
    if (!listening || !event.isTrusted || event.type !== "submit") return;
    const target = event.composedPath().find((node): node is HTMLFormElement => node instanceof HTMLFormElement) ?? null;
    const label = cleanPageLabel(target ? rawLabel(target) : "") || "form";
    if (PURCHASE_RECORDING_PATTERN.test(label)) {
      if (target) skip(target, "purchase");
      else report({ kind: "skipped", reason: "purchase" });
      return;
    }
    report({ kind: "submit", label });
  }

  function onDrag(event: RecordingEvent): void {
    if (!listening || !event.isTrusted) return;
    const target = nearestControl(event);
    if (!target) return;
    if (event.type === "dragstart") {
      dragSource = isSensitiveElement(target) ? null : target;
      return;
    }
    if (event.type !== "drop" || !dragSource || dragSource === target) return;
    if (isSensitiveElement(target)) {
      skip(target, "sensitive");
      dragSource = null;
      return;
    }
    const sourceLabel = roleAndLabel(dragSource).label;
    const targetLabel = roleAndLabel(target).label;
    dragSource = null;
    if (!sourceLabel || !targetLabel) return;
    report({ kind: "drag", sourceLabel, targetLabel });
  }

  function flushScroll(): void {
    scrollTimer = null;
    if (!listening || !scrollDirection) return;
    const direction = scrollDirection;
    scrollDirection = null;
    report({ kind: "scroll", direction });
  }

  function onWheel(event: RecordingEvent): void {
    if (!listening || !event.isTrusted || event.type !== "wheel" || typeof event.deltaY !== "number") return;
    if (Math.abs(event.deltaY) < 12) return;
    scrollDirection = event.deltaY > 0 ? "down" : "up";
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(flushScroll, 300);
  }

  function asRecordingEvent(event: Event): RecordingEvent {
    return {
      isTrusted: event.isTrusted,
      type: event.type,
      composedPath: () => event.composedPath(),
      key: "key" in event && typeof event.key === "string" ? event.key : undefined,
      deltaY: "deltaY" in event && typeof event.deltaY === "number" ? event.deltaY : undefined,
    };
  }

  document.addEventListener("click", (event) => onClick(asRecordingEvent(event)), true);
  document.addEventListener("input", (event) => onInput(asRecordingEvent(event)), true);
  document.addEventListener("change", (event) => onInput(asRecordingEvent(event)), true);
  document.addEventListener("keydown", (event) => onKeyDown(asRecordingEvent(event)), true);
  document.addEventListener("submit", (event) => onSubmit(asRecordingEvent(event)), true);
  document.addEventListener("dragstart", (event) => onDrag(asRecordingEvent(event)), true);
  document.addEventListener("drop", (event) => onDrag(asRecordingEvent(event)), true);
  document.addEventListener("wheel", (event) => onWheel(asRecordingEvent(event)), true);
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof Element) rememberPassword(event.target);
  }, true);
  connect();
}

export {};
