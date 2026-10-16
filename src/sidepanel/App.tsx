import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { messageTextSize, SIDEBAR_STATE_STORAGE_KEY, type ConversationSnapshot } from "../shared/conversation-state";
import { isSafeHttpUrl, sanitizeMarkdownUrl, type PageAttachment, type SidebarEvent, type SidebarSkill, type UiResponse } from "../shared/protocol";
import {
  BROWSER_PERMISSION_MODE_KEY,
  BROWSER_TASK_ACTION_LIMIT_KEY,
  DEFAULT_BROWSER_PERMISSION_MODE,
  DEFAULT_BROWSER_TASK_ACTION_LIMIT,
  FULL_ACCESS_HOST_GRANT_KEY,
  FULL_ACCESS_HOST_PATTERNS,
  TASK_ORIGINS_KEY,
  MAX_BROWSER_TASK_ACTION_LIMIT,
  MIN_BROWSER_TASK_ACTION_LIMIT,
  normalizeBrowserPermissionMode,
  normalizeBrowserTaskActionLimit,
  type BrowserPermissionMode,
} from "../shared/page-tools";
import { AUTO_REVIEW_SETTINGS_KEY, DEFAULT_AUTO_REVIEW, REVIEW_MODEL, DEFAULT_REVIEW_SYSTEM_PROMPT, REQUIRED_REVIEW_INSTRUCTIONS, MAX_REVIEW_SYSTEM_PROMPT, autoReviewSettingsSchema, readAutoReviewSettings, reviewCapabilitiesSchema, type AutoReviewSettings } from "../shared/auto-review";
import { IDLE_RECORDING_VIEW, recordingStepSummary, type RecordingView } from "../shared/skill-recording";
import { COMPANION_INSTALL_COMMAND, isLegacyThreadError, isMissingNativeHost } from "../shared/companion-setup";
import { activityStepLabel, groupToolStatuses, hasBrowserActivityForTurn, latestToolStatuses, summarizeToolStatuses, visibleActivityFormFields, type ToolStatus } from "./activity";
import { settleCanceledMessages, type ChatMessage } from "./chat-state";
import { MAX_ATTACHED_FILES, readAttachedFile, type AttachedFile } from "./attached-files";
import { FILE_LIMITS, type AttachmentSummary, type AttachmentOperation } from "../shared/attachments";
import { checkCanceled, preparePdf, releasePreparedFile } from "./attachments/prepare";
import { uploadPreparedFiles, type AttachmentTransport } from "./attachments/transfer";
import { FileCards, SentFiles } from "./attachments/FileCards";
import { COMPLETION_NOTICE_DURATION_MS, freshCompletionNotice, type CompletionNotice } from "../shared/completion-notice";
import { greetingFor, selectedModelLabel, setupSteps, STARTER_TASKS, type AuthState, type StarterTask } from "./welcome";
import {
  createConversationRecord,
  readConversationHistory,
  upsertConversation,
  type ConversationRecord,
} from "./conversation-history";

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
  currentConversationId?: string;
  conversationHistory?: ConversationRecord[];
}

interface ModelOption {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  inputModalities?: string[];
}

interface RetryPayload {
  displayText: string;
  userText: string;
  pageContext?: PageAttachment;
  files: AttachedFile[];
  attachments?: AttachmentSummary[];
  owner: string;
  clientMessageId: string;
  userMessageId: string;
  threadId?: string;
  accepted?: boolean;
  model?: string;
}

const INITIAL_STATE: PersistedState = { threadId: null, messages: [], theme: "system", selectedModel: "", completionSoundEnabled: false };
const STORAGE_KEY = SIDEBAR_STATE_STORAGE_KEY;
const CONVERSATION_SAVE_DELAY_MS = 400;
const PAGE_ORIGINS_KEY = "codexSidebarGrantedPageOrigins";
const VISIBLE_MODELS_KEY = "codexSidebarVisibleModels";
const COMPANION_SUPPORT_URL = "https://07rjain.github.io/browser-control-support/support.html";

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

const attachmentTransport: AttachmentTransport = <T,>(request: AttachmentOperation) => sendRequest<T>({ type: "ATTACHMENTS_REQUEST", request });

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
        {statuses.map((status) => (
          <li key={status.callId}>
            <span>{activityStepLabel(status)}</span>
            <strong>{status.status}</strong>
            {status.origin && <small>{status.origin}</small>}
            {status.review && <small className="tool-step-review">{status.review.source === "user" ? "You" : status.review.status === "ask_user" ? "Your review needed" : status.review.model} · {status.review.reason}</small>}
            {status.confirmationBypassed && (
              <small className="tool-step-bypass">
                Full access · approval skipped{status.target?.label ? ` for ${status.target.label}` : ""}
              </small>
            )}
            {status.confirmationBypassed && (status.target?.form?.action ?? status.target?.url) && (
              <small>{status.target?.form?.action ?? status.target?.url}</small>
            )}
            {status.confirmationBypassed && visibleActivityFormFields(status).map((field) => (
              <small key={`${status.callId}-${status.status}-${field.name}`}>
                {field.name}: {field.value || "Empty"}
              </small>
            ))}
            {status.error && <small className="tool-step-error">{status.error}</small>}
          </li>
        ))}
      </ol>
    </details>
  );
}

function RecordingReview({
  recording,
  onUpdate,
  onCancel,
  onSave,
}: {
  recording: RecordingView;
  onUpdate: (patch: {
    name?: string;
    description?: string;
    notes?: string;
    deleteStepId?: string;
    keepExample?: { stepId: string; keep: boolean };
  }) => void;
  onCancel: () => void;
  onSave: (fields: { name: string; description: string; notes: string }) => void;
}) {
  const [name, setName] = useState(recording.name);
  const [description, setDescription] = useState(recording.description);
  const [notes, setNotes] = useState(recording.notes);

  return (
    <>
      <label>
        Name
        <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} onBlur={() => onUpdate({ name })} />
      </label>
      <label>
        When to use it
        <textarea value={description} maxLength={500} rows={3} onChange={(event) => setDescription(event.target.value)} onBlur={() => onUpdate({ description })} />
      </label>
      {recording.steps.every((step) => step.kind === "skipped") && (
        <p className="recording-error">No page actions were captured. Cancel and record again while the recording frame is visible on the page.</p>
      )}
      <ol className="recording-steps">
        {recording.steps.map((step) => (
          <li key={step.id} className="recording-step">
            <div>
              <span>{recordingStepSummary(step)}</span>
              {step.kind === "fill" && step.example ? (
                <label className="keep-example">
                  <input
                    type="checkbox"
                    checked={step.keepExample}
                    onChange={(event) => onUpdate({ keepExample: { stepId: step.id, keep: event.target.checked } })}
                  />
                  Keep example “{step.example}”
                </label>
              ) : null}
            </div>
            <button type="button" onClick={() => onUpdate({ deleteStepId: step.id })}>Delete</button>
          </li>
        ))}
      </ol>
      <label>
        Extra notes
        <textarea value={notes} maxLength={4000} rows={3} onChange={(event) => setNotes(event.target.value)} onBlur={() => onUpdate({ notes })} />
      </label>
      {recording.previewError && <p className="recording-error">{recording.previewError}</p>}
      {recording.preview && (
        <details>
          <summary>File to save</summary>
          <pre className="recording-preview">{recording.preview}</pre>
        </details>
      )}
      <div className="recording-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>Cancel</button>
        <button
          type="button"
          className="primary-button"
          disabled={name.trim().length === 0 || description.trim().length === 0 || recording.steps.every((step) => step.kind === "skipped")}
          onClick={() => onSave({ name, description, notes })}
        >
          Save skill
        </button>
      </div>
    </>
  );
}

function OrbMark({ size }: { size?: "large" }) {
  return (
    <div className={size === "large" ? "orb orb-large" : "orb"} aria-hidden="true">
      <span className="orb-wave orb-wave-outer" />
      <span className="orb-wave orb-wave-inner" />
      <span className="orb-core" />
    </div>
  );
}

