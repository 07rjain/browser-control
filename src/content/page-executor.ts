export {};

type ExecutorCommand =
  | { type: "CODEX_PAGE_EXECUTOR"; action: "PING" }
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

  function text(value: string | null | undefined, max = 500): string {
    return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  }

  function isSensitive(element: Element): boolean {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return false;
    if (element instanceof HTMLInputElement && element.type === "file") return true;
    const haystack = [
      element.type,
      element.autocomplete,
      element.name,
      element.id,
      element.getAttribute("aria-label") ?? "",
      element.placeholder,
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
    const matches = Array.from(document.querySelectorAll(REFERENCED_SELECTOR))
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

  function assertInteractable(element: Element): void {
    if (!isVisible(element)) throw new Error("The requested element is not visible.");
    if (("disabled" in element && Boolean((element as HTMLButtonElement).disabled)) || element.getAttribute("aria-disabled") === "true") {
      throw new Error("The requested element is disabled.");
    }
    const rect = element.getBoundingClientRect();
    if (rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) {
      throw new Error("The requested element is outside the viewport. Scroll it into view first.");
    }
    const x = Math.min(innerWidth - 1, Math.max(0, rect.left + rect.width / 2));
    const y = Math.min(innerHeight - 1, Math.max(0, rect.top + rect.height / 2));
    if (x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) {
      const covering = document.elementFromPoint(x, y);
      if (covering && covering !== element && !element.contains(covering) && !covering.contains(element)) {
        throw new Error("The requested element is covered by another page element.");
      }
    }
  }

  function inspect() {
    refs.clear();
    snapshotId = crypto.randomUUID();
    snapshotCreatedAt = Date.now();
    const primary = Array.from(document.querySelectorAll(INTERACTIVE_SELECTOR)).filter(isVisible);
    const primarySet = new Set(primary);
    const dragCandidates = Array.from(document.querySelectorAll(DRAG_SELECTOR))
      .filter(isVisible)
      .filter((element) => !primarySet.has(element));
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

  function handle(command: ExecutorCommand): unknown {
    switch (command.action) {
      case "PING":
        return { installed: true, url: location.href, origin: location.origin };
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
        if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) throw new Error("The target is not a text field.");
        if (isSensitive(element)) throw new Error("Codex Sidebar will not read or fill sensitive fields.");
        if (["checkbox", "radio", "file", "button", "submit", "reset", "image"].includes(element.type)) {
          throw new Error("Use the matching page control tool for this field type.");
        }
        const next = command.mode === "clear" ? "" : command.mode === "append" ? element.value + command.value : command.value;
        element.focus({ preventScroll: true });
        setNativeValue(element, next);
        if (element.value !== next) throw new Error("The page rejected the field value.");
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
          const focusable = Array.from(document.querySelectorAll<HTMLElement>("a[href],button,input,textarea,select,[tabindex]:not([tabindex='-1'])")).filter(isVisible);
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
