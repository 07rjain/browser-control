import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { PageAttachment, SidebarEvent, UiResponse } from "../shared/protocol";
import {
  BROWSER_TASK_ACTION_LIMIT_KEY,
  DEFAULT_BROWSER_TASK_ACTION_LIMIT,
  MAX_BROWSER_TASK_ACTION_LIMIT,
  MIN_BROWSER_TASK_ACTION_LIMIT,
  normalizeBrowserTaskActionLimit,
} from "../shared/page-tools";
import { groupToolStatuses, summarizeToolStatuses, type ToolStatus } from "./activity";
import { settleCanceledMessages, type ChatMessage } from "./chat-state";

type AuthState = "checking" | "signed-out" | "authenticating" | "ready" | "offline" | "error";
type Theme = "system" | "light" | "dark";

interface Account {
  type: "chatgpt";
  email: string | null;
  planType: string | null;
}

interface LoginDetails {
  loginId: string;
  authUrl: string;
}

interface ToolApproval {
  callId: string;
  namespace: "tabs" | "page";
  tool: string;
  title: string;
  description: string;
  target: {
    label: string;
    url?: string;
    form?: { action: string; method: string; fields: Array<{ name: string; value: string; sensitive: boolean }> } | null;
  };
  approveLabel: string;
  rejectLabel: string;
  danger?: boolean;
}

interface ToolPermission {
  callId: string;
  origin: string;
  originPattern: string;
}

interface PersistedState {
  threadId: string | null;
  messages: ChatMessage[];
  theme: Theme;
  selectedModel: string;
  completionSoundEnabled?: boolean;
}

interface ModelOption {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
}

interface RetryPayload {
  displayText: string;
  outboundText: string;
}

const INITIAL_STATE: PersistedState = { threadId: null, messages: [], theme: "system", selectedModel: "", completionSoundEnabled: false };
const STORAGE_KEY = "codexSidebarState";
const PAGE_ORIGINS_KEY = "codexSidebarGrantedPageOrigins";
const TASK_ORIGINS_KEY = "codexSidebarTaskControlOrigins";

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

let completionAudioContext: AudioContext | null = null;

async function playCompletionSound(): Promise<void> {
  try {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = completionAudioContext?.state === "closed"
      ? new AudioContext()
      : completionAudioContext ?? new AudioContext();
    completionAudioContext = context;
    if (context.state === "suspended") await context.resume();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(523.25, now);
    oscillator.frequency.setValueAtTime(659.25, now + 0.11);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.28);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.3);
  } catch {
    // Audio can be unavailable under browser autoplay or accessibility policies.
  }
}