function StarterIcon({ id }: { id: StarterTask["id"] }) {
  const paths: Record<StarterTask["id"], string> = {
    summarize: "M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 17h5",
    tabs: "M3 7h7l2 2h9v10H3zM3 7V5h6l2 2",
    find: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l5 5",
    checklist: "M4 6l2 2 3-3M4 13l2 2 3-3M12 7h8M12 14h8M12 20h8",
  };
  return (
    <svg className="starter-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d={paths[id]} />
    </svg>
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
  const [attachingPage, setAttachingPage] = useState(false);
  const pageAttachmentRequestRef = useRef({ generation: 0, pending: false });
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [fileProgress, setFileProgress] = useState<string | null>(null);
  const [preparingFiles, setPreparingFiles] = useState(false);
  const preparationRef = useRef<AbortController | null>(null);
  const sendAbortRef = useRef<AbortController | null>(null);
  const filesRef = useRef<AttachedFile[]>([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [activeTurnId, setActiveTurnId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [desktopOs, setDesktopOs] = useState("");
  const [theme, setTheme] = useState<Theme>("system");
  const [selectedModel, setSelectedModel] = useState("");
  const [visibleModelIds, setVisibleModelIds] = useState<string[] | null>(null);
  const modelPreferencesRef = useRef({ selectedModel, visibleModelIds });
  const [browserPermissionMode, setBrowserPermissionMode] = useState<BrowserPermissionMode>(DEFAULT_BROWSER_PERMISSION_MODE);
  const [autoReview, setAutoReview] = useState<AutoReviewSettings>({ ...DEFAULT_AUTO_REVIEW });
  const [reviewerPromptDraft, setReviewerPromptDraft] = useState(DEFAULT_REVIEW_SYSTEM_PROMPT);
  const [reviewerSettingsError, setReviewerSettingsError] = useState<string | null>(null);
  const [reviewerSettingsNotice, setReviewerSettingsNotice] = useState<string | null>(null);
  const [reviewerSettingsSaving, setReviewerSettingsSaving] = useState(false);
  const [reviewerAvailable, setReviewerAvailable] = useState(false);
  const permissionMode = autoReview.enabled && browserPermissionMode === "ask" ? "auto" : browserPermissionMode;
  const [fullSiteAccessGranted, setFullSiteAccessGranted] = useState(false);
  const [browserTaskActionLimit, setBrowserTaskActionLimit] = useState(DEFAULT_BROWSER_TASK_ACTION_LIMIT);
  const [browserTaskActionLimitDraft, setBrowserTaskActionLimitDraft] = useState(String(DEFAULT_BROWSER_TASK_ACTION_LIMIT));
  const [completionSoundEnabled, setCompletionSoundEnabled] = useState(false);
  const [completionNotice, setCompletionNotice] = useState<CompletionNotice | null>(null);
  const showCompletionNotice = useCallback((message: string) => {
    setCompletionNotice({ message, timestamp: Date.now() });
  }, []);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [toolApproval, setToolApproval] = useState<ToolApproval | null>(null);
  const [toolPermission, setToolPermission] = useState<ToolPermission | null>(null);
  const [toolStatuses, setToolStatuses] = useState<ToolStatus[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState<string>(() => crypto.randomUUID());
  const [conversationHistory, setConversationHistory] = useState<ConversationRecord[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [retryPayload, setRetryPayload] = useState<RetryPayload | null>(null);
  const [pendingPageOrigin, setPendingPageOrigin] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
  const [taughtSkills, setTaughtSkills] = useState<SidebarSkill[]>([]);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const modelPickerRef = useRef<HTMLDivElement>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [recording, setRecording] = useState<RecordingView>(IDLE_RECORDING_VIEW);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordWhen, setRecordWhen] = useState("");
  const [recordComposerOpen, setRecordComposerOpen] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const menuOpenRef = useRef(false);
  const threadReadyRef = useRef(false);
  const inFlightPayloadRef = useRef<RetryPayload | null>(null);
  const turnExecutedToolRef = useRef(false);
  const stopRequestedRef = useRef(false);
  const completionSoundEnabledRef = useRef(false);
  const conversationSaveEpoch = useRef(0);
  const conversationSnapshotRef = useRef<ConversationSnapshot | null>(null);
  const conversationSaveTimer = useRef<number | null>(null);
  const conversationSaveError = useRef<string | null>(null);
  const lastConversationSaveKey = useRef("");
  const conversationPersistSuspended = useRef(false);

  const streaming = activeTurnId !== null || isSending;
  const recordingActive = recording.status !== "idle";

  useEffect(() => {
    const retainedUrls = new Set(attachedFiles.flatMap((file) => file.pages.map((page) => page.previewUrl)));
    for (const file of filesRef.current) for (const page of file.pages) if (!retainedUrls.has(page.previewUrl)) URL.revokeObjectURL(page.previewUrl);
    filesRef.current = attachedFiles;
  }, [attachedFiles]);
  useEffect(() => () => {
    pageAttachmentRequestRef.current.generation += 1;
    pageAttachmentRequestRef.current.pending = false;
    preparationRef.current?.abort();
    sendAbortRef.current?.abort();
    for (const file of filesRef.current) releasePreparedFile(file);
  }, []);
  const activeBrowserTask = streaming && hasBrowserActivityForTurn(toolStatuses, activeTurnId);

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
    void chrome.runtime.getPlatformInfo().then((info) => setDesktopOs(info.os)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !modelPickerRef.current?.contains(event.target)) setModelMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [modelMenuOpen]);

  useEffect(() => {
    void chrome.storage.local
      .get([STORAGE_KEY, AUTO_REVIEW_SETTINGS_KEY, VISIBLE_MODELS_KEY, BROWSER_PERMISSION_MODE_KEY, BROWSER_TASK_ACTION_LIMIT_KEY, FULL_ACCESS_HOST_GRANT_KEY])
      .then(async (stored) => {
        const state = (stored[STORAGE_KEY] as PersistedState | undefined) ?? INITIAL_STATE;
        const restoredHistory = readConversationHistory(state.conversationHistory);
        const restoredConversationId = typeof state.currentConversationId === "string"
          ? state.currentConversationId
          : crypto.randomUUID();
        const stateMessages = Array.isArray(state.messages)
          ? state.messages.map((message) => ({ ...message, streaming: false }))
          : [];
        const historyRecord = restoredHistory.find((item) => item.id === restoredConversationId);
        const historyMessages = historyRecord?.messages.map((message) => ({ ...message, streaming: false })) ?? [];
        const useHistoryTranscript = messageTextSize(historyMessages) > messageTextSize(stateMessages);
        const restoredMessages = useHistoryTranscript ? historyMessages : stateMessages;
        const restoredThreadId = useHistoryTranscript ? historyRecord?.threadId ?? state.threadId : state.threadId;
        setThreadId(restoredThreadId);
        setMessages(restoredMessages);
        setCurrentConversationId(restoredConversationId);
        setConversationHistory(upsertConversation(
          restoredHistory,
          createConversationRecord(
            restoredConversationId,
            restoredThreadId,
            restoredMessages,
            useHistoryTranscript ? historyRecord?.toolStatuses ?? [] : [],
            historyRecord?.updatedAt ?? Date.now(),
          ),
        ));
        setTheme(state.theme ?? "system");
        const visibleModels = stored[VISIBLE_MODELS_KEY];
        let restoredVisibleModels: string[] | null = null;
        if (Array.isArray(visibleModels) && visibleModels.length > 0 && visibleModels.length <= 200 && visibleModels.every((id) => typeof id === "string" && id.length <= 200)) {
          restoredVisibleModels = [...new Set(visibleModels as string[])];
        }
        setVisibleModelIds(restoredVisibleModels);
        const restoredModel = state.selectedModel ?? "";
        setSelectedModel(restoredVisibleModels && !restoredVisibleModels.includes(restoredModel) ? restoredVisibleModels[0] : restoredModel);
        setCompletionSoundEnabled(Boolean(state.completionSoundEnabled));
        completionSoundEnabledRef.current = Boolean(state.completionSoundEnabled);
        setBrowserPermissionMode(normalizeBrowserPermissionMode(stored[BROWSER_PERMISSION_MODE_KEY]));
        const restoredReview = readAutoReviewSettings(stored[AUTO_REVIEW_SETTINGS_KEY]);
        setAutoReview(restoredReview);
        setReviewerPromptDraft(restoredReview.systemPrompt);
        const storedActionLimit = normalizeBrowserTaskActionLimit(stored[BROWSER_TASK_ACTION_LIMIT_KEY]);
        setBrowserTaskActionLimit(storedActionLimit);
        setBrowserTaskActionLimitDraft(String(storedActionLimit));
        const broadGrantPresent = stored[FULL_ACCESS_HOST_GRANT_KEY] === true &&
          await chrome.permissions.contains({ origins: [...FULL_ACCESS_HOST_PATTERNS] });
        setFullSiteAccessGranted(broadGrantPresent);
        setHydrated(true);
        const restoredRecording = await sendRequest<RecordingView>({ type: "RECORDING_READ" }).catch(() => IDLE_RECORDING_VIEW);
        setRecording(restoredRecording);
      })
      .finally(() => void refreshAccount());
  }, [refreshAccount]);

  useEffect(() => {
    void sendRequest<{
      activities: ToolStatus[];
      prompts: Array<{ type: "approval" | "permission"; data: ToolApproval | ToolPermission }>;
      completionNotice?: CompletionNotice | null;
    }>({ type: "BROWSER_STATE_READ" }).then((state) => {
      setToolStatuses(Array.isArray(state.activities) ? latestToolStatuses(state.activities).slice(-100) : []);
      const approval = state.prompts.find((prompt) => prompt.type === "approval");
      const permission = state.prompts.find((prompt) => prompt.type === "permission");
      if (approval) setToolApproval(approval.data as ToolApproval);
      if (permission) setToolPermission(permission.data as ToolPermission);
      const notice = freshCompletionNotice(state.completionNotice);
      if (notice) setCompletionNotice(notice);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!completionNotice) return;
    const remaining = Math.max(0, completionNotice.timestamp + COMPLETION_NOTICE_DURATION_MS - Date.now());
    const timer = window.setTimeout(() => {
      setCompletionNotice(null);
      void sendRequest({ type: "COMPLETION_NOTICE_DISMISS" }).catch(() => undefined);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [completionNotice]);

  useEffect(() => {
    modelPreferencesRef.current = { selectedModel, visibleModelIds };
  }, [selectedModel, visibleModelIds]);

  useEffect(() => {
    if (authState !== "ready") return;
    void sendRequest({ type: "AUTO_REVIEW_READ" }).then((result) => {
      const capabilities = reviewCapabilitiesSchema.safeParse(result);
      setReviewerAvailable(capabilities.success && capabilities.data.available);
    }).catch(() => setReviewerAvailable(false));
    void sendRequest<{ models: ModelOption[] }>({ type: "MODELS_READ" })
      .then((result) => {
        setModels(result.models);
        const available = new Set(["", ...result.models.map((model) => model.id)]);
        const preferences = modelPreferencesRef.current;
        const enabled = preferences.visibleModelIds?.filter((id) => available.has(id)) ?? [...available];
        if (enabled.length === 0) enabled.push("");
        setVisibleModelIds(preferences.visibleModelIds === null ? null : enabled);
        setSelectedModel(enabled.includes(preferences.selectedModel) ? preferences.selectedModel : enabled[0]);
      })
      .catch(() => setModels([]));
  }, [authState]);

  const deliverConversationSnapshot = useCallback((snapshot: ConversationSnapshot, epoch: number) => {
    if (epoch !== conversationSaveEpoch.current) return;
    void sendRequest({ type: "CONVERSATION_SAVE", snapshot }).then(() => {
      conversationSaveError.current = null;
    }).catch((cause: unknown) => {
      if (epoch !== conversationSaveEpoch.current) return;
      const text = cause instanceof Error ? cause.message : "This conversation could not be saved.";
      if (conversationSaveError.current === text) return;
      conversationSaveError.current = text;
      setError(text);
    });
  }, []);

  useEffect(() => {
    if (!hydrated || conversationPersistSuspended.current) return;
    const epoch = conversationSaveEpoch.current;
    const currentConversation = createConversationRecord(
      currentConversationId,
      threadId,
      messages,
      toolStatuses,
    );
    const retainedHistory = upsertConversation(conversationHistory, currentConversation);
    const snapshot: ConversationSnapshot = {
      savedAt: Date.now(),
      threadId,
      currentConversationId,
      messages: currentConversation.messages,
      theme,
      selectedModel,
      completionSoundEnabled,
      conversationHistory: retainedHistory,
    };
    conversationSnapshotRef.current = snapshot;
    const latestUserMessageId = [...messages].reverse().find((message) => message.role === "user")?.id ?? "";
    const saveKey = `${currentConversationId}:${latestUserMessageId}`;
    const saveImmediately = saveKey !== lastConversationSaveKey.current;
    lastConversationSaveKey.current = saveKey;
    if (conversationSaveTimer.current !== null) {
      window.clearTimeout(conversationSaveTimer.current);
      conversationSaveTimer.current = null;
    }
    if (saveImmediately) {
      deliverConversationSnapshot(snapshot, epoch);
      return;
    }
    conversationSaveTimer.current = window.setTimeout(() => {
      conversationSaveTimer.current = null;
      deliverConversationSnapshot(snapshot, epoch);
    }, CONVERSATION_SAVE_DELAY_MS);
  }, [completionSoundEnabled, conversationHistory, currentConversationId, deliverConversationSnapshot, hydrated, messages, selectedModel, theme, threadId, toolStatuses]);

  useEffect(() => {
    const flushConversationSnapshot = () => {
      if (conversationSaveTimer.current !== null) {
        window.clearTimeout(conversationSaveTimer.current);
        conversationSaveTimer.current = null;
      }
      const snapshot = conversationSnapshotRef.current;
      if (!snapshot) return;
      void chrome.runtime.sendMessage({
        type: "CONVERSATION_SAVE",
        requestId: crypto.randomUUID(),
        snapshot,
      });
    };
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") flushConversationSnapshot();
    };
    window.addEventListener("pagehide", flushConversationSnapshot);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", flushConversationSnapshot);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, []);

  useEffect(() => {
    completionSoundEnabledRef.current = completionSoundEnabled;
  }, [completionSoundEnabled]);

  useEffect(() => {
    if (!hydrated) return;
    void chrome.storage.local.set({ [BROWSER_TASK_ACTION_LIMIT_KEY]: browserTaskActionLimit });
  }, [browserTaskActionLimit, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    void chrome.storage.local.set({ [BROWSER_PERMISSION_MODE_KEY]: browserPermissionMode });
  }, [browserPermissionMode, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    if (visibleModelIds === null) void chrome.storage.local.remove(VISIBLE_MODELS_KEY);
    else void chrome.storage.local.set({ [VISIBLE_MODELS_KEY]: visibleModelIds });
  }, [visibleModelIds, hydrated]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const refreshSkills = useCallback(async () => {
    try {
      const result = await sendRequest<{ skills: SidebarSkill[] }>({ type: "SKILLS_LIST" });
      setTaughtSkills(result.skills);
      setSkillsError(null);
    } catch (cause) {
      setSkillsError(cause instanceof Error ? cause.message : "Unable to load taught skills.");
    }
  }, []);

  useEffect(() => {
    menuOpenRef.current = menuOpen;
  }, [menuOpen]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, toolApproval, toolPermission]);

  useEffect(() => {
    const listener = (message: SidebarEvent, sender: chrome.runtime.MessageSender) => {
      if (sender.id !== chrome.runtime.id || sender.tab !== undefined) return;
      if (message?.source !== "codex-sidebar-background") return;
      switch (message.event) {
        case "bridge.status":
          if ((message.data as { connected?: boolean })?.connected === false) setAuthState("offline");
          break;
        case "auth.updated":
        case "auth.loginCompleted":
          void refreshAccount();
          break;
        case "skills.changed":
          if (menuOpenRef.current) void refreshSkills();
          break;
        case "recording.status":
          if (message.data && typeof message.data === "object" && "status" in message.data) {
            setRecording(message.data as RecordingView);
            setRecordingError(null);
          }
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
          const data = message.data as { turn?: { status?: string; error?: { message?: string } } };
          const failed = !wasStopped && data.turn?.status === "failed";
          stopRequestedRef.current = false;
          turnExecutedToolRef.current = false;
          setActiveTurnId(null);
          setIsSending(false);
          setRetryPayload(failed && !completedBrowserTask ? inFlightPayloadRef.current : null);
          inFlightPayloadRef.current = null;
          if (failed) {
            setError(data.turn?.error?.message ?? "Codex could not process this message. Check the selected model and attachments before retrying.");
            setMessages((current) => current.map((item) => item.streaming ? { ...item, streaming: false, failed: true } : item));
          } else setMessages(settleCanceledMessages);
          if (completedBrowserTask && !wasStopped && !failed) {
            showCompletionNotice("Task complete — you can check the result when you’re ready.");
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
          setToolStatuses((current) => latestToolStatuses([...current, status]).slice(-100));
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
  }, [refreshAccount, refreshSkills, showCompletionNotice]);

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

  const clearPageAttachment = () => {
    pageAttachmentRequestRef.current = { generation: pageAttachmentRequestRef.current.generation + 1, pending: false };
    setAttachingPage(false);
    setAttachment(null);
    setPendingPageOrigin(null);
  };

  const capturePageAttachment = async () => {
    const generation = pageAttachmentRequestRef.current.generation + 1;
    pageAttachmentRequestRef.current = { generation, pending: true };
    setAttachingPage(true);
    try {
      const page = await sendRequest<PageAttachment>({ type: "PAGE_ATTACH" });
      if (pageAttachmentRequestRef.current.generation === generation) setAttachment(page);
    } catch (cause) {
      if (pageAttachmentRequestRef.current.generation !== generation) return;
      if (cause instanceof ExtensionRequestError && cause.code === "PAGE_PERMISSION_REQUIRED") {
        const originPattern = (cause.details as { originPattern?: unknown } | undefined)?.originPattern;
        if (typeof originPattern === "string") {
          setPendingPageOrigin(originPattern);
          setError("Allow access to this site to attach its current page.");
          return;
        }
      }
      setError(cause instanceof Error ? cause.message : "This page cannot be attached.");
    } finally {
      if (pageAttachmentRequestRef.current.generation === generation) {
        pageAttachmentRequestRef.current.pending = false;
        setAttachingPage(false);
      }
    }
  };

  const attachPage = async () => {
    setError(null);
    if (attachment || pageAttachmentRequestRef.current.pending || pendingPageOrigin) { clearPageAttachment(); return; }
    setPendingPageOrigin(null);
    await capturePageAttachment();
  };

  const addFiles = async (picked: File[]) => {
    if (picked.length === 0 || preparationRef.current || streaming || recordingActive) return;
    const room = MAX_ATTACHED_FILES - attachedFiles.length;
    if (room <= 0) {
      setError(`You can add up to ${MAX_ATTACHED_FILES} files.`);
      return;
    }
    const accepted: AttachedFile[] = [];
    const problems: string[] = [];
    const controller = new AbortController();
    preparationRef.current = controller;
    setPreparingFiles(true);
    try {
      let totalBytes = attachedFiles.reduce((sum, file) => sum + file.bytes, 0);
      for (const file of picked.slice(0, room)) {
        checkCanceled(controller.signal);
        setFileProgress(`Preparing ${file.name}…`);
        try {
          if (totalBytes + file.size > FILE_LIMITS.batchBytes) throw new Error("Choose at most 40 MiB of files per message.");
          accepted.push(await readAttachedFile(file, { signal: controller.signal }));
          totalBytes += file.size;
        } catch (cause) {
          checkCanceled(controller.signal);
          problems.push(cause instanceof Error ? cause.message : "That file could not be added.");
        }
      }
      if (picked.length > room) problems.push(`Only ${MAX_ATTACHED_FILES} files can be added.`);
      if (accepted.length > 0) { setAttachedFiles((current) => [...current, ...accepted].slice(0, MAX_ATTACHED_FILES)); setError(null); }
      if (problems.length > 0) setError(problems.join(" "));
    } catch (cause) {
      for (const file of accepted) releasePreparedFile(file);
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to prepare files.");
    } finally {
      if (preparationRef.current === controller) { preparationRef.current = null; setPreparingFiles(false); setFileProgress(null); }
    }
  };

  const prepareFileRange = async (file: AttachedFile, range: string) => {
    if (!file.source || preparationRef.current || streaming) return;
    const controller = new AbortController();
    preparationRef.current = controller;
    setPreparingFiles(true); setFileProgress(`Preparing selected pages of ${file.name}…`); setError(null);
    try {
      const prepared = await preparePdf(file.source, controller.signal, range);
      checkCanceled(controller.signal);
      setAttachedFiles((current) => current.map((item) => item.id === file.id ? { ...prepared, id: file.id, name: file.name, bytes: file.bytes, kind: file.kind, notice: file.notice ?? prepared.notice } : item));
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Unable to prepare those pages."); }
    finally { if (preparationRef.current === controller) { preparationRef.current = null; setPreparingFiles(false); setFileProgress(null); } }
  };

  const grantPageAccess = async () => {
    if (!pendingPageOrigin) return;
    const originPattern = pendingPageOrigin;
    const generation = pageAttachmentRequestRef.current.generation;
    try {
      const granted = await chrome.permissions.request({ origins: [originPattern] });
      if (pageAttachmentRequestRef.current.generation !== generation) return;
      if (!granted) {
        setError("Site access was not granted. No page content was read.");
        return;
      }
      const stored = await chrome.storage.local.get(PAGE_ORIGINS_KEY);
      if (pageAttachmentRequestRef.current.generation !== generation) return;
      const current = Array.isArray(stored[PAGE_ORIGINS_KEY])
        ? (stored[PAGE_ORIGINS_KEY] as string[])
        : [];
      await chrome.storage.local.set({
        [PAGE_ORIGINS_KEY]: [...new Set([...current, originPattern])],
      });
      if (pageAttachmentRequestRef.current.generation !== generation) return;
      setPendingPageOrigin(null);
      setError(null);
      await capturePageAttachment();
    } catch (cause) {
      if (pageAttachmentRequestRef.current.generation !== generation) return;
      setError(cause instanceof Error ? cause.message : "Unable to grant access to this site.");
    }
  };

  const requestFullSiteAccess = async (): Promise<boolean> => {
    try {
      const granted = await chrome.permissions.request({ origins: [...FULL_ACCESS_HOST_PATTERNS] });
      setFullSiteAccessGranted(granted);
      if (granted) {
        await chrome.storage.local.set({ [FULL_ACCESS_HOST_GRANT_KEY]: true });
        setError(null);
      } else {
        await chrome.storage.local.remove(FULL_ACCESS_HOST_GRANT_KEY);
        setError("Chrome did not grant all-sites access. Browser tasks will still pause for site permission.");
      }
      return granted;
    } catch (cause) {
      setFullSiteAccessGranted(false);
      await chrome.storage.local.remove(FULL_ACCESS_HOST_GRANT_KEY);
      setError(cause instanceof Error ? cause.message : "Unable to enable full browser access.");
      return false;
    }
  };

  const changeBrowserPermissionMode = async (mode: BrowserPermissionMode | "auto") => {
    if (mode === "auto" && !reviewerAvailable) return;
    if (mode === "full" && !(await requestFullSiteAccess())) return;
    const nextReview = { ...autoReview, enabled: mode === "auto" };
    // Persist legacy Ask with the additive review flag in one storage update.
    await chrome.storage.local.set({ [BROWSER_PERMISSION_MODE_KEY]: mode === "full" ? "full" : "ask", [AUTO_REVIEW_SETTINGS_KEY]: nextReview });
    setAutoReview(nextReview);
    setBrowserPermissionMode(mode === "full" ? "full" : "ask");
    if (mode !== "full") {
      setFullSiteAccessGranted(false);
      await chrome.storage.local.remove(FULL_ACCESS_HOST_GRANT_KEY);
      await chrome.permissions.remove({ origins: [...FULL_ACCESS_HOST_PATTERNS] }).catch(() => false);
    }
  };

  const saveReviewerSettings = async (next: AutoReviewSettings, updatePromptDraft = true) => {
    setReviewerSettingsError(null);
    setReviewerSettingsNotice(null);
    const parsed = autoReviewSettingsSchema.safeParse(next);
    if (!parsed.success) {
      setReviewerSettingsError(`Enter a model and a non-empty system prompt of at most ${MAX_REVIEW_SYSTEM_PROMPT.toLocaleString()} characters.`);
      return;
    }
    setReviewerSettingsSaving(true);
    try {
      await chrome.storage.local.set({ [AUTO_REVIEW_SETTINGS_KEY]: parsed.data });
      setAutoReview(parsed.data);
      if (updatePromptDraft) setReviewerPromptDraft(parsed.data.systemPrompt);
      setReviewerSettingsNotice(updatePromptDraft ? "Reviewer settings saved. Applies to the next browser task." : "Reviewer model saved. Save prompt to apply any prompt edits.");
    } catch (cause) {
      setReviewerSettingsError(cause instanceof Error ? cause.message : "Unable to save reviewer settings.");
    } finally { setReviewerSettingsSaving(false); }
  };

  const reviewerModelChoices = useMemo(() => {
    const choices = new Map<string, { id: string; name: string }>();
    choices.set(REVIEW_MODEL, { id: REVIEW_MODEL, name: `${REVIEW_MODEL} · Default` });
    for (const model of models) choices.set(model.id, { id: model.id, name: model.id === REVIEW_MODEL ? `${model.name} · Default` : model.name });
    if (!choices.has(autoReview.model)) choices.set(autoReview.model, { id: autoReview.model, name: `${autoReview.model} · Unavailable` });
    return [...choices.values()];
  }, [autoReview.model, models]);

  const runRecording = async (work: () => Promise<RecordingView | { name: string }>) => {
    setRecordingError(null);
    try {
      const result = await work();
      if ("status" in result) setRecording(result);
      return true;
    } catch (cause) {
      setRecordingError(cause instanceof Error ? cause.message : "Skill recording failed.");
      return false;
    }
  };

  const startRecording = async () => {
    const started = await runRecording(() => sendRequest<RecordingView>({ type: "RECORDING_START", description: recordWhen }));
    if (!started) return;
    setRecordComposerOpen(false);
    setRecordWhen("");
    setMenuOpen(false);
  };

  const grantRecordingSite = async () => {
    if (!recording.pendingOriginPattern) return;
    const originPattern = recording.pendingOriginPattern;
    try {
      const granted = browserPermissionMode === "full" && !fullSiteAccessGranted
        ? await requestFullSiteAccess()
        : await chrome.permissions.request({ origins: [originPattern] });
      if (!granted) {
        setRecordingError("Site access was not granted. Recording is paused on that page.");
        return;
      }
      await runRecording(() => sendRequest<RecordingView>({ type: "RECORDING_GRANT", originPattern, granted: true }));
    } catch (cause) {
      setRecordingError(cause instanceof Error ? cause.message : "Unable to grant access for recording.");
    }
  };

  const updateRecording = (patch: {
    name?: string;
    description?: string;
    notes?: string;
    deleteStepId?: string;
    keepExample?: { stepId: string; keep: boolean };
  }) => {
    void runRecording(() => sendRequest<RecordingView>({ type: "RECORDING_UPDATE", ...patch }));
  };

  const saveRecording = async (fields: { name: string; description: string; notes: string }) => {
    const updated = await runRecording(() => sendRequest<RecordingView>({ type: "RECORDING_UPDATE", ...fields }));
    if (!updated) return;
    const saved = await runRecording(() => sendRequest<{ name: string }>({ type: "RECORDING_SAVE" }));
    if (!saved) return;
    setMenuOpen(true);
    void refreshSkills();
  };

  const ensureThread = async (): Promise<{ threadId: string; replacedLegacy: boolean }> => {
    if (threadId && threadReadyRef.current) return { threadId, replacedLegacy: false };
    let replacedLegacy = false;
    if (threadId) {
      try {
        const resumed = await sendRequest<{ threadId: string }>({ type: "CHAT_RESUME", threadId, model: selectedModel || undefined });
        threadReadyRef.current = true;
        return { threadId: resumed.threadId, replacedLegacy: false };
      } catch (cause) {
        // The stored thread may have been cleared by Codex; start a replacement below.
        replacedLegacy = cause instanceof Error && isLegacyThreadError(cause.message);
      }
    }
    const created = await sendRequest<{ threadId: string }>({ type: "CHAT_START", model: selectedModel || undefined });
    setThreadId(created.threadId);
    threadReadyRef.current = true;
    return { threadId: created.threadId, replacedLegacy };
  };

  const sendChatMessage = async (initialPayload: RetryPayload, appendUser: boolean) => {
    if (streaming || recording.status !== "idle") return;
    let payload = { ...initialPayload };
    setIsSending(true);
    setError(null);
    setCompletionNotice(null);
    void sendRequest({ type: "COMPLETION_NOTICE_DISMISS" }).catch(() => undefined);
    setRetryPayload(null);
    inFlightPayloadRef.current = payload;
    turnExecutedToolRef.current = false;
    stopRequestedRef.current = false;
    const controller = new AbortController();
    sendAbortRef.current = controller;
    const messageId = payload.userMessageId;
    const displayText = payload.displayText;
    setMessages((current) => {
      const withoutFailedAssistant = appendUser
        ? current
        : current.filter((item) => !(item.role === "assistant" && item.failed));
      return [
        ...withoutFailedAssistant,
        ...(appendUser ? [{ id: messageId, role: "user" as const, text: displayText }] : []),
        { id: `${messageId}-assistant`, role: "assistant" as const, text: "", streaming: true },
      ];
    });
    try {
      const { threadId: activeThreadId, replacedLegacy } = await ensureThread();
      checkCanceled(controller.signal);
      if (payload.threadId && payload.threadId !== activeThreadId && payload.attachments?.length) throw new Error("These files belong to another conversation. Reattach them in this chat.");
      payload = { ...payload, threadId: activeThreadId };
      inFlightPayloadRef.current = payload;
      if (replacedLegacy) {
        setConversationHistory((current) => upsertConversation(
          current,
          createConversationRecord(currentConversationId, threadId, settleCanceledMessages(messages), toolStatuses),
        ));
        setCurrentConversationId(crypto.randomUUID());
        setMessages([
          { id: messageId, role: "user", text: payload.displayText },
          { id: `${messageId}-assistant`, role: "assistant", text: "", streaming: true },
        ]);
        setToolStatuses([]);
        showCompletionNotice("That chat was created by an older version and is now read-only in History, so your message started a new chat.");
      }
      if (payload.files.length > 0 && !payload.attachments) {
        payload = { ...payload, attachments: await uploadPreparedFiles(attachmentTransport, payload.owner, payload.files, controller.signal, setFileProgress) };
        inFlightPayloadRef.current = payload;
      }
      checkCanceled(controller.signal);
      const preparedAttachments = payload.attachments;
      if (preparedAttachments?.length) setMessages((current) => current.map((item) => item.id === messageId ? { ...item, attachments: preparedAttachments } : item));
      setFileProgress(null);
      const result = await sendRequest<{ turnId: string; attachments?: AttachmentSummary[]; replayed?: boolean }>({
        type: "CHAT_SEND",
        threadId: activeThreadId,
        text: payload.userText,
        pageContext: payload.pageContext,
        attachments: payload.attachments?.map((file) => file.id),
        owner: payload.owner,
        clientMessageId: payload.clientMessageId,
        model: payload.model,
      });
      payload = { ...payload, accepted: true };
      inFlightPayloadRef.current = payload;
      if (result.attachments?.length) setMessages((current) => current.map((item) => item.id === messageId ? { ...item, attachments: result.attachments } : item));
      if (stopRequestedRef.current) {
        await sendRequest({ type: "BROWSER_TASK_CANCEL", threadId: activeThreadId, turnId: result.turnId }).catch(() => undefined);
        await sendRequest({ type: "CHAT_INTERRUPT", threadId: activeThreadId, turnId: result.turnId }).catch(() => undefined);
        setIsSending(false);
        setMessages(settleCanceledMessages);
        return;
      }
      if (result.replayed) {
        setMessages(settleCanceledMessages);
        showCompletionNotice("This message was already accepted by Codex and was not sent twice. Check the conversation before starting another request.");
      } else setActiveTurnId(result.turnId);
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
      if (cause instanceof Error && isLegacyThreadError(cause.message)) threadReadyRef.current = false;
      setRetryPayload(payload);
      setError(cause instanceof Error ? cause.message : "Unable to send this message.");
    } finally {
      if (sendAbortRef.current === controller) sendAbortRef.current = null;
      setFileProgress(null);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if ((!text && attachedFiles.length === 0 && !attachment) || streaming || preparingFiles || attachingPage) return;
    if (attachedFiles.some((file) => !file.ready)) { setError("Choose and prepare the pages to share before sending."); return; }
    const visuals = attachedFiles.reduce((sum, file) => sum + file.pages.length, 0);
    const selected = models.find((model) => model.id === selectedModel) ?? models.find((model) => model.isDefault);
    if (visuals > 0 && selected?.inputModalities && !selected.inputModalities.includes("image")) { setError("Choose a model that supports images to share visual files."); return; }
    if (visuals > FILE_LIMITS.visualPages) { setError("Share at most 20 images/pages across all files. Choose smaller page ranges."); return; }
    const preparedBytes = attachedFiles.reduce((sum, file) => sum + file.pages.reduce((size, page) => size + page.blob.size, 0), 0);
    if (preparedBytes > FILE_LIMITS.preparedBytes) { setError("Prepared images exceed 32 MiB. Choose fewer pages."); return; }
    const characters = text.length + (attachment?.selectedText.length ?? 0) + (attachment?.readableText.length ?? 0) + attachedFiles.reduce((sum, file) => sum + file.text.length, 0) + visuals * 300 + attachedFiles.length * 600;
    if (characters > FILE_LIMITS.turnCharacters) { setError("The message and attachment text exceed 80,000 characters. Remove a file or choose fewer pages."); return; }
    const payload: RetryPayload = { displayText: text || "Describe the attached files.", userText: text, pageContext: attachment ?? undefined, files: attachedFiles, owner: crypto.randomUUID(), clientMessageId: crypto.randomUUID(), userMessageId: crypto.randomUUID(), model: selectedModel || undefined };
    setDraft("");
    clearPageAttachment();
    setAttachedFiles([]);
    await sendChatMessage(payload, true);
  };

  const retryLastMessage = async () => {
    if (!retryPayload || streaming) return;
    const nextPayload = { ...retryPayload, ...(retryPayload.accepted ? { clientMessageId: crypto.randomUUID(), accepted: false } : {}) };
    await sendChatMessage(nextPayload, false);
  };

  const copyMessage = async (message: ChatMessage) => {
    try {
      await navigator.clipboard.writeText(message.text);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = message.text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      const copied = document.execCommand("copy");
      textarea.remove();
      if (!copied) {
        setError("Unable to copy this response. Check the extension's clipboard access.");
        return;
      }
    }
    setCopiedMessageId(message.id);
    window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1_500);
  };

  const forkConversation = async (message: ChatMessage) => {
    if (!threadId || streaming || message.streaming || message.failed) return;
    const messageIndex = messages.findIndex((item) => item.id === message.id);
    if (messageIndex < 0) return;
    setForkingMessageId(message.id);
    setError(null);
    try {
      const result = await sendRequest<{ threadId: string }>({
        type: "CHAT_FORK",
        threadId,
        lastTurnId: message.id,
      });
      const forkedMessages = messages.slice(0, messageIndex + 1).map((item) => ({ ...item, streaming: false }));
      const forkedMessageIds = new Set(forkedMessages.map((item) => item.id));
      const forkedStatuses = toolStatuses.filter((status) => status.turnId && forkedMessageIds.has(status.turnId));
      const original = createConversationRecord(currentConversationId, threadId, messages, toolStatuses);
      setConversationHistory((current) => upsertConversation(current, original));
      setCurrentConversationId(crypto.randomUUID());
      setThreadId(result.threadId);
      threadReadyRef.current = true;
      setMessages(forkedMessages);
      setToolStatuses(forkedStatuses);
      setRetryPayload(null);
      clearPageAttachment();
      setAttachedFiles([]);
      setCompletionNotice(null);
      setHistoryOpen(false);
      setMenuOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to fork this conversation.");
    } finally {
      setForkingMessageId(null);
    }
  };

  const stop = async () => {
    preparationRef.current?.abort();
    sendAbortRef.current?.abort();
    stopRequestedRef.current = true;
    setIsSending(false);
    setError(null);
    setMessages(settleCanceledMessages);
    setToolApproval(null);
    setToolPermission(null);
    if (!threadId) return;
    const payload = inFlightPayloadRef.current;
    if (payload) {
      await sendRequest({ type: "CHAT_CANCEL_SEND", threadId: payload.threadId ?? threadId, clientMessageId: payload.clientMessageId }).catch(() => undefined);
      await attachmentTransport({ operation: "abort", owner: payload.owner }).catch(() => undefined);
    }
    await sendRequest({ type: "BROWSER_TASK_CANCEL", threadId, turnId: activeTurnId ?? undefined }).catch(() => undefined);
    if (activeTurnId) {
      await sendRequest({ type: "CHAT_INTERRUPT", threadId, turnId: activeTurnId }).catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Unable to stop the response.");
      });
    }
    setActiveTurnId(null);
  };

  const viewWorkingTab = async () => {
    if (!threadId) return;
    try {
      await sendRequest({ type: "WORKING_TAB_FOCUS", threadId });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to open the agent's working tab.");
    }
  };

  const newChat = () => {
    preparationRef.current?.abort();
    if (streaming) void stop();
    setConversationHistory((current) => upsertConversation(
      current,
      createConversationRecord(currentConversationId, threadId, settleCanceledMessages(messages), toolStatuses),
    ));
    setCompletionNotice(null);
    void sendRequest({ type: "COMPLETION_NOTICE_DISMISS" }).catch(() => undefined);
    setThreadId(null);
    setCurrentConversationId(crypto.randomUUID());
    threadReadyRef.current = false;
    setMessages([]);
    setToolStatuses([]);
    setToolApproval(null);
    setToolPermission(null);
    setRetryPayload(null);
    clearPageAttachment();
    setAttachedFiles([]);
    setMenuOpen(false);
    setHistoryOpen(false);
  };

  const openConversation = (conversation: ConversationRecord) => {
    preparationRef.current?.abort();
    if (streaming) return;
    setConversationHistory((current) => upsertConversation(
      current,
      createConversationRecord(currentConversationId, threadId, messages, toolStatuses),
    ));
    setCurrentConversationId(conversation.id);
    setThreadId(conversation.threadId);
    threadReadyRef.current = false;
    setMessages(conversation.messages.map((message) => ({ ...message, streaming: false })));
    setToolStatuses(conversation.toolStatuses);
    setToolApproval(null);
    setToolPermission(null);
    setRetryPayload(null);
    clearPageAttachment();
    setAttachedFiles([]);
    setError(null);
    setCompletionNotice(null);
    setHistoryOpen(false);
    setMenuOpen(false);
  };

  const clearBrowserStorage = async (cancelTask = true) => {
    conversationSaveEpoch.current += 1;
    conversationPersistSuspended.current = true;
    conversationSnapshotRef.current = null;
    lastConversationSaveKey.current = "";
    if (conversationSaveTimer.current !== null) {
      window.clearTimeout(conversationSaveTimer.current);
      conversationSaveTimer.current = null;
    }
    if (cancelTask && threadId) await sendRequest({ type: "BROWSER_TASK_CANCEL", threadId }).catch(() => undefined);
    await sendRequest({ type: "CONVERSATION_CLEAR" }).catch(() => undefined);
    const stored = await chrome.storage.local.get([PAGE_ORIGINS_KEY, TASK_ORIGINS_KEY]);
    const attachmentOrigins = Array.isArray(stored[PAGE_ORIGINS_KEY])
      ? (stored[PAGE_ORIGINS_KEY] as string[])
      : [];
    const taskOrigins = Array.isArray(stored[TASK_ORIGINS_KEY])
      ? (stored[TASK_ORIGINS_KEY] as string[])
      : [];
    const origins = [...new Set([...attachmentOrigins, ...taskOrigins, ...FULL_ACCESS_HOST_PATTERNS])];
    if (origins.length > 0) await chrome.permissions.remove({ origins }).catch(() => false);
    await chrome.storage.local.remove(STORAGE_KEY);
    await chrome.storage.local.remove(VISIBLE_MODELS_KEY);
    await chrome.storage.local.remove(AUTO_REVIEW_SETTINGS_KEY);
    await chrome.storage.local.remove(BROWSER_PERMISSION_MODE_KEY);
    await chrome.storage.local.remove(FULL_ACCESS_HOST_GRANT_KEY);
    await chrome.storage.local.remove(BROWSER_TASK_ACTION_LIMIT_KEY);
    await chrome.storage.local.remove(PAGE_ORIGINS_KEY);
    await chrome.storage.local.remove(TASK_ORIGINS_KEY);
    await chrome.storage.session.clear();
  };

  const resetBrowserState = () => {
    setVisibleModelIds(null);
    conversationPersistSuspended.current = false;
    setThreadId(null);
    threadReadyRef.current = false;
    setCurrentConversationId(crypto.randomUUID());
    setConversationHistory([]);
    setMessages([]);
    setDraft("");
    clearPageAttachment();
    setAttachedFiles([]);
    setTheme("system");
    setSelectedModel("");
    setBrowserPermissionMode(DEFAULT_BROWSER_PERMISSION_MODE);
    setAutoReview({ ...DEFAULT_AUTO_REVIEW });
    setReviewerPromptDraft(DEFAULT_REVIEW_SYSTEM_PROMPT);
    setReviewerSettingsError(null);
    setReviewerSettingsNotice(null);
    setFullSiteAccessGranted(false);
    setBrowserTaskActionLimit(DEFAULT_BROWSER_TASK_ACTION_LIMIT);
    setBrowserTaskActionLimitDraft(String(DEFAULT_BROWSER_TASK_ACTION_LIMIT));
    setCompletionSoundEnabled(false);
    completionSoundEnabledRef.current = false;
    setCompletionNotice(null);
    setMenuOpen(false);
    setHistoryOpen(false);
    setPendingPageOrigin(null);
    setToolStatuses([]);
    setToolApproval(null);
    setToolPermission(null);
    setRetryPayload(null);
    setActiveTurnId(null);
    setIsSending(false);
  };

  const clearLocalData = async () => {
    if (!confirm("Clear browser transcripts, preferences, activity, and site permissions? Your ChatGPT sign-in and local Codex data on this computer will be kept.")) return;
    await clearBrowserStorage();
    resetBrowserState();
  };

  const deleteAllLocalData = async () => {
    if (!confirm("Delete all Browser Control data from this browser and computer, including local conversations and the Browser Control ChatGPT sign-in? The installed companion will be kept.")) return;
    setError(null);
    preparationRef.current?.abort();
    sendAbortRef.current?.abort();
    try {
      if (threadId) await sendRequest({ type: "BROWSER_TASK_CANCEL", threadId }).catch(() => undefined);
      await sendRequest({ type: "DELETE_ALL_LOCAL_DATA" });
      await clearBrowserStorage(false);
      resetBrowserState();
      setAccount(null);
      setLogin(null);
      setAuthState("signed-out");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to delete all Browser Control data.");
    }
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
      const granted = approved
        ? browserPermissionMode === "full"
          ? await requestFullSiteAccess()
          : await chrome.permissions.contains({ origins: [pending.originPattern] }) ||
            await chrome.permissions.request({ origins: [pending.originPattern] })
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

  const canSend = (draft.trim().length > 0 || attachedFiles.length > 0 || Boolean(attachment)) && !streaming && !preparingFiles && !attachingPage && attachedFiles.every((file) => file.ready) && !recordingActive && authState === "ready";
  const greeting = greetingFor(new Date().getHours());
  const modelChoices = [{ id: "", name: "Codex default", isDefault: false }, ...models];
  const composerModels = modelChoices.filter((model) => visibleModelIds === null || visibleModelIds.includes(model.id) || model.id === selectedModel);
  const selectModel = (id: string) => {
    setSelectedModel(id);
    if (visibleModelIds !== null && !visibleModelIds.includes(id)) setVisibleModelIds([...visibleModelIds, id]);
  };
  const toggleVisibleModel = (id: string, checked: boolean) => {
    const next = checked ? [...new Set([...composerModels.map((model) => model.id), id])] : composerModels.filter((model) => model.id !== id).map((model) => model.id);
    if (next.length === 0) return;
    setVisibleModelIds(next);
    if (!next.includes(selectedModel)) setSelectedModel(next[0]);
  };
  const enabledSkillCount = taughtSkills.filter((skill) => skill.enabled).length;
  const activitiesByTurn = useMemo(() => groupToolStatuses(toolStatuses), [toolStatuses]);
  const visibleConversationHistory = useMemo(() => upsertConversation(
    conversationHistory,
    createConversationRecord(currentConversationId, threadId, messages, toolStatuses),
  ), [conversationHistory, currentConversationId, messages, threadId, toolStatuses]);

  if (authState !== "ready") {
    return (
      <main className="welcome-shell">
        <div className="welcome-hero rise">
          <OrbMark size="large" />
          <p className="eyebrow">Browser Control</p>
          <h1>Codex, right beside your tabs.</h1>
          <p className="welcome-copy">
            Ask about what you're reading, tidy your tabs, or hand off supervised page work. You see every step and can stop at any time.
          </p>
        </div>

        <ol className="setup-steps rise" aria-label="Setup progress">
          {setupSteps(authState, isMissingNativeHost(error)).map((step, index) => (
            <li key={step.id} className={`setup-step setup-step-${step.state}`} aria-current={step.state === "current" ? "step" : undefined}>
              <span className="setup-step-marker" aria-hidden="true">{step.state === "done" ? "✓" : step.state === "attention" ? "!" : index + 1}</span>
              <span className="setup-step-text">
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
            </li>
          ))}
        </ol>

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
        ) : authState !== "offline" && (
          <button className="primary-button welcome-action rise" onClick={() => void signIn()} disabled={authState === "checking"}>
            {authState === "checking" ? "Connecting…" : "Sign in with ChatGPT"}
          </button>
        )}

        {isMissingNativeHost(error) ? (
          <section className="setup-card" aria-live="polite">
            <p className="login-label">The companion is not registered in this browser yet.</p>
            <p>Node.js, Codex, and this extension can be installed in any order. Run this in any folder. It downloads the companion and registers it:</p>
            <code className="setup-command">{COMPANION_INSTALL_COMMAND}</code>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(COMPANION_INSTALL_COMMAND).catch(() => undefined);
              }}
            >Copy command</button>
            {desktopOs === "linux" && <p>Use a normal Chrome or Brave package. Snap and Flatpak builds cannot start the companion.</p>}
            <p>Leave this panel open, then choose Retry connection.</p>
          </section>
        ) : error && <div className="error-banner" role="alert">{error}</div>}
        {(authState === "offline" || authState === "error") && (
          <div className="connection-actions">
            <button className="secondary-button" onClick={() => void refreshAccount()}>Retry connection</button>
            {!isMissingNativeHost(error) && (
              <button className="text-button" onClick={() => void sendRequest({ type: "OPEN_EXTERNAL", url: COMPANION_SUPPORT_URL })}>
                Install or update companion
              </button>
            )}
          </div>
        )}
        <ul className="welcome-features rise">
          <li><strong>You choose what it sees.</strong> Pages are shared only when you attach them.</li>
          <li><strong>Every action is visible.</strong> Watch each step in the activity list and press Stop any time.</li>
          <li><strong>Teach it once.</strong> Record a task and reuse it as a local skill.</li>
        </ul>
        <p className="privacy-note">Your ChatGPT sign-in stays in the local Codex companion, not in the extension.</p>
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
          <button
            type="button"
            className={`icon-button record-button${recordingActive || recordComposerOpen ? " record-button-active" : ""}`}
            aria-label="Record a skill"
            aria-expanded={recordComposerOpen}
            data-tooltip={recordingActive ? "Finish or cancel the recording below" : "Record clicks and typing, then save them as a skill after review"}
            disabled={streaming || recordingActive}
            onClick={() => {
              setRecordComposerOpen((open) => !open);
              setMenuOpen(false);
              setHistoryOpen(false);
              setModelMenuOpen(false);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.75" y="7.25" width="12" height="9.5" rx="2" /><path d="m14.75 10.5 6.2-2.8v8.6l-6.2-2.8z" /></svg>
          </button>
          <button
            className="icon-button history-button"
            aria-label="Open conversation history"
            aria-expanded={historyOpen}
            data-tooltip="Open conversations saved in this browser"
            disabled={streaming}
            onClick={() => {
              setHistoryOpen(!historyOpen);
              setMenuOpen(false);
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6.6 15.5a6.2 6.2 0 1 0 2.3-8.5" />
              <path d="M11.4 6.2 8.9 7 10.4 4.4" />
              <path d="M12 12.4V9.6" />
              <path d="M12 12.4l2.2 1.3" />
            </svg>
          </button>
          <button className="icon-button" aria-label="Start a new chat" data-tooltip="Start a new conversation. This one stays in history." onClick={newChat}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5v13M5.5 12h13" /></svg>
          </button>
          <button className="icon-button" aria-label="Open settings" aria-expanded={menuOpen} data-tooltip="Theme, model, permissions, and saved skills" onClick={() => {
            setMenuOpen(!menuOpen);
            setHistoryOpen(false);
            if (!menuOpen) void refreshSkills();
          }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle className="solid" cx="6" cy="12" r="1.25" /><circle className="solid" cx="12" cy="12" r="1.25" /><circle className="solid" cx="18" cy="12" r="1.25" /></svg>
          </button>
        </div>
        {historyOpen && (
          <section className="history-card" aria-label="Conversation history">
            <div className="history-heading">
              <strong>History</strong>
              <span>{visibleConversationHistory.length} saved</span>
            </div>
            {visibleConversationHistory.length === 0 ? (
              <p className="history-empty">Your conversations will appear here after you send a message.</p>
            ) : (
              <ol className="history-list">
                {visibleConversationHistory.map((conversation) => (
                  <li key={conversation.id}>
                    <button
                      aria-current={conversation.id === currentConversationId ? "page" : undefined}
                      onClick={() => openConversation(conversation)}
                    >
                      <strong>{conversation.title}</strong>
                      <span>{new Date(conversation.updatedAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
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
              <select value={selectedModel} onChange={(event) => selectModel(event.target.value)}>
                <option value="">Codex default</option>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}{model.isDefault ? " · Default" : ""}</option>
                ))}
              </select>
            </label>
            <p className="menu-hint">Model changes apply to your next message.</p>
            <fieldset className="model-visibility">
              <legend>Models in composer</legend>
              <p className="menu-hint">Choose which models appear in the message box. Keep at least one selected.</p>
              <div className="model-visibility-options">
                {modelChoices.map((model) => {
                  const checked = composerModels.some((choice) => choice.id === model.id);
                  return <label key={model.id}>
                    <input type="checkbox" checked={checked} disabled={checked && composerModels.length === 1} onChange={(event) => toggleVisibleModel(model.id, event.target.checked)} />
                    <span>{model.name}</span>
                  </label>;
                })}
              </div>
            </fieldset>
            <label>
              Agent permission
              <select
                value={permissionMode}
                disabled={streaming || reviewerSettingsSaving}
                onChange={(event) => void changeBrowserPermissionMode(event.target.value === "auto" ? "auto" : normalizeBrowserPermissionMode(event.target.value)).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to save the permission setting."))}
              >
                <option value="full">Full access · Default</option>
                <option value="ask">Ask every time</option>
                <option value="auto" disabled={!reviewerAvailable}>Auto review</option>
              </select>
            </label>
            <p className="menu-hint">
              {browserPermissionMode === "full"
                ? fullSiteAccessGranted
                  ? "All-sites access enabled. Supported actions run without site or approval cards; hard safety blocks still apply."
                  : "Full access needs one Chrome all-sites grant before tasks can run without site prompts."
                : permissionMode === "auto"
                  ? "Your selected model reviews eligible low-risk confirmations. Risky, unclear, or unavailable reviews come to you. Site grants still need your approval."
                  : "Pauses before form submission, consequential controls, Enter submissions, and tab closing."}
              {" "}Applies to the next browser task.
            </p>
            {!reviewerAvailable && <p className="menu-hint">Auto review requires the updated companion and verified Codex CLI 0.162.1.</p>}
            <details className="reviewer-settings" open={permissionMode === "auto"}>
              <summary>Auto review settings</summary>
              <label>
                Reviewer model
                <select value={autoReview.model} disabled={streaming || reviewerSettingsSaving || models.length === 0} onChange={(event) => void saveReviewerSettings({ ...autoReview, model: event.target.value }, false)}>
                  {reviewerModelChoices.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
              </label>
              <p className="menu-hint">Choose from your Codex models. Composer model visibility does not affect this list. If a model is unavailable or cannot complete a structured review, the action comes to you.</p>
              <label>
                Reviewer system prompt
                <textarea className="reviewer-prompt" rows={8} maxLength={MAX_REVIEW_SYSTEM_PROMPT} spellCheck={false} value={reviewerPromptDraft} disabled={streaming || reviewerSettingsSaving} onChange={(event) => {
                  setReviewerPromptDraft(event.target.value);
                  setReviewerSettingsError(null);
                  setReviewerSettingsNotice(null);
                }} />
              </label>
              <p className="menu-hint">{reviewerPromptDraft.length.toLocaleString()} / {MAX_REVIEW_SYSTEM_PROMPT.toLocaleString()} characters. Saved changes apply to the next browser task. Browser permission and approval limits still apply.</p>
              <div className="reviewer-settings-actions">
                <button type="button" disabled={streaming || reviewerSettingsSaving || reviewerPromptDraft === autoReview.systemPrompt} onClick={() => void saveReviewerSettings({ ...autoReview, systemPrompt: reviewerPromptDraft })}>Save prompt</button>
                <button type="button" disabled={streaming || reviewerSettingsSaving || (reviewerPromptDraft === DEFAULT_REVIEW_SYSTEM_PROMPT && autoReview.systemPrompt === DEFAULT_REVIEW_SYSTEM_PROMPT)} onClick={() => void saveReviewerSettings({ ...autoReview, systemPrompt: DEFAULT_REVIEW_SYSTEM_PROMPT })}>Reset prompt to default</button>
              </div>
              {reviewerSettingsError && <p className="menu-hint reviewer-settings-error" role="alert">{reviewerSettingsError}</p>}
              {reviewerSettingsNotice && <p className="menu-hint" role="status">{reviewerSettingsNotice}</p>}
              <details className="reviewer-response-rules">
                <summary>Required response rules</summary>
                <p className="menu-hint">{REQUIRED_REVIEW_INSTRUCTIONS}</p>
              </details>
              <p className="menu-hint">Uses your existing Codex sign-in and adds model usage. Reviews receive your request and the proposed action context. Your chat model stays the same. Stop cancels a pending review.</p>
            </details>
            {browserPermissionMode === "full" && !fullSiteAccessGranted && (
              <button className="settings-grant-button" disabled={streaming} onClick={() => void requestFullSiteAccess()}>
                Enable full browser access
              </button>
            )}
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
              {MIN_BROWSER_TASK_ACTION_LIMIT}–{MAX_BROWSER_TASK_ACTION_LIMIT}; applies to the next request.
            </p>
            <div className="skill-settings">
              <p className="menu-hint">Taught skills</p>
              <p className="menu-hint">Saved on this computer and matched automatically when a request fits. Record a new skill from the message box. Choosing a skill does not skip action confirmations.</p>
              {skillsError && <p className="menu-hint">{skillsError}</p>}
              {taughtSkills.length === 0 ? (
                <p className="menu-hint">No taught skills yet.</p>
              ) : (
                <ul className="skill-list">
                  {taughtSkills.map((skill, index) => (
                    <li key={`${skill.name}-${index}`} className="skill-row">
                      <header>
                        <strong>{skill.name}</strong>
                        <button
                          type="button"
                          className="skill-delete"
                          aria-label={`Delete ${skill.name}`}
                          onClick={() => {
                            if (!window.confirm(`Delete the skill “${skill.name}”? This removes it from this computer.`)) return;
                            void sendRequest({ type: "SKILLS_DELETE", name: skill.name })
                              .then(() => refreshSkills())
                              .catch((cause: unknown) => setSkillsError(cause instanceof Error ? cause.message : "Unable to delete that skill."));
                          }}
                        >
                          Delete
                        </button>
                      </header>
                      <p>{skill.description}</p>
                      <label className="toggle-row">
                        <span>Available to the agent</span>
                        <input
                          type="checkbox"
                          checked={skill.enabled}
                          aria-label={`Use ${skill.name} automatically`}
                          onChange={(event) => {
                            const enabled = event.target.checked;
                            void sendRequest({ type: "SKILLS_SET_ENABLED", name: skill.name, enabled })
                              .then(() => refreshSkills())
                              .catch((cause: unknown) => setSkillsError(cause instanceof Error ? cause.message : "Unable to update that skill."));
                          }}
                        />
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
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
            <button onClick={() => void clearLocalData()}>Clear browser data and permissions</button>
            <button className="settings-delete-button" onClick={() => void deleteAllLocalData()}>
              Delete all Browser Control data and sign out
            </button>
            <button
              className="settings-logout-button"
              disabled={streaming}
              onClick={() => void signOut()}
            >
              <span>Log out of ChatGPT</span>
              {account?.email && <small>{account.email}</small>}
            </button>
          </section>
        )}
      </header>

      <div className="transcript" ref={transcriptRef} aria-live="polite">
        {messages.length === 0 ? (
          <section className="empty-state">
            <OrbMark />
            <p className="eyebrow rise">{greeting}</p>
            <h1 className="rise">What should we work on?</h1>
            <p className="rise">Ask about a page, organize your tabs, or hand off a supervised task in the working tab.</p>
            {browserPermissionMode === "full" && !fullSiteAccessGranted && (
              <button className="full-access-setup" onClick={() => void requestFullSiteAccess()}>
                <strong>Enable Full access</strong>
                <span>Approve Chrome once so browser tasks do not pause site by site.</span>
              </button>
            )}
            <div className="prompt-grid rise">
              {STARTER_TASKS.map((task) => (
                <button key={task.id} onClick={() => {
                  setDraft(task.prompt);
                  composerRef.current?.focus();
                }}>
                  <StarterIcon id={task.id} />
                  <strong>{task.title}</strong>
                  <span>{task.detail}</span>
                </button>
              ))}
            </div>
            <p className="home-status rise">
              <span>{permissionMode === "auto" ? "Auto review" : browserPermissionMode === "full" ? "Full access" : "Ask every time"}</span>
              {enabledSkillCount > 0 && <span>{enabledSkillCount === 1 ? "1 taught skill" : `${enabledSkillCount} taught skills`}</span>}
              <span>Stop any time</span>
            </p>
          </section>
        ) : (
          messages.map((message) => {
            const activity = message.role === "assistant"
              ? activitiesByTurn.get(message.id) ?? (message.streaming && activeTurnId ? activitiesByTurn.get(activeTurnId) : undefined)
              : undefined;
            return (
              <div key={message.id} className="turn-block">
                {activity && (
                  <ToolActivity
                    key={`${message.id}-${String(!message.streaming && activeTurnId !== message.id)}`}
                    statuses={activity}
                    complete={!message.streaming && activeTurnId !== message.id}
                  />
                )}
                {(message.role === "user" || message.text || message.streaming) && <article className={`message message-${message.role} ${message.failed ? "message-failed" : ""}`}>
                  <span className="message-role">{message.role === "user" ? "You" : "Browser Control"}</span>
                  {message.role === "assistant" ? (
                    message.text ? (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        urlTransform={sanitizeMarkdownUrl}
                        components={{
                          img: () => null,
                          a: ({ children, href, title }) => {
                            const safeHref = href && isSafeHttpUrl(href) ? href : undefined;
                            if (!safeHref) return <span>{children}</span>;
                            return <a href={safeHref} title={title} target="_blank" rel="noreferrer noopener">{children}</a>;
                          },
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
                  {message.role === "user" && message.attachments?.length ? <SentFiles files={message.attachments} threadId={threadId} transport={attachmentTransport} /> : null}
                  {message.role === "assistant" && message.text && !message.streaming && !message.failed && (
                    <div className="message-actions" aria-label="Response actions">
                      <button type="button" onClick={() => void copyMessage(message)} data-tooltip="Copy this response">
                        <span aria-hidden="true">▣</span> {copiedMessageId === message.id ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void forkConversation(message)}
                        disabled={!threadId || Boolean(forkingMessageId) || streaming}
                        data-tooltip="Start a new conversation from this response"
                      >
                        <span aria-hidden="true">⑂</span> {forkingMessageId === message.id ? "Forking…" : "Fork"}
                      </button>
                    </div>
                  )}
                </article>}
              </div>
            );
          })
        )}

        {toolPermission && (
          <section className="approval-card permission-card" role="alertdialog" aria-labelledby="permission-title">
            <p className="eyebrow">{browserPermissionMode === "full" ? "Finish Full access setup" : "Site access required"}</p>
            <h2 id="permission-title">
              {browserPermissionMode === "full" ? "Allow Browser Control on all sites?" : "Allow browser actions here?"}
            </h2>
            <p>{browserPermissionMode === "full" ? "One Chrome permission, then no site-by-site prompts." : toolPermission.origin}</p>
            <small>
              {browserPermissionMode === "full"
                ? "This grants optional access to normal http and https pages. Clear local data or Chrome site controls can revoke it."
                : "Access is limited to this exact site and remembered until you clear it in settings or Chrome."}
            </small>
            <div className="approval-actions">
              <button className="secondary-button" onClick={() => void decidePagePermission(false)}>Cancel</button>
              <button className="primary-button" onClick={() => void decidePagePermission(true)}>
                {browserPermissionMode === "full" ? "Enable Full access" : "Allow this site"}
              </button>
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
        {recordingActive && (
          <section className="recording-panel" aria-label="Skill recording">
            <p className="eyebrow">{recording.status === "review" ? "Review skill" : "Recording a skill"}</p>
            <h2>{recording.name || "Taught skill"}</h2>
            {recording.notice && <p>{recording.notice}</p>}
            {recordingError && <p className="recording-error">{recordingError}</p>}
            {recording.status === "needs-permission" && recording.pendingOriginPattern && (
              <div className="recording-actions">
                <button type="button" className="secondary-button" onClick={() => void runRecording(() => sendRequest<RecordingView>({ type: "RECORDING_CANCEL" }))}>Cancel</button>
                <button type="button" className="primary-button" onClick={() => void grantRecordingSite()}>
                  {browserPermissionMode === "full" && !fullSiteAccessGranted ? "Enable Full access" : "Allow this site"}
                </button>
              </div>
            )}
            {recording.status === "recording" && (
              <>
                <ol className="recording-steps">
                  {recording.steps.length === 0 ? <li>Use the page. Clicks and typing will appear here.</li> : recording.steps.map((step) => (
                    <li key={step.id}>{recordingStepSummary(step)}</li>
                  ))}
                </ol>
                <div className="recording-actions">
                  <button type="button" className="secondary-button" onClick={() => void runRecording(() => sendRequest<RecordingView>({ type: "RECORDING_CANCEL" }))}>Cancel</button>
                  <button type="button" className="primary-button" onClick={() => void runRecording(() => sendRequest<RecordingView>({ type: "RECORDING_STOP" }))}>Done</button>
                </div>
              </>
            )}
            {recording.status === "review" && (
              <RecordingReview
                key={JSON.stringify([recording.name, recording.description, recording.notes])}
                recording={recording}
                onUpdate={updateRecording}
                onCancel={() => void runRecording(() => sendRequest<RecordingView>({ type: "RECORDING_CANCEL" }))}
                onSave={(fields) => void saveRecording(fields)}
              />
            )}
          </section>
        )}
        {activeBrowserTask && threadId && (
          <>
            <span className="sr-only" role="status">Browser Control started working in a browser tab.</span>
            <button type="button" className="working-tab-banner" onClick={() => void viewWorkingTab()}>
              <span className="working-tab-status"><i aria-hidden="true" />Agent is working in a browser tab</span>
              <strong>View working tab <span aria-hidden="true">↗</span></strong>
            </button>
          </>
        )}
        {completionNotice && (
          <div className="completion-banner" role="status">
            <span>{completionNotice.message}</span>
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
            <button aria-label="Remove page attachment" onClick={clearPageAttachment}>×</button>
          </div>
        )}
        {fileProgress && <div className="file-progress" role="status"><span>{fileProgress}</span><button type="button" onClick={() => void stop()}>Stop</button></div>}
        {attachedFiles.length > 0 && <FileCards files={attachedFiles} disabled={streaming || preparingFiles} onRemove={(id) => setAttachedFiles((current) => current.filter((file) => file.id !== id))} onRange={(file, range) => void prepareFileRange(file, range)} />}
        {recordComposerOpen && !recordingActive && (
          <form className="record-start composer-record" onSubmit={(event) => {
            event.preventDefault();
            void startRecording();
          }}>
            <label>
              When should the agent use this skill?
              <textarea
                value={recordWhen}
                maxLength={500}
                rows={3}
                onChange={(event) => setRecordWhen(event.target.value)}
                placeholder="Create a calendar event from the title and time in the request."
              />
            </label>
            <div className="recording-actions">
              <button type="button" className="secondary-button" onClick={() => setRecordComposerOpen(false)}>Cancel</button>
              <button type="submit" className="primary-button" disabled={recordWhen.trim().length === 0 || streaming}>Start recording</button>
            </div>
          </form>
        )}
        <form className={`composer${streaming ? " composer-running" : ""}`} aria-label="Message composer" aria-busy={streaming} onSubmit={(event) => void submit(event)} onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles([...event.dataTransfer.files]); } }}>
          <textarea
            ref={composerRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPaste={(event) => { const files = [...event.clipboardData.files]; if (files.length) { event.preventDefault(); void addFiles(files); } }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSend) event.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder={recordingActive ? "Finish or cancel skill recording before sending" : "Ask Browser Control…"}
            disabled={recordingActive}
            aria-label="Message Browser Control"
            rows={1}
          />
          <div className="composer-toolbar">
            <div className="composer-tools">
              <button type="button" className="attach-button" onClick={() => void attachPage()} aria-label={attachment ? "Detach the current page" : attachingPage || pendingPageOrigin ? "Cancel page attachment" : "Attach the current page"} aria-pressed={Boolean(attachment) || attachingPage || Boolean(pendingPageOrigin)} data-tooltip={attachment ? "Remove this page from your next message" : attachingPage || pendingPageOrigin ? "Cancel attaching this page" : "Share the current page with this message"} disabled={recordingActive}>
                {attachment ? "⊖" : "⊕"} <span>{attachment ? "Detach page" : attachingPage || pendingPageOrigin ? "Cancel attachment" : "Attach page"}</span>
              </button>
              <button
                type="button"
                className="attach-button"
                aria-label="Add files"
                data-tooltip="Add images, visual PDFs, Markdown, or text. Preparation stays on this computer; selected content is sent to Codex when you send."
                disabled={recordingActive || streaming || preparingFiles || attachedFiles.length >= MAX_ATTACHED_FILES}
                onClick={() => fileInputRef.current?.click()}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7.5V16a4 4 0 0 0 8 0V6.5a2.5 2.5 0 0 0-5 0V15a1 1 0 0 0 2 0V8" /></svg>
                <span>Add files</span>
              </button>
              <input
                ref={fileInputRef}
                className="sr-only"
                type="file"
                aria-label="Choose files"
                multiple
                tabIndex={-1}
                accept="image/png,image/jpeg,image/webp,image/gif,.pdf,text/*,.md,.markdown,.json,.csv,.tsv,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.yml,.yaml,.toml,.sql,.log,.svg"
                onChange={(event) => {
                  const picked = [...(event.target.files ?? [])];
                  event.target.value = "";
                  void addFiles(picked);
                }}
              />
              <div className="model-picker" ref={modelPickerRef}>
                <button
                  type="button"
                  className="model-card"
                  aria-haspopup="listbox"
                  aria-expanded={modelMenuOpen}
                  aria-label={`Model, ${selectedModelLabel(models, selectedModel)}`}
                  disabled={recordingActive}
                  onClick={() => setModelMenuOpen((open) => !open)}
                >
                  <span>{selectedModelLabel(models, selectedModel)}</span>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 10l5 5 5-5" /></svg>
                </button>
                {modelMenuOpen && (
                  <ul className="model-menu" role="listbox" aria-label="Models">
                    {composerModels.map((model) => (
                      <li key={model.id}>
                        <button type="button" role="option" aria-selected={selectedModel === model.id} onClick={() => { selectModel(model.id); setModelMenuOpen(false); }}>
                          {model.name}{model.isDefault ? " · Default" : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            {streaming ? (
              <button type="button" className="stop-button" onClick={() => void stop()} aria-label="Stop response" data-tooltip="Stop the current response">■</button>
            ) : (
              <button type="submit" className="send-button" disabled={!canSend} aria-label="Send message" data-tooltip="Send this message">↑</button>
            )}
          </div>
        </form>
        <p className="composer-note">Pages and files are shared only when you add them. AI can make mistakes.</p>
      </footer>
    </main>
  );
}
