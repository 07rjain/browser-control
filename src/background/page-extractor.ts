import { pageAttachmentSchema, type PageAttachment } from "../shared/protocol";

const READABLE_TEXT_LIMIT = 24_000;

export class PagePermissionRequiredError extends Error {
  readonly originPattern: string;

  constructor(originPattern: string) {
    super("This site needs one-time extension access before its page can be attached.");
    this.name = "PagePermissionRequiredError";
    this.originPattern = originPattern;
  }
}

export async function captureCurrentPage(): Promise<PageAttachment> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) throw new Error("No active page is available.");

  const url = new URL(tab.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Chrome does not allow page attachment on this protected page.");
  }

  const originPattern = `${url.origin}/*`;

  let executionResult: chrome.scripting.InjectionResult<unknown>[];
  try {
    executionResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [READABLE_TEXT_LIMIT],
      func: (limit: number) => {
      const selectedText = window.getSelection()?.toString().trim().slice(0, 8_000) ?? "";
      const clone = document.body?.cloneNode(true) as HTMLElement | undefined;
      if (clone) {
        clone
          .querySelectorAll(
            "script,style,noscript,template,svg,canvas,form,input,textarea,select,button,[hidden],[aria-hidden='true']",
          )
          .forEach((node) => node.remove());
      }
      const normalized = (clone?.innerText ?? "")
        .replace(/\u00a0/g, " ")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return {
        title: document.title.slice(0, 500),
        url: location.href,
        origin: location.origin,
        selectedText,
        readableText: normalized.slice(0, limit),
        characterCount: normalized.length,
        truncated: normalized.length > limit,
      };
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/permission|cannot access contents|not allowed/i.test(message)) {
      throw new PagePermissionRequiredError(originPattern);
    }
    throw error;
  }

  const [{ result }] = executionResult;
  if (!result) throw new Error("The page did not return readable content.");
  return pageAttachmentSchema.parse(result);
}