function ToolActivity({ statuses, complete }: { statuses: ToolStatus[]; complete: boolean }) {
  const [open, setOpen] = useState(!complete);
  const summary = summarizeToolStatuses(statuses);

  return (
    <details className={`tool-activity ${summary.failed ? "tool-activity-failed" : ""}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="activity-icon" aria-hidden="true">{complete ? (summary.failed ? "!" : "✓") : "⋯"}</span>
        <span>{summary.actionCount} browser {summary.actionCount === 1 ? "action" : "actions"}</span>
        <strong>{complete ? (summary.failed ? "Needs attention" : "Completed") : "Working"}</strong>
      </summary>
      <ol className="tool-steps">
        {statuses.map((status, index) => (
          <li key={`${status.callId}-${status.status}-${status.timestamp ?? index}`}>
            <span>Browser · {status.namespace ? `${status.namespace}.` : ""}{status.tool}</span>
            <strong>{status.status}</strong>
            {status.origin && <small>{status.origin}</small>}
            {status.error && <small className="tool-step-error">{status.error}</small>}
          </li>
        ))}
      </ol>
    </details>
  );
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
  const [selectedModel, setSelectedModel] = useState("");
  const [browserTaskActionLimit, setBrowserTaskActionLimit] = useState(DEFAULT_BROWSER_TASK_ACTION_LIMIT);
  const [browserTaskActionLimitDraft, setBrowserTaskActionLimitDraft] = useState(String(DEFAULT_BROWSER_TASK_ACTION_LIMIT));
  const [completionSoundEnabled, setCompletionSoundEnabled] = useState(false);
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [toolApproval, setToolApproval] = useState<ToolApproval | null>(null);
  const [toolPermission, setToolPermission] = useState<ToolPermission | null>(null);
  const [toolStatuses, setToolStatuses] = useState<ToolStatus[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [retryPayload, setRetryPayload] = useState<RetryPayload | null>(null);
  const [pendingPageOrigin, setPendingPageOrigin] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const threadReadyRef = useRef(false);
  const inFlightPayloadRef = useRef<RetryPayload | null>(null);
  const turnExecutedToolRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const completionSoundEnabledRef = useRef(false);

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
      .get([STORAGE_KEY, BROWSER_TASK_ACTION_LIMIT_KEY])
      .then((stored) => {
        const state = (stored[STORAGE_KEY] as PersistedState | undefined) ?? INITIAL_STATE;
        setThreadId(state.threadId);
        setMessages(Array.isArray(state.messages) ? state.messages.map((message) => ({ ...message, streaming: false })) : []);
        setTheme(state.theme ?? "system");
        setSelectedModel(state.selectedModel ?? "");
        setCompletionSoundEnabled(Boolean(state.completionSoundEnabled));
        completionSoundEnabledRef.current = Boolean(state.completionSoundEnabled);
        const storedActionLimit = normalizeBrowserTaskActionLimit(stored[BROWSER_TASK_ACTION_LIMIT_KEY]);
        setBrowserTaskActionLimit(storedActionLimit);
        setBrowserTaskActionLimitDraft(String(storedActionLimit));
        setHydrated(true);
      })
      .finally(() => void refreshAccount());
  }, [refreshAccount]);

  useEffect(() => {
    void sendRequest<{
      activities: ToolStatus[];
      prompts: Array<{ type: "approval" | "permission"; data: ToolApproval | ToolPermission }>;
      completionNotice?: { message?: string } | null;
    }>({ type: "BROWSER_STATE_READ" }).then((state) => {
      setToolStatuses(Array.isArray(state.activities) ? state.activities.slice(-100) : []);
      const approval = state.prompts.find((prompt) => prompt.type === "approval");
      const permission = state.prompts.find((prompt) => prompt.type === "permission");
      if (approval) setToolApproval(approval.data as ToolApproval);
      if (permission) setToolPermission(permission.data as ToolPermission);
      if (state.completionNotice?.message) setCompletionNotice(state.completionNotice.message);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (authState !== "ready") return;
    void sendRequest<{ models: ModelOption[] }>({ type: "MODELS_READ" })
      .then((result) => setModels(result.models))
      .catch(() => setModels([]));
  }, [authState]);

  useEffect(() => {
    if (!hydrated) return;
    const retainedMessages = messages.slice(-100).map((message) => ({
      ...message,
      text: message.text.slice(0, 100_000),
    }));
    void chrome.storage.local.set({
      [STORAGE_KEY]: { threadId, messages: retainedMessages, theme, selectedModel, completionSoundEnabled } satisfies PersistedState,
    });
  }, [completionSoundEnabled, hydrated, messages, selectedModel, theme, threadId]);

  useEffect(() => {
    completionSoundEnabledRef.current = completionSoundEnabled;
  }, [completionSoundEnabled]);

  useEffect(() => {
    if (!hydrated) return;
    void chrome.storage.local.set({ [BROWSER_TASK_ACTION_LIMIT_KEY]: browserTaskActionLimit });
  }, [browserTaskActionLimit, hydrated]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, toolApproval, toolPermission]);

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
          if (stopRequestedRef.current) break;
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
          if (stopRequestedRef.current) break;
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
        case "chat.turnCompleted": {
          const wasStopped = stopRequestedRef.current;
          const completedBrowserTask = turnExecutedToolRef.current;
          stopRequestedRef.current = false;
          turnExecutedToolRef.current = false;
          setActiveTurnId(null);
          setIsSending(false);
          setRetryPayload(null);
          inFlightPayloadRef.current = null;
          setMessages(settleCanceledMessages);
          if (completedBrowserTask && !wasStopped) {
            setCompletionNotice("Task complete — you can check the result when you’re ready.");
            if (completionSoundEnabledRef.current) void playCompletionSound();
          }
          break;
        }
        case "chat.error": {
          const wasStopped = stopRequestedRef.current;
          stopRequestedRef.current = false;
          setActiveTurnId(null);
          setIsSending(false);
          if (wasStopped) {
            setRetryPayload(null);
            inFlightPayloadRef.current = null;
            setMessages(settleCanceledMessages);
            break;
          }
          setRetryPayload(turnExecutedToolRef.current ? null : inFlightPayloadRef.current);
          setError(
            turnExecutedToolRef.current
              ? "Browser Control stopped after a browser action. Review the result before sending another request."
              : "Browser Control could not complete this response. You can retry your message.",
          );
          setMessages((current) =>
            current.map((item) => (item.streaming ? { ...item, streaming: false, failed: true } : item)),
          );
          break;
        }
        case "tool.approval":
          setToolApproval(message.data as ToolApproval);
          break;
        case "tool.permission":
          setToolPermission(message.data as ToolPermission);
          break;
        case "tool.status": {
          const status = message.data as ToolStatus;
          if (status.status === "succeeded") turnExecutedToolRef.current = true;
          setToolStatuses((current) => [...current, status].slice(-100));
          if (["succeeded", "failed", "rejected", "canceled", "stale"].includes(status.status)) {
            setToolApproval((current) => (current?.callId === status.callId ? null : current));
            setToolPermission((current) => (current?.callId === status.callId ? null : current));
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
    setCompletionNotice(null);
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
        const resumed = await sendRequest<{ threadId: string }>({ type: "CHAT_RESUME", threadId, model: selectedModel || undefined });
        threadReadyRef.current = true;
        return resumed.threadId;
      } catch {
        // The stored thread may have been cleared by Codex; start a replacement below.
      }
    }
    const created = await sendRequest<{ threadId: string }>({ type: "CHAT_START", model: selectedModel || undefined });
    setThreadId(created.threadId);
    threadReadyRef.current = true;
    return created.threadId;
  };

  const sendChatMessage = async (payload: RetryPayload, appendUser: boolean) => {
    if (streaming) return;
    setIsSending(true);
    setError(null);
    setCompletionNotice(null);
    void sendRequest({ type: "COMPLETION_NOTICE_DISMISS" }).catch(() => undefined);
    setRetryPayload(null);
    inFlightPayloadRef.current = payload;
    turnExecutedToolRef.current = false;
    stopRequestedRef.current = false;
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
        model: selectedModel || undefined,
      });
      if (stopRequestedRef.current) {
        await sendRequest({ type: "BROWSER_TASK_CANCEL", threadId: activeThreadId, turnId: result.turnId }).catch(() => undefined);
        await sendRequest({ type: "CHAT_INTERRUPT", threadId: activeThreadId, turnId: result.turnId }).catch(() => undefined);
        setIsSending(false);
        setMessages(settleCanceledMessages);
        return;
      }
      setActiveTurnId(result.turnId);
      setIsSending(false);
    } catch (cause) {
      setIsSending(false);
      if (stopRequestedRef.current) {
        setRetryPayload(null);
        inFlightPayloadRef.current = null;
        setMessages(settleCanceledMessages);
        return;
      }
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
    stopRequestedRef.current = true;
    setIsSending(false);
    setError(null);
    setMessages(settleCanceledMessages);
    setToolApproval(null);
    setToolPermission(null);
    if (!threadId) return;
    await sendRequest({ type: "BROWSER_TASK_CANCEL", threadId, turnId: activeTurnId ?? undefined }).catch(() => undefined);
    if (activeTurnId) {
      await sendRequest({ type: "CHAT_INTERRUPT", threadId, turnId: activeTurnId }).catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Unable to stop the response.");
      });
    }
    setActiveTurnId(null);
  };

  const newChat = () => {
    if (streaming) void stop();
    setCompletionNotice(null);
    void sendRequest({ type: "COMPLETION_NOTICE_DISMISS" }).catch(() => undefined);
    setThreadId(null);
    threadReadyRef.current = false;
    setMessages([]);
    setToolStatuses([]);
    setToolApproval(null);
    setToolPermission(null);
    setRetryPayload(null);
    setAttachment(null);
    setMenuOpen(false);
  };

  const clearLocalData = async () => {
    if (!confirm("Clear the local transcript and preferences on this browser?")) return;
    if (threadId) await sendRequest({ type: "BROWSER_TASK_CANCEL", threadId }).catch(() => undefined);
    const stored = await chrome.storage.local.get([PAGE_ORIGINS_KEY, TASK_ORIGINS_KEY]);
    const attachmentOrigins = Array.isArray(stored[PAGE_ORIGINS_KEY])
      ? (stored[PAGE_ORIGINS_KEY] as string[])
      : [];
    const taskOrigins = Array.isArray(stored[TASK_ORIGINS_KEY])
      ? (stored[TASK_ORIGINS_KEY] as string[])
      : [];
    const origins = [...new Set([...attachmentOrigins, ...taskOrigins])];
    if (origins.length > 0) await chrome.permissions.remove({ origins }).catch(() => false);
    await chrome.storage.local.remove(STORAGE_KEY);
    await chrome.storage.local.remove(BROWSER_TASK_ACTION_LIMIT_KEY);
    await chrome.storage.local.remove(PAGE_ORIGINS_KEY);
    await chrome.storage.local.remove(TASK_ORIGINS_KEY);
    await chrome.storage.session.clear();
    setThreadId(null);
    setMessages([]);
    setTheme("system");
    setSelectedModel("");
    setBrowserTaskActionLimit(DEFAULT_BROWSER_TASK_ACTION_LIMIT);
    setBrowserTaskActionLimitDraft(String(DEFAULT_BROWSER_TASK_ACTION_LIMIT));
    setCompletionSoundEnabled(false);
    completionSoundEnabledRef.current = false;
    setCompletionNotice(null);
    setMenuOpen(false);
    setPendingPageOrigin(null);
    setToolStatuses([]);
    setToolApproval(null);
    setToolPermission(null);
  };

  const decideTool = async (approved: boolean) => {
    if (!toolApproval) return;
    const callId = toolApproval.callId;
    setToolApproval(null);
    await sendRequest({ type: "TOOL_DECISION", callId, approved }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Unable to answer the browser-action request.");
    });
  };

  const decidePagePermission = async (approved: boolean) => {
    if (!toolPermission) return;
    const pending = toolPermission;
    setToolPermission(null);
    try {
      const alreadyGranted = approved
        ? await chrome.permissions.contains({ origins: [pending.originPattern] })
        : false;
      const granted = approved
        ? alreadyGranted || await chrome.permissions.request({ origins: [pending.originPattern] })
        : false;
      await sendRequest({
        type: "PAGE_CONTROL_PERMISSION_RESULT",
        callId: pending.callId,
        originPattern: pending.originPattern,
        granted,
      });
      if (approved && !granted) setError("Site access was not granted. The browser action was canceled.");
    } catch (cause) {
      await sendRequest({
        type: "PAGE_CONTROL_PERMISSION_RESULT",
        callId: pending.callId,
        originPattern: pending.originPattern,
        granted: false,
      }).catch(() => undefined);
      setError(cause instanceof Error ? cause.message : "Unable to grant browser-control access.");
    }
  };

  const canSend = draft.trim().length > 0 && !streaming && authState === "ready";
  const emptyTitle = useMemo(
    () => (account?.email ? `Ready for ${account.email}` : "Ready when you are"),
    [account],
  );
  const activitiesByTurn = useMemo(() => groupToolStatuses(toolStatuses), [toolStatuses]);

  if (authState !== "ready") {
    return (
      <main className="welcome-shell">
        <div className="brand-mark" aria-hidden="true">B</div>
        <p className="eyebrow">Browser Control</p>
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
          <div className="brand-mark brand-mark-small" aria-hidden="true">B</div>
          <div>
            <strong>Browser Control</strong>
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
            <label>
              Model
              <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
                <option value="">Codex default</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}{model.isDefault ? " · Default" : ""}</option>
                ))}
              </select>
            </label>
            <p className="menu-hint">Model changes apply to your next message.</p>
            <label>
              Browser actions per request
              <input
                type="number"
                min={MIN_BROWSER_TASK_ACTION_LIMIT}
                max={MAX_BROWSER_TASK_ACTION_LIMIT}
                step={5}
                value={browserTaskActionLimitDraft}
                onChange={(event) => setBrowserTaskActionLimitDraft(event.target.value)}
                onBlur={() => {
                  const nextLimit = normalizeBrowserTaskActionLimit(browserTaskActionLimitDraft);
                  setBrowserTaskActionLimit(nextLimit);
                  setBrowserTaskActionLimitDraft(String(nextLimit));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </label>
            <p className="menu-hint">
              {MIN_BROWSER_TASK_ACTION_LIMIT}–{MAX_BROWSER_TASK_ACTION_LIMIT}; applies to the next request. Consequential actions still require confirmation.
            </p>
            <label className="toggle-row">
              <span>Task completion sound<small>Play a quiet tone after browser work finishes.</small></span>
              <input
                type="checkbox"
                checked={completionSoundEnabled}
                onChange={(event) => {
                  const enabled = event.target.checked;
                  setCompletionSoundEnabled(enabled);
                  if (enabled) void playCompletionSound();
                }}
              />
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
            <p>Ask about what you’re reading, attach the page, or navigate the current site with supervised browser actions.</p>
            <div className="prompt-grid">
              <button onClick={() => setDraft("Summarize the page I attach in five bullets.")}>Summarize a page</button>
              <button onClick={() => setDraft("List my open tabs and group them by topic.")}>Organize my tabs</button>
            </div>
          </section>
        ) : (
          messages.map((message) => {
            const activity = message.role === "assistant"
              ? activitiesByTurn.get(message.id) ?? (message.streaming && activeTurnId ? activitiesByTurn.get(activeTurnId) : undefined)
              : undefined;
            return (
              <div key={message.id} className="turn-block">
                {(message.role === "user" || message.text || message.streaming) && <article className={`message message-${message.role} ${message.failed ? "message-failed" : ""}`}>
                  <span className="message-role">{message.role === "user" ? "You" : "Browser Control"}</span>
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
                      <span className="thinking"><i /><i /><i /><span className="sr-only">Browser Control is thinking</span></span>
                    )
                  ) : (
                    <p>{message.text}</p>
                  )}
                </article>}
                {activity && (
                  <ToolActivity
                    key={`${message.id}-${String(!message.streaming && activeTurnId !== message.id)}`}
                    statuses={activity}
                    complete={!message.streaming && activeTurnId !== message.id}
                  />
                )}
              </div>
            );
          })
        )}

        {toolPermission && (
          <section className="approval-card permission-card" role="alertdialog" aria-labelledby="permission-title">
            <p className="eyebrow">Site access required</p>
            <h2 id="permission-title">Allow browser actions here?</h2>
            <p>{toolPermission.origin}</p>
            <small>Access is limited to this exact site and remembered until you clear it in settings or Chrome.</small>
            <div className="approval-actions">
              <button className="secondary-button" onClick={() => void decidePagePermission(false)}>Cancel</button>
              <button className="primary-button" onClick={() => void decidePagePermission(true)}>Allow this site</button>
            </div>
          </section>
        )}

        {toolApproval && (
          <section className="approval-card" role="alertdialog" aria-labelledby="approval-title">
            <p className="eyebrow">Confirmation required</p>
            <h2 id="approval-title">{toolApproval.title}</h2>
            <p>{toolApproval.target.label}</p>
            <small>{toolApproval.description}</small>
            {toolApproval.target.url && <small>{toolApproval.target.url}</small>}
            {toolApproval.target.form && toolApproval.target.form.fields.length > 0 && (
              <dl className="form-preview">
                {toolApproval.target.form.fields.map((field) => (
                  <div key={field.name}>
                    <dt>{field.name}</dt>
                    <dd>{field.value || "Empty"}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="approval-actions">
              <button className="secondary-button" onClick={() => void decideTool(false)}>{toolApproval.rejectLabel}</button>
              <button className={toolApproval.danger ? "danger-button" : "primary-button"} onClick={() => void decideTool(true)}>{toolApproval.approveLabel}</button>
            </div>
          </section>
        )}
      </div>

      <footer className="composer-wrap">
        {completionNotice && (
          <div className="completion-banner" role="status">
            <span>{completionNotice}</span>
            <button aria-label="Dismiss completion message" onClick={() => {
              setCompletionNotice(null);
              void sendRequest({ type: "COMPLETION_NOTICE_DISMISS" }).catch(() => undefined);
            }}>×</button>
          </div>
        )}
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
            placeholder="Ask Browser Control…"
            aria-label="Message Browser Control"
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
        <p className="composer-note">Page content is shared only when attached. AI can make mistakes.</p>
      </footer>
    </main>
  );
}
