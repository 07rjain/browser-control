export {};

type ExecutorCommand =
  | { type: "CODEX_PAGE_EXECUTOR"; action: "PING" }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "TASK_INDICATOR"; active: boolean }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "INSPECT" }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "DESCRIBE"; snapshotId: string; refId: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "REVALIDATE"; snapshotId: string; refId: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "CLICK"; snapshotId: string; refId: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "FILL"; snapshotId: string; refId: string; value: string; mode: "replace" | "append" | "clear" }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "SELECT"; snapshotId: string; refId: string; value: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "CHECK"; snapshotId: string; refId: string; checked: boolean }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "DRAG"; snapshotId: string; sourceRefId: string; targetRefId: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "KEYPRESS"; snapshotId: string; refId: string; key: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "SCROLL"; direction: "up" | "down" | "top" | "bottom"; amount?: number }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "SCROLL_ELEMENT"; snapshotId: string; refId: string }
  | { type: "CODEX_PAGE_EXECUTOR"; action: "SUBMIT"; snapshotId: string; refId: string };

interface ExecutorGlobal {
  __codexPageExecutorInstalled?: boolean;
}

const executorGlobal = globalThis as typeof globalThis & ExecutorGlobal;

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

  function isContentEditable(element: Element): boolean {
    if (!(element instanceof HTMLElement)) return false;
    const attribute = element.getAttribute("contenteditable");
    return element.isContentEditable || attribute === "" || attribute === "true" || attribute === "plaintext-only";
  }

  function isSensitive(element: Element): boolean {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || isContentEditable(element))) return false;
    if (element instanceof HTMLInputElement && element.type === "file") return true;
    const haystack = [
      element instanceof HTMLInputElement ? element.type : "",
      element.getAttribute("autocomplete") ?? "",
      element.getAttribute("name") ?? "",
      element.id,
      element.getAttribute("aria-label") ?? "",
      element.getAttribute("placeholder") ?? "",
    ].join(" ");
    return /(password|passcode|one.?time|otp|verification.?code|credit.?card|card.?number|cc-|cvv|cvc|security.?code|private.?key|secret|recovery|social.?security|ssn|aadhaar|pan.?number)/i.test(haystack);
  }

  function isVisible(element: Element): boolean {
    if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    if (element.closest('[hidden], [aria-hidden="true"]')) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function querySelectorAllDeep(selector: string): Element[] {
    const matches: Element[] = [];
    const visit = (root: Document | ShadowRoot): void => {
      matches.push(...Array.from(root.querySelectorAll(selector)));
      for (const element of Array.from(root.querySelectorAll("*"))) {
        if (element.shadowRoot) visit(element.shadowRoot);
      }
    };
    visit(document);
    return matches;
  }

  function labelFor(element: Element): string {
    const aria = text(element.getAttribute("aria-label"));
    if (aria) return aria;
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const label = text(
        labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? "")
          .join(" "),
      );
      if (label) return label;
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      const associated = element.labels ? text(Array.from(element.labels).map((label) => label.textContent ?? "").join(" ")) : "";
      if (associated) return associated;
      if ((element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && element.placeholder) {
        return text(element.placeholder);
      }
    }
    return text(element.textContent || element.getAttribute("title") || element.getAttribute("alt") || element.getAttribute("name"), 300);
  }

  function roleFor(element: Element): string {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    if (element instanceof HTMLAnchorElement) return "link";
    if (element instanceof HTMLButtonElement) return "button";
    if (element instanceof HTMLTextAreaElement) return "textbox";
    if (element instanceof HTMLSelectElement) return "combobox";
    if (isContentEditable(element)) return "textbox";
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox") return "checkbox";
      if (element.type === "radio") return "radio";
      if (["button", "submit", "reset"].includes(element.type)) return "button";
      return "textbox";
    }
    return element.tagName.toLowerCase();
  }

  function elementForm(element: Element): HTMLFormElement | null {
    if (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
      return element.form;
    }
    return element.closest("form");
  }

  function safeHref(element: Element): string | undefined {
    if (!(element instanceof HTMLAnchorElement) || !element.href) return undefined;
    try {
      const url = new URL(element.href, location.href);
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : undefined;
    } catch {
      return undefined;
    }
  }

  function formPreview(form: HTMLFormElement | null): { action: string; method: string; fields: Array<{ name: string; value: string; sensitive: boolean }> } | null {
    if (!form) return null;
    let action = "";
    try {
      const target = new URL(form.action || location.href, location.href);
      if (target.protocol === "http:" || target.protocol === "https:") action = target.href;
    } catch {
      action = "";
    }
    const fields: Array<{ name: string; value: string; sensitive: boolean }> = [];
    for (const control of Array.from(form.elements).slice(0, 30)) {
      if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) continue;
      if (control instanceof HTMLInputElement && control.type === "hidden") continue;
      if (!isVisible(control)) continue;
      const name = text(control.name || control.id || labelFor(control), 120);
      if (!name) continue;
      const sensitive = isSensitive(control);
      fields.push({
        name,
        value: sensitive ? "[sensitive value hidden]" : text(control.value, 300),
        sensitive,
      });
    }
    return { action, method: (form.method || "get").toUpperCase(), fields };
  }

  function describe(element: Element, refId: string) {
    const input = element instanceof HTMLInputElement ? element : null;
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
      href: safeHref(element),
      sameOrigin: safeHref(element) ? new URL(safeHref(element) as string).origin === location.origin : false,
      newTab: element instanceof HTMLAnchorElement && element.target === "_blank",
      download: element instanceof HTMLAnchorElement && element.hasAttribute("download"),
      formAssociated: elementForm(element) !== null,
      submitter:
        (element instanceof HTMLButtonElement && (element.type || "submit") === "submit") ||
        (element instanceof HTMLInputElement && ["submit", "image"].includes(element.type)),
      form: formPreview(elementForm(element)),
    };
  }

  function fingerprint(element: Element): string {
    const input = element instanceof HTMLInputElement ? element : null;
    const form = elementForm(element);
    return JSON.stringify({
      tag: element.tagName.toLowerCase(),
      role: roleFor(element),
      label: labelFor(element),
      id: element.id,
      name: element.getAttribute("name") ?? "",
      ariaLabel: element.getAttribute("aria-label") ?? "",
      inputType: input?.type ?? null,
      href: safeHref(element) ?? null,
      formAction: form?.action ?? null,
      formMethod: form ? (form.method || "get").toUpperCase() : null,
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

  function isInViewport(element: Element): boolean {
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
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
    const rect = element.getBoundingClientRect();
    const left = Math.max(0, rect.left);
    const right = Math.min(innerWidth, rect.right);
    const top = Math.max(0, rect.top);
    const bottom = Math.min(innerHeight, rect.bottom);
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
      const covering = document.elementFromPoint(x, y);
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
    const prioritizeViewport = (left: Element, right: Element): number => Number(isInViewport(right)) - Number(isInViewport(left));
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
        element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
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
      unsupportedFrames: document.querySelectorAll("iframe").length,
    };
  }

  function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
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
    if (value) element.append(document.createTextNode(value));
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType, data: value || null }));
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
      case "CLICK": {
        const element = assertFresh(command.refId, command.snapshotId);
        assertInteractable(element);
        const before = location.href;
        (element as HTMLElement).focus({ preventScroll: true });
        (element as HTMLElement).click();
        return { clicked: true, beforeUrl: before, label: labelFor(element) };
      }
      case "FILL": {
        const element = assertFresh(command.refId, command.snapshotId);
        assertInteractable(element);
        const contentEditable = isContentEditable(element);
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || contentEditable)) {
          throw new Error("The target is not a text field.");
        }
        if (isSensitive(element)) throw new Error("Browser Control will not read or fill sensitive fields.");
        if (element instanceof HTMLInputElement && ["checkbox", "radio", "file", "button", "submit", "reset", "image"].includes(element.type)) {
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
        element.focus({ preventScroll: true });
        if (command.key === "Tab") {
          const focusable = querySelectorAllDeep("a[href],button,input,textarea,select,[tabindex]:not([tabindex='-1'])")
            .filter(isVisible) as HTMLElement[];
          const index = focusable.indexOf(element);
          focusable[(index + 1) % focusable.length]?.focus();
        } else if (command.key === "Enter") {
          const form = elementForm(element);
          if (form) form.requestSubmit();
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
        const submitter =
          (element instanceof HTMLButtonElement && element.type === "submit") ||
          (element instanceof HTMLInputElement && ["submit", "image"].includes(element.type))
            ? element
            : undefined;
        form.requestSubmit(submitter);
        return { submitted: true, action: form.action || location.href, method: (form.method || "get").toUpperCase() };
      }
    }
  }

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== "object") return false;
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
