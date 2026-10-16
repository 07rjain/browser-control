export {};

type ExecutorCommand =
  | { type: "CODEX_PAGE_EXECUTOR"; action: "PING" }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "TASK_INDICATOR"; active: boolean }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "INSPECT" }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "DESCRIBE"; snapshotId: string; refId: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "REVALIDATE"; snapshotId: string; refId: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "POPUP_GUARD_READY"; guardId: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "CLICK"; snapshotId: string; refId: string; popupGuardId?: string; expectedTarget?: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "FILL"; snapshotId: string; refId: string; value: string; mode: "replace" | "append" | "clear" }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "SELECT"; snapshotId: string; refId: string; value: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "CHECK"; snapshotId: string; refId: string; checked: boolean }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "DRAG"; snapshotId: string; sourceRefId: string; targetRefId: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "KEYPRESS"; snapshotId: string; refId: string; key: string; expectedTarget?: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "SCROLL"; direction: "up" | "down" | "top" | "bottom"; amount?: number }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "SCROLL_ELEMENT"; snapshotId: string; refId: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "SUBMIT"; snapshotId: string; refId: string; expectedTarget?: string };

interface ExecutorGlobal {
  __codexPageExecutorInstalled?: boolean;
}

const executorGlobal = globalThis as typeof globalThis & ExecutorGlobal;
let frameByDocument = new WeakMap<Document, HTMLIFrameElement>();

