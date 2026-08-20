import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PageAttachment, SidebarEvent, UiResponse } from "../shared/protocol";

type AuthState = "checking" | "signed-out" | "authenticating" | "ready" | "offline" | "error";
type Theme = "system" | "light" | "dark";

interface Account {
  type: "chatgpt";
  email: string | null;
  planType: string | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  failed?: boolean;
}

interface LoginDetails {
  loginId: string;
  authUrl: string;
}

interface ToolApproval {
  callId: string;
  tool: "close";
  target: { id: number; title: string; url: string };
}

interface ToolStatus {
  callId: string;
  tool: string;
  status: string;
  error?: string;
}

interface PersistedState {
  threadId: string | null;
  messages: ChatMessage[];
  theme: Theme;
}

interface RetryPayload {
  displayText: string;
  outboundText: string;
}

const INITIAL_STATE: PersistedState = { threadId: null, messages: [], theme: "system" };
const STORAGE_KEY = "codexSidebarState";
const PAGE_ORIGINS_KEY = "codexSidebarGrantedPageOrigins";

class ExtensionRequestError extends Error {
  readonly code?: string;
  readonly details?: unknown;

  constructor(response: Extract<UiResponse, { ok: false }>) {
    super(response.error);
    this.name = "ExtensionRequestError";
    this.code = response.code;
    this.details = response.details;
  }
}

async function sendRequest<T>(request: Record<string, unknown>): Promise<T> {
  const response = (await chrome.runtime.sendMessage({
    ...request,
    requestId: crypto.randomUUID(),
  })) as UiResponse;
  if (!response?.ok) {
    throw new ExtensionRequestError(
      response ?? { ok: false, error: "The extension did not respond.", code: "NO_RESPONSE" },
    );
  }
  return response.data as T;
}

function formatPageContext(text: string, attachment: PageAttachment | null): string {
  if (!attachment) return text;
  const selected = attachment.selectedText
    ? `\n\nSelected text:\n${attachment.selectedText}`
    : "";
  const body = attachment.readableText
    ? `\n\nReadable page text${attachment.truncated ? " (truncated)" : ""}:\n${attachment.readableText}`
    : "";
  return `${text}\n\n--- BEGIN USER-ATTACHED UNTRUSTED PAGE CONTEXT ---\nTitle: ${attachment.title}\nURL: ${attachment.url}${selected}${body}\n--- END USER-ATTACHED UNTRUSTED PAGE CONTEXT ---`;
}