if (!executorGlobal.__codexPageExecutorInstalled) {
  executorGlobal.__codexPageExecutorInstalled = true;

  const MAX_ELEMENTS = 80;
  const REF_TTL_MS = 30_000;
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
  const DRAG_SELECTOR = [
    "[draggable='true']",
    "[aria-dropeffect]",
    "[role='gridcell']",
    "[role='listitem']",
    "[role='option']",
    "[role='treeitem']",
  ].join(",");
  const REFERENCED_SELECTOR = `${INTERACTIVE_SELECTOR},${DRAG_SELECTOR}`;
  const POPUP_GUARD_READY_ATTRIBUTE = "data-codex-popup-guard";
  const refs = new Map<string, { element: Element; fingerprint: string }>();
  let snapshotId = "";
  let snapshotCreatedAt = 0;
  let taskIndicatorHost: HTMLDivElement | null = null;
  let taskIndicatorLease: ReturnType<typeof setTimeout> | null = null;

  function clearTaskIndicator(): void {
    if (taskIndicatorLease !== null) clearTimeout(taskIndicatorLease);
    taskIndicatorLease = null;
    taskIndicatorHost?.remove();
    taskIndicatorHost = null;
  }

  function setTaskIndicator(active: boolean): { active: boolean } {
    if (!active) {
      clearTaskIndicator();
      return { active: false };
    }
    if (taskIndicatorLease !== null) clearTimeout(taskIndicatorLease);
    taskIndicatorLease = setTimeout(clearTaskIndicator, 2 * 60 * 1_000);
    if (taskIndicatorHost?.isConnected) return { active: true };

    const host = document.createElement("div");
    host.setAttribute("aria-hidden", "true");
    host.dataset.browserControlTaskIndicator = "active";
    host.style.cssText = "all:initial!important;position:fixed!important;inset:0!important;display:block!important;pointer-events:none!important;z-index:2147483647!important;";
    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = `
      :host { all: initial; }
      .frame { position: fixed; inset: 0; box-sizing: border-box; border: 3px solid rgba(93, 140, 255, .92); box-shadow: inset 0 0 26px rgba(93, 140, 255, .18), inset 0 0 5px rgba(82, 211, 168, .22); animation: browser-control-frame 1.8s ease-in-out infinite; }
      .badge { position: fixed; top: 10px; left: 50%; display: flex; align-items: center; gap: 7px; max-width: calc(100vw - 32px); transform: translateX(-50%); padding: 7px 11px; border: 1px solid rgba(255, 255, 255, .18); border-radius: 999px; background: rgba(20, 22, 27, .92); box-shadow: 0 8px 26px rgba(0, 0, 0, .24); color: #fff; font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: .01em; white-space: nowrap; }
      .dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #65d6ad; box-shadow: 0 0 0 4px rgba(101, 214, 173, .15); animation: browser-control-dot 1.2s ease-in-out infinite; }
      @keyframes browser-control-frame { 0%, 100% { border-color: rgba(93, 140, 255, .72); } 50% { border-color: rgba(101, 214, 173, .94); } }
      @keyframes browser-control-dot { 0%, 100% { opacity: .55; transform: scale(.9); } 50% { opacity: 1; transform: scale(1.08); } }
      @media (prefers-reduced-motion: reduce) { .frame, .dot { animation: none; } }
    `;
    const frame = document.createElement("div");
    frame.className = "frame";
    const badge = document.createElement("div");
    badge.className = "badge";
    const dot = document.createElement("span");
    dot.className = "dot";
    const label = document.createElement("span");
    label.textContent = "Browser Control is working";
    badge.append(dot, label);
    shadow.append(style, frame, badge);
    document.documentElement.append(host);
    taskIndicatorHost = host;
    return { active: true };
  }

  function text(value: string | null | undefined, max = 500): string {
    return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function isCrossFrame(element: Node, name: string): boolean {
    const view = element.ownerDocument?.defaultView as (Window & Record<string, unknown>) | null;
    const constructor = view?.[name];
    return typeof constructor === "function" && element instanceof (constructor as new () => Node);
  }

  const isInput = (node: Node): node is HTMLInputElement => isCrossFrame(node, "HTMLInputElement");
  const isTextArea = (node: Node): node is HTMLTextAreaElement => isCrossFrame(node, "HTMLTextAreaElement");
  const isSelect = (node: Node): node is HTMLSelectElement => isCrossFrame(node, "HTMLSelectElement");
  const isButton = (node: Node): node is HTMLButtonElement => isCrossFrame(node, "HTMLButtonElement");
  const isAnchor = (node: Node): node is HTMLAnchorElement => isCrossFrame(node, "HTMLAnchorElement");
  const isLabel = (node: Node): node is HTMLLabelElement => isCrossFrame(node, "HTMLLabelElement");

  function isContentEditable(element: Element): boolean {
    if (!isCrossFrame(element, "HTMLElement")) return false;
    const attribute = element.getAttribute("contenteditable");
    return (element as HTMLElement).isContentEditable || attribute === "" || attribute === "true" || attribute === "plaintext-only";
  }

  function labelledByText(element: Element): string {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (!labelledBy) return "";
    return text(
      labelledBy
        .split(/\s+/)
        .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? "")
        .join(" "),
    );
  }

  function associatedLabelText(element: Element): string {
    if (!(isInput(element) || isTextArea(element) || isSelect(element)) || !element.labels) return "";
    return text(Array.from(element.labels).map((label) => label.textContent ?? "").join(" "));
  }

  function isSensitive(element: Element): boolean {
    const input = isInput(element) ? element : null;
    if (!(input || isTextArea(element) || isContentEditable(element))) return false;
    if (input?.type === "file") return true;
    const haystack = [
      input?.type ?? "",
      element.getAttribute("autocomplete") ?? "",
      element.getAttribute("name") ?? "",
      element.id,
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("placeholder") ?? "",
      labelledByText(element),
      associatedLabelText(element),
    ].join(" ");
    return /(password|passcode|one.?time|otp|verification.?code|credit.?card|card.?number|cc-|cvv|cvc|security.?code|private.?key|secret|recovery|social.?security|ssn|aadhaar|pan.?number|api[-_]?key|access[-_]?token|refresh[-_]?token|id[-_]?token|auth[-_]?token|bearer|authorization)/i.test(haystack);
  }

  function isVisible(element: Element): boolean {
    if (!isCrossFrame(element, "HTMLElement") && !isCrossFrame(element, "SVGElement")) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    if (element.closest('[hidden], [aria-hidden="true"]')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function sameOriginDocument(frame: HTMLIFrameElement): Document | null {
    try {
      return frame.contentDocument;
    } catch {
      return null;
    }
  }

  function owningFrame(element: Element): HTMLIFrameElement | null {
    const frame = element.ownerDocument.defaultView?.frameElement;
    if (frame instanceof HTMLIFrameElement) return frame;
    return frameByDocument.get(element.ownerDocument) ?? null;
  }

  function querySelectorAllDeep(selector: string): Element[] {
    const matches: Element[] = [];
    const seen = new Set<Document | ShadowRoot>();
    frameByDocument = new WeakMap();
    const visit = (root: Document | ShadowRoot): void => {
      if (seen.has(root)) return;
      seen.add(root);
      matches.push(...Array.from(root.querySelectorAll(selector)));
      for (const element of Array.from(root.querySelectorAll("*"))) {
        if (element.shadowRoot) visit(element.shadowRoot);
        if (element instanceof HTMLIFrameElement) {
          const child = sameOriginDocument(element);
          if (!child) continue;
          frameByDocument.set(child, element);
          visit(child);
        }
      }
    };
    visit(document);
    return matches;
  }

  function inaccessibleFrameCount(): number {
    let count = 0;
    const seen = new Set<Document | ShadowRoot>();
    const visit = (root: Document | ShadowRoot): void => {
      if (seen.has(root)) return;
      seen.add(root);
      for (const frame of Array.from(root.querySelectorAll("iframe"))) {
        // querySelectorAllDeep only walks frames owned by the top document.
        if (!(frame instanceof HTMLIFrameElement)) {
          count += 1;
          continue;
        }
        const child = sameOriginDocument(frame);
        if (child) visit(child);
        else count += 1;
      }
    };
    visit(document);
    return count;
  }

  function labelFor(element: Element): string {
    const aria = text(element.getAttribute("aria-label"));
    if (aria) return aria;
    const labelledBy = labelledByText(element);
    if (labelledBy) return labelledBy;
    const associated = associatedLabelText(element);
    if (associated) return associated;
    if ((isInput(element) || isTextArea(element)) && element.placeholder) return text(element.placeholder);
    return text(element.textContent || element.getAttribute("title") || element.getAttribute("alt") || element.getAttribute("name"), 300);
  }

  function roleFor(element: Element): string {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    if (isAnchor(element)) return "link";
    if (isButton(element)) return "button";
    if (isTextArea(element)) return "textbox";
    if (isSelect(element)) return "combobox";
    if (isContentEditable(element)) return "textbox";
    if (isInput(element)) {
      if (element.type === "checkbox") return "checkbox";
      if (element.type === "radio") return "radio";
      if (["button", "submit", "reset"].includes(element.type)) return "button";
      return "textbox";
    }
    return element.tagName.toLowerCase();
  }

  function elementForm(element: Element): HTMLFormElement | null {
    if (isButton(element) || isInput(element) || isSelect(element) || isTextArea(element)) return element.form;
    const submitter = submitterFor(element);
    if (submitter) return submitter.form;
    return element.closest("form");
  }

  function isSubmitControl(element: Element): element is HTMLButtonElement | HTMLInputElement {
    if (isButton(element)) return element.type === "submit";
    return isInput(element) && ["submit", "image"].includes(element.type);
  }

  // The control whose activation behavior a click on this element triggers:
  // the element itself, an enclosing button, or a label's labeled control.
  function submitterFor(element: Element): HTMLButtonElement | HTMLInputElement | null {
    if (isSubmitControl(element)) return element;
    if (isButton(element) || isInput(element)) return null;
    const button = element.parentElement?.closest("button");
    if (button) return isSubmitControl(button) ? button : null;
    const label = element.closest("label");
    const control = label && isLabel(label) ? label.control : null;
    return control && isSubmitControl(control) ? control : null;
  }

  function formMethod(value: string | null): string {
    const method = (value ?? "").trim().toLowerCase();
    return method === "post" || method === "dialog" ? method.toUpperCase() : "GET";
  }

  // Mirrors the HTML form submission algorithm from attributes rather than
  // IDL getters, which form controls named "action" or "method" can shadow.
  function formDestination(form: HTMLFormElement, submitter: HTMLButtonElement | HTMLInputElement | null): { action: string; method: string; target: string } {
    const formDocument = form.ownerDocument;
    const rawAction = submitter?.hasAttribute("formaction")
      ? submitter.getAttribute("formaction") ?? ""
      : form.getAttribute("action") ?? "";
    let action = "";
    try {
      const resolved = new URL(rawAction.trim() || formDocument.URL, formDocument.baseURI);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") action = resolved.href;
    } catch {
      action = "";
    }
    const method = formMethod(submitter?.hasAttribute("formmethod") ? submitter.getAttribute("formmethod") : form.getAttribute("method"));
    const target = submitter?.hasAttribute("formtarget")
      ? submitter.getAttribute("formtarget") ?? ""
      : form.getAttribute("target") ?? formDocument.querySelector("base[target]")?.getAttribute("target") ?? "";
    return { action, method, target: text(target, 120) };
  }

  function safeHref(element: Element): string | undefined {
    if (!isAnchor(element) || !element.href) return undefined;
    try {
      const url = new URL(element.href, element.ownerDocument.baseURI);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
    } catch {
      return undefined;
    }
  }

  function formPreview(
    form: HTMLFormElement | null,
    submitter: HTMLButtonElement | HTMLInputElement | null,
  ) {
    if (!form) return null;
    const { action, method, target } = formDestination(form, submitter);
    const fields: Array<{ name: string; value: string; sensitive: boolean }> = [];
    const seen = new Set<Element>();
    for (const control of Array.from(form.elements)) {
      if (!(isInput(control) || isTextArea(control) || isSelect(control))) continue;
      if (!isSensitive(control)) continue;
      fields.push({
        name: text(control.name || control.id || labelFor(control), 120) || "sensitive field",
        value: "[sensitive value hidden]",
        sensitive: true,
      });
      seen.add(control);
    }
    for (const control of Array.from(form.elements)) {
      if (fields.length >= 30) break;
      if (!(isInput(control) || isTextArea(control) || isSelect(control))) continue;
      if (seen.has(control)) continue;
      if (isInput(control) && control.type === "hidden") continue;
      if (!isVisible(control)) continue;
      const name = text(control.name || control.id || labelFor(control), 120);
      if (!name) continue;
      fields.push({
        name,
        value: text(control.value, 300),
        sensitive: false,
      });
    }
    // Approval evidence is deliberately stricter than the human preview:
    // hidden, omitted, unnamed, oversized and sensitive controls prevent review.
    const values: Array<{ name: string; value: string }> = [];
    let complete = form.elements.length <= 30 && !form.querySelector("iframe,[contenteditable='true']") && !submitter?.name;
    for (const control of Array.from(form.elements)) {
      if (isCrossFrame(control, "HTMLButtonElement")) {
        const button = control as HTMLButtonElement;
        if (button.name && button.type === "submit") complete = false;
        continue;
      }
      if (!(isInput(control) || isTextArea(control) || isSelect(control))) { complete = false; continue; }
      if (control.disabled) continue;
      if (isInput(control) && ["submit", "button", "reset", "image"].includes(control.type)) {
        if (control.name && ["submit", "image"].includes(control.type)) complete = false;
        continue;
      }
      if (isSensitive(control) || (isSelect(control) && control.multiple)) { complete = false; continue; }
      const name = control.name;
      const value = control.value;
      if (!name || name.length > 120 || value.length > 300 || values.length >= 30) { complete = false; continue; }
      if (isInput(control) && control.type === "hidden") {
        if (!/^(visibility|status)$/i.test(name) || !/^(private|draft)$/i.test(value)) { complete = false; continue; }
      } else if (!isVisible(control)) { complete = false; continue; }
      if (isInput(control) && ["checkbox", "radio"].includes(control.type) && !control.checked) continue;
      values.push({ name, value });
    }
    const labelled = form.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => form.ownerDocument.getElementById(id)?.textContent ?? "").join(" ");
    const rawLabel = form.getAttribute("aria-label") || labelled || "";
    const rawRole = form.getAttribute("role") || "";
    const review = {
      complete: Boolean(complete) && rawLabel.length <= 120 && rawRole.length <= 60, label: text(rawLabel, 120), role: text(rawRole, 60), values,
      hasUndo: Array.from(form.querySelectorAll("button,input[type='button']")).some((control) => isVisible(control) && !control.hasAttribute("disabled") && /^(undo|restore)\b/i.test(labelFor(control))),
    };
    return { action, method, target, fields, review };
  }

  function describe(element: Element, refId: string) {
    const input = isInput(element) ? element : null;
    const href = safeHref(element);
    const submitter = submitterFor(element);
    return {
      refId,
      snapshotId,
      role: roleFor(element),
      label: labelFor(element),
      tag: element.tagName.toLowerCase(),
      inputType: input?.type ?? null,
      disabled:
        ("disabled" in element && Boolean((element as HTMLButtonElement).disabled)) ||
        element.getAttribute("aria-disabled") === "true",
      sensitive: isSensitive(element),
      href,
      sameOrigin: href ? new URL(href).origin === location.origin : false,
      newTab: isAnchor(element) && element.target === "_blank",
      download: isAnchor(element) && element.hasAttribute("download"),
      formAssociated: elementForm(element) !== null,
      submitter: submitter !== null,
      form: formPreview(elementForm(element), submitter),
    };
  }

  function fingerprint(element: Element): string {
    const input = isInput(element) ? element : null;
    const form = elementForm(element);
    const destination = form ? formDestination(form, submitterFor(element)) : null;
    return JSON.stringify({
      tag: element.tagName.toLowerCase(),
      role: roleFor(element),
      label: labelFor(element),
      id: element.id,
      name: element.getAttribute("name") ?? "",
      ariaLabel: element.getAttribute("aria-label") ?? "",
      inputType: input?.type ?? null,
      href: safeHref(element) ?? null,
      formAction: destination?.action ?? null,
      formMethod: destination?.method ?? null,
      formTarget: destination?.target ?? null,
    });
  }

  function resolveRef(refId: string): Element {
    const ref = refs.get(refId);
    if (!ref) throw new Error("This page element no longer exists. Inspect the page again.");
    if (ref.element.isConnected && fingerprint(ref.element) === ref.fingerprint) return ref.element;

    // Reactive applications can replace a control without changing what it is.
    // Rebind only when there is exactly one visible semantic match, so an
    // unrelated rerender does not break the action or make the target ambiguous.
    const matches = querySelectorAllDeep(REFERENCED_SELECTOR)
      .filter(isVisible)
      .filter((element) => fingerprint(element) === ref.fingerprint);
    if (matches.length !== 1) throw new Error("This page element changed or no longer exists. Inspect the page again.");
    ref.element = matches[0];
    return ref.element;
  }

  function assertFresh(refId: string, expectedSnapshotId: string, refreshExpired = false): Element {
    if (!snapshotId || expectedSnapshotId !== snapshotId) throw new Error("This page element reference is stale. Inspect the page again.");
    if (Date.now() - snapshotCreatedAt > REF_TTL_MS) {
      if (!refreshExpired) throw new Error("This page element reference expired. Inspect the page again.");
      const element = resolveRef(refId);
      snapshotCreatedAt = Date.now();
      return element;
    }
    return resolveRef(refId);
  }

  function topViewportBox(element: Element): { left: number; top: number; right: number; bottom: number } {
    const rect = element.getBoundingClientRect();
    let left = rect.left;
    let top = rect.top;
    let right = rect.right;
    let bottom = rect.bottom;
    let frame: HTMLIFrameElement | null = owningFrame(element);
    while (frame instanceof HTMLElement) {
      const frameRect = frame.getBoundingClientRect();
      const style = getComputedStyle(frame);
      const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
      const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
      left += frameRect.left + borderLeft;
      right += frameRect.left + borderLeft;
      top += frameRect.top + borderTop;
      bottom += frameRect.top + borderTop;
      frame = owningFrame(frame);
    }
    return { left, top, right, bottom };
  }

  function isInViewport(element: Element): boolean {
    const box = topViewportBox(element);
    return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
  }

  function elementAtPoint(x: number, y: number): Element | null {
    let currentDocument: Document = document;
    let localX = x;
    let localY = y;
    let found: Element | null = null;
    for (let depth = 0; depth < 8; depth += 1) {
      const hit = currentDocument.elementFromPoint(localX, localY);
      if (!hit) return found;
      found = hit;
      if (!(hit instanceof HTMLIFrameElement)) return hit;
      const child = sameOriginDocument(hit);
      if (!child) return hit;
      const frameRect = hit.getBoundingClientRect();
      const style = getComputedStyle(hit);
      localX -= frameRect.left + (Number.parseFloat(style.borderLeftWidth) || 0);
      localY -= frameRect.top + (Number.parseFloat(style.borderTopWidth) || 0);
      currentDocument = child;
    }
    return found;
  }

  function inOpenDialog(element: Element): boolean {
    const dialogSelector = "[role='dialog'], [aria-modal='true']";
    if (element.closest(dialogSelector)) return true;
    const frame = owningFrame(element);
    return frame instanceof Element && Boolean(frame.closest(dialogSelector));
  }

  function targetOwnsHit(element: Element, covering: Element): boolean {
    if (covering === element || element.contains(covering) || covering.contains(element)) return true;
    let shadowNode = element;
    let root = shadowNode.getRootNode();
    while (root instanceof ShadowRoot) {
      if (covering === root.host || covering.contains(root.host)) return true;
      shadowNode = root.host;
      root = shadowNode.getRootNode();
    }
    return false;
  }

  function hasAccessibleHitPoint(element: Element): boolean {
    const box = topViewportBox(element);
    const left = Math.max(0, box.left);
    const right = Math.min(innerWidth, box.right);
    const top = Math.max(0, box.top);
    const bottom = Math.min(innerHeight, box.bottom);
    if (right <= left || bottom <= top) return true;

    const width = right - left;
    const height = bottom - top;
    const points = [
      [left + width / 2, top + height / 2],
      [left + width * 0.2, top + height * 0.2],
      [left + width * 0.8, top + height * 0.2],
      [left + width * 0.2, top + height * 0.8],
      [left + width * 0.8, top + height * 0.8],
    ];
    let foundHit = false;
    for (const [rawX, rawY] of points) {
      const x = Math.min(innerWidth - 1, Math.max(0, rawX));
      const y = Math.min(innerHeight - 1, Math.max(0, rawY));
      const covering = elementAtPoint(x, y);
      if (!covering) continue;
      foundHit = true;
      if (targetOwnsHit(element, covering)) return true;
    }
    return !foundHit;
  }

  function assertInteractable(element: Element): void {
    if (!isVisible(element)) throw new Error("The requested element is not visible.");
    if (("disabled" in element && Boolean((element as HTMLButtonElement).disabled)) || element.getAttribute("aria-disabled") === "true") {
      throw new Error("The requested element is disabled.");
    }
    if (!isInViewport(element)) {
      throw new Error("The requested element is outside the viewport. Scroll it into view first.");
    }
    if (!hasAccessibleHitPoint(element)) throw new Error("The requested element is covered by another page element.");
  }

  function inspect() {
    refs.clear();
    snapshotId = crypto.randomUUID();
    snapshotCreatedAt = Date.now();
    const prioritizeViewport = (left: Element, right: Element): number => {
      const rank = (element: Element): number => {
        if (inOpenDialog(element) && isInViewport(element)) return 0;
        if (isInViewport(element)) return 1;
        return 2;
      };
      return rank(left) - rank(right);
    };
    const primary = querySelectorAllDeep(INTERACTIVE_SELECTOR)
      .filter(isVisible)
      .filter((element) => !isInViewport(element) || hasAccessibleHitPoint(element))
      .sort(prioritizeViewport);
    const primarySet = new Set(primary);
    const dragCandidates = querySelectorAllDeep(DRAG_SELECTOR)
      .filter(isVisible)
      .filter((element) => !isInViewport(element) || hasAccessibleHitPoint(element))
      .filter((element) => !primarySet.has(element));
    dragCandidates.sort(prioritizeViewport);
    const candidates = [...primary, ...dragCandidates];
    const elements = candidates.slice(0, MAX_ELEMENTS).map((element, index) => {
      const refId = `e${index + 1}`;
      refs.set(refId, { element, fingerprint: fingerprint(element) });
      const { form: _form, ...details } = describe(element, refId);
      void _form;
      const value =
        isInput(element) || isTextArea(element) || isSelect(element)
          ? isSensitive(element)
            ? undefined
            : text(element.value, 500)
          : isContentEditable(element)
            ? isSensitive(element)
              ? undefined
              : text(element.textContent, 500)
          : undefined;
      return { ...details, value };
    });
    return {
      title: text(document.title, 500),
      url: location.href,
      origin: location.origin,
      snapshotId,
      expiresAt: snapshotCreatedAt + REF_TTL_MS,
      elements,
      truncated: candidates.length > MAX_ELEMENTS,
      unsupportedFrames: inaccessibleFrameCount(),
    };
  }

  function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const view = element.ownerDocument.defaultView ?? window;
    const prototype = isCrossFrame(element, "HTMLTextAreaElement") ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (!setter) throw new Error("This field cannot be changed safely.");
    setter.call(element, value);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function setContentEditableValue(element: HTMLElement, value: string): void {
    const inputType = value ? "insertText" : "deleteContentBackward";
    const beforeInput = new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType, data: value || null });
    if (!element.dispatchEvent(beforeInput)) throw new Error("The page rejected the field value.");

    element.replaceChildren();
    if (value) element.append(element.ownerDocument.createTextNode(value));
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType, data: value || null }));
  }

  function isPopupGuardId(value: unknown): value is string {
    return typeof value === "string" && /^[\w-]{1,64}$/.test(value);
  }

  function assertReviewed(element: Element, refId: string, expectedTarget?: string): void {
    if (expectedTarget === undefined) return;
    if (typeof expectedTarget !== "string" || expectedTarget.length > 24_000 || JSON.stringify(describe(element, refId)) !== expectedTarget) {
      throw new Error("The reviewed page or form changed before execution. Inspect it again.");
    }
  }

  function handle(command: ExecutorCommand): unknown {
    switch (command.action) {
      case "PING":
        return { installed: true, url: location.href, origin: location.origin };
      case "TASK_INDICATOR":
        return setTaskIndicator(command.active);
      case "INSPECT":
        return inspect();
      case "DESCRIBE": {
        const element = assertFresh(command.refId, command.snapshotId);
        return describe(element, command.refId);
      }
      case "REVALIDATE": {
        const element = assertFresh(command.refId, command.snapshotId, true);
        return describe(element, command.refId);
      }
      case "POPUP_GUARD_READY":
        return { ready: isPopupGuardId(command.guardId) && document.documentElement.getAttribute(POPUP_GUARD_READY_ATTRIBUTE) === command.guardId };
      case "CLICK": {
        try {
          const element = assertFresh(command.refId, command.snapshotId);
          assertInteractable(element);
          if (isSensitive(element)) throw new Error("Browser Control will not interact with sensitive fields.");
          const before = location.href;
          (element as HTMLElement).focus({ preventScroll: true });
          assertReviewed(element, command.refId, command.expectedTarget);
          (element as HTMLElement).click();
          return { clicked: true, beforeUrl: before, label: labelFor(element) };
        } finally {
          if (isPopupGuardId(command.popupGuardId)) {
            document.documentElement.dispatchEvent(new Event(`codex-popup-guard-clicked-${command.popupGuardId}`));
          }
        }
      }
      case "FILL": {
        const element = assertFresh(command.refId, command.snapshotId);
        assertInteractable(element);
        const contentEditable = isContentEditable(element);
        if (!(isCrossFrame(element, "HTMLInputElement") || isCrossFrame(element, "HTMLTextAreaElement") || contentEditable)) {
          throw new Error("The target is not a text field.");
        }
        if (isSensitive(element)) throw new Error("Browser Control will not read or fill sensitive fields.");
        if (isInput(element) && ["checkbox", "radio", "file", "button", "submit", "reset", "image"].includes(element.type)) {
          throw new Error("Use the matching page control tool for this field type.");
        }
        const current = contentEditable ? element.textContent ?? "" : (element as HTMLInputElement | HTMLTextAreaElement).value;
        const next = command.mode === "clear" ? "" : command.mode === "append" ? current + command.value : command.value;
        (element as HTMLElement).focus({ preventScroll: true });
        if (contentEditable) setContentEditableValue(element as HTMLElement, next);
        else setNativeValue(element as HTMLInputElement | HTMLTextAreaElement, next);
        const actual = contentEditable ? element.textContent ?? "" : (element as HTMLInputElement | HTMLTextAreaElement).value;
        if (actual !== next) throw new Error("The page rejected the field value.");
        return { filled: true, label: labelFor(element), characterCount: next.length };
      }
      case "SELECT": {
        const element = assertFresh(command.refId, command.snapshotId);
        assertInteractable(element);
        if (!(element instanceof HTMLSelectElement)) throw new Error("The target is not a select control.");
        const option = Array.from(element.options).find((item) => item.value === command.value || text(item.textContent) === command.value);
        if (!option || option.disabled) throw new Error("That option is unavailable.");
        element.value = option.value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        if (element.value !== option.value) throw new Error("The page rejected the selected option.");
        return { selected: true, label: labelFor(element), option: text(option.textContent) };
      }
      case "CHECK": {
        const element = assertFresh(command.refId, command.snapshotId);
        assertInteractable(element);
        if (!(element instanceof HTMLInputElement) || !["checkbox", "radio"].includes(element.type)) {
          throw new Error("The target is not a checkbox or radio button.");
        }
        if (element.type === "radio" && !command.checked) throw new Error("A radio button cannot be unchecked directly.");
        if (element.checked !== command.checked) element.click();
        if (element.checked !== command.checked) throw new Error("The page rejected the requested checked state.");
        return { checked: element.checked, label: labelFor(element) };
      }
      case "DRAG": {
        const source = assertFresh(command.sourceRefId, command.snapshotId);
        const target = assertFresh(command.targetRefId, command.snapshotId);
        assertInteractable(source);
        assertInteractable(target);
        if (source === target) throw new Error("Drag source and target must be different controls.");
        const dataTransfer = new DataTransfer();
        const eventInit: DragEventInit = { bubbles: true, cancelable: true, dataTransfer };
        source.dispatchEvent(new DragEvent("dragstart", eventInit));
        target.dispatchEvent(new DragEvent("dragenter", eventInit));
        target.dispatchEvent(new DragEvent("dragover", eventInit));
        target.dispatchEvent(new DragEvent("drop", eventInit));
        source.dispatchEvent(new DragEvent("dragend", eventInit));
        return { dragged: true, source: labelFor(source), target: labelFor(target) };
      }
      case "KEYPRESS": {
        const element = assertFresh(command.refId, command.snapshotId) as HTMLElement;
        assertInteractable(element);
        if (isSensitive(element)) throw new Error("Browser Control will not interact with sensitive fields.");
        element.focus({ preventScroll: true });
        assertReviewed(element, command.refId, command.expectedTarget);
        if (command.key === "Tab") {
          const focusable = querySelectorAllDeep("a[href],button,input,textarea,select,[tabindex]:not([tabindex='-1'])")
            .filter(isVisible) as HTMLElement[];
          const index = focusable.indexOf(element);
          focusable[(index + 1) % focusable.length]?.focus();
        } else if (command.key === "Enter") {
          const form = elementForm(element);
          if (form) form.requestSubmit(submitterFor(element) ?? undefined);
          else element.click();
        } else {
          element.dispatchEvent(new KeyboardEvent("keydown", { key: command.key, bubbles: true }));
          element.dispatchEvent(new KeyboardEvent("keyup", { key: command.key, bubbles: true }));
        }
        return { key: command.key, dispatched: true, label: labelFor(element) };
      }
      case "SCROLL": {
        const amount = command.amount ?? Math.max(300, Math.round(innerHeight * 0.75));
        if (command.direction === "top") scrollTo({ top: 0, behavior: "auto" });
        else if (command.direction === "bottom") scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
        else scrollBy({ top: command.direction === "up" ? -amount : amount, behavior: "auto" });
        return { scrolled: true, direction: command.direction, scrollY };
      }
      case "SCROLL_ELEMENT": {
        const element = assertFresh(command.refId, command.snapshotId);
        element.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        return { scrolled: true, direction: "element", label: labelFor(element) };
      }
      case "SUBMIT": {
        const element = assertFresh(command.refId, command.snapshotId);
        assertInteractable(element);
        const form = elementForm(element);
        if (!form) throw new Error("The requested element is not associated with a form.");
        if (!form.checkValidity()) {
          const invalid = Array.from(form.querySelectorAll(":invalid")).slice(0, 10).map(labelFor);
          return { submitted: false, validationFailed: true, invalidFields: invalid };
        }
        assertReviewed(element, command.refId, command.expectedTarget);
        const submitter = submitterFor(element);
        const destination = formDestination(form, submitter);
        form.requestSubmit(submitter ?? undefined);
        return { submitted: true, action: destination.action, method: destination.method };
      }
    }
  }

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab !== undefined || !message || typeof message !== "object") return false;
    const command = message as Partial<ExecutorCommand>;
    if (command.type !== "CODEX_PAGE_EXECUTOR" || typeof command.action !== "string") return false;
    try {
      sendResponse({ ok: true, data: handle(command as ExecutorCommand) });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Page action failed." });
    }
    return false;
  });
}