function compactPlan(plan: string | null): string {
  if (!plan) return "ChatGPT";
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>("checking");
  const [account, setAccount] = useState<Account | null>(null);
  const [login, setLogin] = useState<LoginDetails | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<PageAttachment | null>(null);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>("system");
  const [toolApproval, setToolApproval] = useState<ToolApproval | null>(null);
  const [toolStatuses, setToolStatuses] = useState<ToolStatus[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [retryPayload, setRetryPayload] = useState<RetryPayload | null>(null);
  const [pendingPageOrigin, setPendingPageOrigin] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const threadReadyRef = useRef(false);
  const inFlightPayloadRef = useRef<RetryPayload | null>(null);
  const turnExecutedToolRef = useRef(false);

  const streaming = activeTurnId !== null || isSending;

  const refreshAccount = useCallback(async () => {
    try {
      const result = await sendRequest<{ account: Account | null }>({ type: "ACCOUNT_READ" });
      setAccount(result.account);
      setAuthState(result.account?.type === "chatgpt" ? "ready" : "signed-out");
      setError(null);
    } catch (cause) {
      setAuthState("offline");
      setError(cause instanceof Error ? cause.message : "The local companion is unavailable.");
    }
  }, []);

  useEffect(() => {
    void chrome.storage.local
      .get(STORAGE_KEY)
      .then((stored) => {
        const state = (stored[STORAGE_KEY] as PersistedState | undefined) ?? INITIAL_STATE;
        setThreadId(state.threadId);
        setMessages(Array.isArray(state.messages) ? state.messages.map((message) => ({ ...message, streaming: false })) : []);
        setTheme(state.theme ?? "system");
        setHydrated(true);
      })
      .finally(() => void refreshAccount());
  }, [refreshAccount]);

  useEffect(() => {
    if (!hydrated) return;
    const retainedMessages = messages.slice(-100).map((message) => ({
      ...message,
      text: message.text.slice(0, 100_000),
    }));
    void chrome.storage.local.set({
      [STORAGE_KEY]: { threadId, messages: retainedMessages, theme } satisfies PersistedState,
    });
  }, [hydrated, messages, theme, threadId]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, toolApproval, toolStatuses]);

  useEffect(() => {
    const listener = (message: SidebarEvent) => {
      if (message?.source !== "codex-sidebar-background") return;
      switch (message.event) {
        case "bridge.status":
          if ((message.data as { connected?: boolean })?.connected === false) setAuthState("offline");
          break;
        case "auth.updated":
        case "auth.loginCompleted":
          void refreshAccount();
          break;
        case "chat.delta": {
          const data = message.data as { turnId: string; delta: string };
          setActiveTurnId(data.turnId);
          setMessages((current) => {
            const index = current.findLastIndex((item) => item.role === "assistant" && item.streaming);
            if (index < 0) {
              return [...current, { id: data.turnId, role: "assistant", text: data.delta, streaming: true }];
            }
            return current.map((item, itemIndex) =>
              itemIndex === index ? { ...item, id: data.turnId, text: item.text + data.delta } : item,
            );
          });
          break;
        }
        case "chat.messageCompleted": {
          const data = message.data as { turnId: string; item: { text: string } };
          setMessages((current) =>
            current.map((item) =>
              item.role === "assistant" && item.streaming
                ? { ...item, id: data.turnId, text: data.item.text, streaming: false }
                : item,
            ),
          );
          break;
        }
        case "chat.turnCompleted":
          setActiveTurnId(null);
          setIsSending(false);
          setRetryPayload(null);
          inFlightPayloadRef.current = null;
          setMessages((current) => current.map((item) => ({ ...item, streaming: false })));
          break;
        case "chat.error":
          setActiveTurnId(null);
          setIsSending(false);
          setRetryPayload(turnExecutedToolRef.current ? null : inFlightPayloadRef.current);
          setError(
            turnExecutedToolRef.current
              ? "Codex stopped after a browser action. Review the result before sending another request."
              : "Codex could not complete this response. You can retry your message.",
          );
          setMessages((current) =>
            current.map((item) => (item.streaming ? { ...item, streaming: false, failed: true } : item)),
          );
          break;
        case "tool.approval":
          setToolApproval(message.data as ToolApproval);
          break;
        case "tool.status": {
          const status = message.data as ToolStatus;
          if (status.status === "succeeded") turnExecutedToolRef.current = true;
          setToolStatuses((current) => [...current.filter((item) => item.callId !== status.callId), status].slice(-5));
          if (["succeeded", "failed", "rejected"].includes(status.status)) {
            setToolApproval((current) => (current?.callId === status.callId ? null : current));
          }
          break;
        }
        case "bridge.error":
          setError((message.data as { message?: string })?.message ?? "The native companion reported an error.");
          break;
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [refreshAccount]);

  const signIn = async () => {
    setAuthState("authenticating");
    setError(null);
    try {
      const result = await sendRequest<LoginDetails & { type: string }>({ type: "AUTH_LOGIN" });
      setLogin(result);
      await sendRequest({ type: "OPEN_EXTERNAL", url: result.authUrl });
    } catch (cause) {
      setAuthState("error");
      setError(cause instanceof Error ? cause.message : "Unable to begin ChatGPT sign-in.");
    }
  };

  const cancelLogin = async () => {
    if (login) await sendRequest({ type: "AUTH_CANCEL", loginId: login.loginId }).catch(() => undefined);
    setLogin(null);
    setAuthState("signed-out");
  };

  const signOut = async () => {
    await sendRequest({ type: "AUTH_LOGOUT" });
    setAccount(null);
    setLogin(null);
    setAuthState("signed-out");
    setMenuOpen(false);
  };

  const attachPage = async () => {
    setError(null);
    setPendingPageOrigin(null);
    try {
      setAttachment(await sendRequest<PageAttachment>({ type: "PAGE_ATTACH" }));
    } catch (cause) {
      if (cause instanceof ExtensionRequestError && cause.code === "PAGE_PERMISSION_REQUIRED") {
        const originPattern = (cause.details as { originPattern?: unknown } | undefined)?.originPattern;
        if (typeof originPattern === "string") {
          setPendingPageOrigin(originPattern);
          setError("Allow access to this site to attach its current page.");
          return;
        }
      }
      setError(cause instanceof Error ? cause.message : "This page cannot be attached.");
    }
  };

  const grantPageAccess = async () => {
    if (!pendingPageOrigin) return;
    const originPattern = pendingPageOrigin;
    try {
      const granted = await chrome.permissions.request({ origins: [originPattern] });
      if (!granted) {
        setError("Site access was not granted. No page content was read.");
        return;
      }
      const stored = await chrome.storage.local.get(PAGE_ORIGINS_KEY);
      const current = Array.isArray(stored[PAGE_ORIGINS_KEY])
        ? (stored[PAGE_ORIGINS_KEY] as string[])
        : [];
      await chrome.storage.local.set({
        [PAGE_ORIGINS_KEY]: [...new Set([...current, originPattern])],
      });
      setPendingPageOrigin(null);
      setError(null);
      setAttachment(await sendRequest<PageAttachment>({ type: "PAGE_ATTACH" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to grant access to this site.");
    }
  };

  const ensureThread = async (): Promise<string> => {
    if (threadId && threadReadyRef.current) return threadId;
    if (threadId) {
      try {
        const resumed = await sendRequest<{ threadId: string }>({ type: "CHAT_RESUME", threadId });
        threadReadyRef.current = true;
        return resumed.threadId;
      } catch {
        // The stored thread may have been cleared by Codex; start a replacement below.
      }
    }
    const created = await sendRequest<{ threadId: string }>({ type: "CHAT_START" });
    setThreadId(created.threadId);
    threadReadyRef.current = true;
    return created.threadId;
  };

  const sendChatMessage = async (payload: RetryPayload, appendUser: boolean) => {
    if (streaming) return;
    setIsSending(true);
    setError(null);
    setRetryPayload(null);
    inFlightPayloadRef.current = payload;
    turnExecutedToolRef.current = false;
    const messageId = crypto.randomUUID();
    setMessages((current) => {
      const withoutFailedAssistant = appendUser
        ? current
        : current.filter((item) => !(item.role === "assistant" && item.failed));
      return [
        ...withoutFailedAssistant,
        ...(appendUser ? [{ id: messageId, role: "user" as const, text: payload.displayText }] : []),
        { id: `${messageId}-assistant`, role: "assistant" as const, text: "", streaming: true },
      ];
    });
    try {
      const activeThreadId = await ensureThread();
      const result = await sendRequest<{ turnId: string }>({
        type: "CHAT_SEND",
        threadId: activeThreadId,
        text: payload.outboundText,
        clientMessageId: messageId,
      });
      setActiveTurnId(result.turnId);
      setIsSending(false);
    } catch (cause) {
      setIsSending(false);
      setMessages((current) =>
        current.map((item) =>
          item.id === `${messageId}-assistant` ? { ...item, streaming: false, failed: true } : item,
        ),
      );
      setRetryPayload(payload);
      setError(cause instanceof Error ? cause.message : "Unable to send this message.");
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || streaming) return;
    const payload = { displayText: text, outboundText: formatPageContext(text, attachment) };
    setDraft("");
    setAttachment(null);
    await sendChatMessage(payload, true);
  };

  const retryLastMessage = async () => {
    if (!retryPayload || streaming) return;
    await sendChatMessage(retryPayload, false);
  };

  const stop = async () => {
    if (!threadId || !activeTurnId) return;
    await sendRequest({ type: "CHAT_INTERRUPT", threadId, turnId: activeTurnId }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Unable to stop the response.");
    });
    setActiveTurnId(null);
    setMessages((current) => current.map((item) => ({ ...item, streaming: false })));
  };

  const newChat = () => {
    if (streaming && !confirm("Stop the active response and start a new chat?")) return;
    if (!streaming && messages.length > 0 && !confirm("Start a new chat and clear this local transcript?")) return;
    if (streaming) void stop();
    setThreadId(null);
    threadReadyRef.current = false;
    setMessages([]);
    setToolStatuses([]);
    setRetryPayload(null);
    setAttachment(null);
    setMenuOpen(false);
  };

  const clearLocalData = async () => {
    if (!confirm("Clear the local transcript and preferences on this browser?")) return;
    const stored = await chrome.storage.local.get(PAGE_ORIGINS_KEY);
    const origins = Array.isArray(stored[PAGE_ORIGINS_KEY])
      ? (stored[PAGE_ORIGINS_KEY] as string[])
      : [];
    if (origins.length > 0) await chrome.permissions.remove({ origins }).catch(() => false);
    await chrome.storage.local.remove(STORAGE_KEY);
    await chrome.storage.local.remove(PAGE_ORIGINS_KEY);
    setThreadId(null);
    setMessages([]);
    setTheme("system");
    setMenuOpen(false);
    setPendingPageOrigin(null);
  };

  const decideTool = async (approved: boolean) => {
    if (!toolApproval) return;
    const callId = toolApproval.callId;
    setToolApproval(null);
    await sendRequest({ type: "TOOL_DECISION", callId, approved }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Unable to answer the browser-action request.");
    });
  };

  const canSend = draft.trim().length > 0 && !streaming && authState === "ready";
  const emptyTitle = useMemo(
    () => (account?.email ? `Ready for ${account.email}` : "Ready when you are"),
    [account],
  );

  if (authState !== "ready") {
    return (
      <main className="welcome-shell">
        <div className="brand-mark" aria-hidden="true">C</div>
        <p className="eyebrow">Codex Sidebar</p>
        <h1>Think with the page beside you.</h1>
        <p className="welcome-copy">
          Sign in with ChatGPT to use your Codex subscription. Credentials stay in the local Codex companion.
        </p>

        {authState === "authenticating" && login ? (
          <section className="login-card" aria-live="polite">
            <span className="status-dot" />
            <div>
              <p className="login-label">Finish signing in with ChatGPT</p>
              <p>Complete the browser flow we opened, then return to this sidebar.</p>
              <button className="text-button" onClick={() => void sendRequest({ type: "OPEN_EXTERNAL", url: login.authUrl })}>
                Reopen sign-in page
              </button>
            </div>
            <button className="text-button login-cancel" onClick={() => void cancelLogin()}>Cancel</button>
          </section>
        ) : (
          <button className="primary-button welcome-action" onClick={() => void signIn()} disabled={authState === "checking"}>
            {authState === "checking" ? "Connecting…" : "Sign in with ChatGPT"}
          </button>
        )}

        {error && <div className="error-banner" role="alert">{error}</div>}
        {(authState === "offline" || authState === "error") && (
          <button className="secondary-button" onClick={() => void refreshAccount()}>Retry connection</button>
        )}
        <p className="privacy-note">No page content is shared until you choose Attach page.</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-row">
          <div className="brand-mark brand-mark-small" aria-hidden="true">C</div>
          <div>
            <strong>Codex</strong>
            <span className="account-line">{compactPlan(account?.planType ?? null)} plan</span>
          </div>
        </div>
        <div className="header-actions">
          <button className="icon-button" aria-label="Start a new chat" title="New chat" onClick={newChat}>＋</button>
          <button className="icon-button" aria-label="Open settings" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>•••</button>
        </div>
        {menuOpen && (
          <section className="menu-card" aria-label="Settings">
            <label>
              Theme
              <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>
            <button onClick={() => void clearLocalData()}>Clear local data</button>
            <button onClick={() => void signOut()}>Sign out</button>
          </section>
        )}
      </header>

      <div className="transcript" ref={transcriptRef} aria-live="polite">
        {messages.length === 0 ? (
          <section className="empty-state">
            <div className="orb" aria-hidden="true"><span /></div>
            <h1>{emptyTitle}</h1>
            <p>Ask about what you’re reading, attach the current page, or manage your open tabs.</p>
            <div className="prompt-grid">
              <button onClick={() => setDraft("Summarize the page I attach in five bullets.")}>Summarize a page</button>
              <button onClick={() => setDraft("List my open tabs and group them by topic.")}>Organize my tabs</button>
            </div>
          </section>
        ) : (
          messages.map((message) => (
            <article key={message.id} className={`message message-${message.role} ${message.failed ? "message-failed" : ""}`}>
              <span className="message-role">{message.role === "user" ? "You" : "Codex"}</span>
              {message.role === "assistant" ? (
                message.text ? (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      a: ({ children, ...props }) => (
                        <a {...props} target="_blank" rel="noreferrer noopener">{children}</a>
                      ),
                    }}
                  >
                    {message.text}
                  </ReactMarkdown>
                ) : (
                  <span className="thinking"><i /><i /><i /><span className="sr-only">Codex is thinking</span></span>
                )
              ) : (
                <p>{message.text}</p>
              )}
            </article>
          ))
        )}

        {toolStatuses.map((tool) => (
          <div key={tool.callId} className="tool-status">
            <span>Browser · {tool.tool}</span>
            <strong>{tool.status}</strong>
            {tool.error && <small>{tool.error}</small>}
          </div>
        ))}

        {toolApproval && (
          <section className="approval-card" role="alertdialog" aria-labelledby="approval-title">
            <p className="eyebrow">Confirmation required</p>
            <h2 id="approval-title">Close this tab?</h2>
            <p>{toolApproval.target.title}</p>
            <small>{toolApproval.target.url}</small>
            <div className="approval-actions">
              <button className="secondary-button" onClick={() => void decideTool(false)}>Keep tab</button>
              <button className="danger-button" onClick={() => void decideTool(true)}>Close tab</button>
            </div>
          </section>
        )}
      </div>

      <footer className="composer-wrap">
        {error && (
          <div className="error-banner compact" role="alert">
            <span>{error}</span>
            <span className="error-actions">
              {retryPayload && <button onClick={() => void retryLastMessage()}>Retry</button>}
              {pendingPageOrigin && <button onClick={() => void grantPageAccess()}>Allow access</button>}
              <button aria-label="Dismiss error" onClick={() => setError(null)}>×</button>
            </span>
          </div>
        )}
        {attachment && (
          <div className="attachment-card">
            <div>
              <span className="attachment-origin">{attachment.origin}</span>
              <strong>{attachment.title || "Untitled page"}</strong>
              <small>
                {attachment.selectedText ? "Selection + " : ""}
                {attachment.readableText.length.toLocaleString()} characters
                {attachment.truncated ? " · truncated" : ""}
              </small>
            </div>
            <button aria-label="Remove page attachment" onClick={() => setAttachment(null)}>×</button>
          </div>
        )}
        <form className="composer" onSubmit={(event) => void submit(event)}>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSend) event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Ask Codex…"
            aria-label="Message Codex"
            rows={1}
          />
          <div className="composer-toolbar">
            <button type="button" className="attach-button" onClick={() => void attachPage()} aria-label="Attach the current page">
              ⊕ <span>Attach page</span>
            </button>
            {streaming ? (
              <button type="button" className="stop-button" onClick={() => void stop()} aria-label="Stop response">■</button>
            ) : (
              <button type="submit" className="send-button" disabled={!canSend} aria-label="Send message">↑</button>
            )}
          </div>
        </form>
        <p className="composer-note">Page content is shared only when attached. Codex can make mistakes.</p>
      </footer>
    </main>
  );
}
