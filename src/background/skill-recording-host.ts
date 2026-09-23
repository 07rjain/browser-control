import { z } from "zod";
import {
  FULL_ACCESS_HOST_GRANT_KEY,
  FULL_ACCESS_HOST_PATTERNS,
  TASK_ORIGINS_KEY,
  originPatternForUrl,
} from "../shared/page-tools";
import {
  ACTIVE_BROWSER_TASK_WINDOW_MS,
  IDLE_RECORDING_VIEW,
  RECORDER_PORT_NAME,
  RECORDING_SESSION_KEY,
  appendRecordingStep,
  previewSkillDocument,
  recorderMessageSchema,
  storedRecordingStepSchema,
  suggestedSkillName,
  withRecorderLocation,
  type RecordingView,
  type StoredRecordingStep,
} from "../shared/skill-recording";
import { cleanPageLabel, publicLocation, sanitizeSkillField } from "../shared/skill-text";

const BROWSER_TASKS_KEY = "codexSidebarBrowserTasks";

const sessionSchema = z.object({
  status: z.enum(["recording", "needs-permission", "review"]),
  nonce: z.string().uuid(),
  description: z.string().max(500),
  name: z.string().max(100),
  notes: z.string().max(4_000),
  steps: z.array(storedRecordingStepSchema).max(80),
  observedTabId: z.number().int().positive().optional(),
  pendingOrigin: z.string().max(300).optional(),
  pendingOriginPattern: z.string().max(300).optional(),
  lastOrigin: z.string().max(300).optional(),
  lastPath: z.string().max(500).optional(),
  truncated: z.boolean(),
  updatedAt: z.number(),
}).strict();

type RecordingSession = z.infer<typeof sessionSchema>;

const recorderPorts = new Map<number, chrome.runtime.Port>();
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function broadcast(event: string, data?: unknown): void {
  void chrome.runtime.sendMessage({ source: "codex-sidebar-background", event, data }).catch(() => undefined);
}

async function loadSession(): Promise<RecordingSession | null> {
  const stored = await chrome.storage.session.get(RECORDING_SESSION_KEY);
  const parsed = sessionSchema.safeParse(stored[RECORDING_SESSION_KEY]);
  if (parsed.success) return parsed.data;
  if (stored[RECORDING_SESSION_KEY] !== undefined) await chrome.storage.session.remove(RECORDING_SESSION_KEY);
  return null;
}

async function saveSession(session: RecordingSession | null): Promise<void> {
  if (!session) {
    await chrome.storage.session.remove(RECORDING_SESSION_KEY);
    return;
  }
  session.updatedAt = Date.now();
  const stored = sessionSchema.parse(JSON.parse(JSON.stringify(session)));
  await chrome.storage.session.set({ [RECORDING_SESSION_KEY]: stored });
}

function viewFrom(session: RecordingSession | null): RecordingView {
  if (!session) return IDLE_RECORDING_VIEW;
  const preview = session.status === "review"
    ? previewSkillDocument(session)
    : { preview: "", previewError: "" };
  let notice = "";
  if (session.status === "needs-permission" && session.pendingOrigin) {
    notice = `Allow browser actions on ${session.pendingOrigin} to keep recording.`;
  } else if (session.status === "recording" && session.observedTabId === undefined) {
    notice = "Open a normal http or https page to continue recording.";
  } else if (session.truncated) {
    notice = "The step list is full. Stop and delete steps you do not want.";
  }
  return {
    status: session.status,
    description: session.description,
    name: session.name,
    notes: session.notes,
    notice,
    pendingOrigin: session.pendingOrigin ?? "",
    pendingOriginPattern: session.pendingOriginPattern ?? "",
    steps: session.steps,
    preview: preview.preview,
    previewError: preview.previewError,
    truncated: session.truncated,
  };
}

function publish(session: RecordingSession | null): RecordingView {
  const view = viewFrom(session);
  broadcast("recording.status", view);
  return view;
}

async function hasRememberedControlAccess(originPattern: string): Promise<boolean> {
  const stored = await chrome.storage.local.get([TASK_ORIGINS_KEY, FULL_ACCESS_HOST_GRANT_KEY]);
  const rememberedOrigins = Array.isArray(stored[TASK_ORIGINS_KEY]) ? stored[TASK_ORIGINS_KEY] as string[] : [];
  if (rememberedOrigins.includes(originPattern)) return chrome.permissions.contains({ origins: [originPattern] });
  if (stored[FULL_ACCESS_HOST_GRANT_KEY] !== true) return false;
  const broadGrantPresent = await chrome.permissions.contains({ origins: [...FULL_ACCESS_HOST_PATTERNS] });
  if (!broadGrantPresent) return false;
  return chrome.permissions.contains({ origins: [originPattern] });
}

async function focusedActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function activeBrowserTask(): Promise<boolean> {
  const stored = await chrome.storage.session.get(BROWSER_TASKS_KEY);
  const tasks = Array.isArray(stored[BROWSER_TASKS_KEY]) ? stored[BROWSER_TASKS_KEY] as unknown[] : [];
  const now = Date.now();
  return tasks.some((task) => {
    if (!task || typeof task !== "object") return false;
    const item = task as { finished?: unknown; canceled?: unknown; updatedAt?: unknown };
    return item.finished !== true &&
      item.canceled !== true &&
      typeof item.updatedAt === "number" &&
      now - item.updatedAt < ACTIVE_BROWSER_TASK_WINDOW_MS;
  });
}

function stopPorts(): void {
  for (const port of recorderPorts.values()) {
    try {
      port.postMessage({ type: "STOP" });
    } catch {
      // The page may already have closed the port.
    }
    try {
      port.disconnect();
    } catch {
      // The port is already disconnected.
    }
  }
  recorderPorts.clear();
}

async function rememberOrigin(originPattern: string): Promise<void> {
  const stored = await chrome.storage.local.get(TASK_ORIGINS_KEY);
  const current = Array.isArray(stored[TASK_ORIGINS_KEY]) ? stored[TASK_ORIGINS_KEY] as string[] : [];
  await chrome.storage.local.set({ [TASK_ORIGINS_KEY]: [...new Set([...current, originPattern])] });
}

function addStep(session: RecordingSession, step: StoredRecordingStep): void {
  const appended = appendRecordingStep(session.steps, step);
  session.steps = appended.steps;
  session.truncated = session.truncated || appended.truncated;
}

async function injectRecorder(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [0] },
    files: ["page-recorder.js"],
  });
}

async function followTab(session: RecordingSession, tabId: number): Promise<RecordingSession> {
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  const location = tab?.url ? publicLocation(tab.url) : null;
  if (!tab?.id || !tab.url || !location) {
    session.observedTabId = undefined;
    session.pendingOrigin = undefined;
    session.pendingOriginPattern = undefined;
    if (session.status !== "review") session.status = "recording";
    return session;
  }
  let originPattern = "";
  try {
    originPattern = originPatternForUrl(tab.url);
  } catch {
    session.observedTabId = undefined;
    return session;
  }
  const allowed = await hasRememberedControlAccess(originPattern);
  if (!allowed) {
    session.status = "needs-permission";
    session.pendingOrigin = location.origin;
    session.pendingOriginPattern = originPattern;
    session.observedTabId = undefined;
    stopPorts();
    return session;
  }
  const previousTabId = session.observedTabId;
  const hadLocation = Boolean(session.lastOrigin && session.lastPath);
  const samePlace = session.lastOrigin === location.origin && session.lastPath === location.path;
  if (!samePlace) {
    if (hadLocation && previousTabId !== undefined && previousTabId !== tab.id) {
      addStep(session, {
        id: crypto.randomUUID(),
        kind: "switch-tab",
        origin: location.origin,
        path: location.path,
        title: cleanPageLabel(tab.title ?? "", 120),
      });
    } else {
      addStep(session, {
        id: crypto.randomUUID(),
        kind: "navigate",
        origin: location.origin,
        path: location.path,
      });
    }
  }
  session.status = "recording";
  session.pendingOrigin = undefined;
  session.pendingOriginPattern = undefined;
  session.observedTabId = tab.id;
  session.lastOrigin = location.origin;
  session.lastPath = location.path;
  if (previousTabId !== undefined && previousTabId !== tab.id) {
    const previous = recorderPorts.get(previousTabId);
    if (previous) {
      try {
        previous.postMessage({ type: "STOP" });
        previous.disconnect();
      } catch {
        // The previous page is already gone.
      }
      recorderPorts.delete(previousTabId);
    }
  }
  await saveSession(session);
  await injectRecorder(tab.id);
  return session;
}

export function recordingBlocksBrowserWork(): Promise<boolean> {
  return enqueue(async () => (await loadSession()) !== null);
}

export function readSkillRecording(): Promise<RecordingView> {
  return enqueue(async () => viewFrom(await loadSession()));
}

export function startSkillRecording(description: string): Promise<RecordingView> {
  return enqueue(async () => {
    const cleaned = sanitizeSkillField(description, 500);
    if (!cleaned) throw new Error("Describe when this skill should be used.");
    if (await loadSession()) throw new Error("Finish or cancel the skill recording that is already open.");
    if (await activeBrowserTask()) throw new Error("Finish or stop the browser task before recording a skill.");
    const active = await focusedActiveTab();
    let session: RecordingSession = {
      status: "recording",
      nonce: crypto.randomUUID(),
      description: cleaned,
      name: suggestedSkillName(cleaned),
      notes: "",
      steps: [],
      truncated: false,
      updatedAt: Date.now(),
    };
    if (active?.id !== undefined) session = await followTab(session, active.id);
    await saveSession(session);
    return publish(session);
  });
}

export function stopSkillRecording(): Promise<RecordingView> {
  return enqueue(async () => {
    const session = await loadSession();
    if (!session || session.status === "review") throw new Error("There is no skill recording to stop.");
    session.status = "review";
    session.observedTabId = undefined;
    session.pendingOrigin = undefined;
    session.pendingOriginPattern = undefined;
    stopPorts();
    await saveSession(session);
    return publish(session);
  });
}

export function cancelSkillRecording(): Promise<RecordingView> {
  return enqueue(async () => {
    stopPorts();
    await saveSession(null);
    return publish(null);
  });
}

export function grantSkillRecording(originPattern: string, granted: boolean): Promise<RecordingView> {
  return enqueue(async () => {
    const session = await loadSession();
    if (!session || session.status !== "needs-permission") throw new Error("There is no site access request for this recording.");
    if (session.pendingOriginPattern !== originPattern) throw new Error("The page changed before access was granted.");
    if (!granted) return publish(session);
    const allowed = await chrome.permissions.contains({ origins: [originPattern] });
    if (!allowed) throw new Error("Chrome did not grant that site.");
    await rememberOrigin(originPattern);
    const active = await focusedActiveTab();
    const next = active?.id !== undefined ? await followTab(session, active.id) : session;
    await saveSession(next);
    return publish(next);
  });
}

export function updateSkillRecording(patch: {
  name?: string;
  description?: string;
  notes?: string;
  deleteStepId?: string;
  keepExample?: { stepId: string; keep: boolean };
}): Promise<RecordingView> {
  return enqueue(async () => {
    const session = await loadSession();
    if (!session || session.status !== "review") throw new Error("Stop recording before editing the skill.");
    if (patch.name !== undefined) session.name = sanitizeSkillField(patch.name, 100);
    if (patch.description !== undefined) session.description = sanitizeSkillField(patch.description, 500);
    if (patch.notes !== undefined) session.notes = patch.notes.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").slice(0, 4_000);
    if (patch.deleteStepId) session.steps = session.steps.filter((step) => step.id !== patch.deleteStepId);
    if (patch.keepExample) {
      session.steps = session.steps.map((step) =>
        step.kind === "fill" && step.id === patch.keepExample?.stepId
          ? { ...step, keepExample: patch.keepExample.keep }
          : step,
      );
    }
    await saveSession(session);
    return publish(session);
  });
}

export function saveSkillRecording(
  write: (markdown: string) => Promise<{ name: string }>,
): Promise<{ name: string }> {
  return enqueue(async () => {
    const session = await loadSession();
    if (!session || session.status !== "review") throw new Error("Review the recording before saving it.");
    if (!session.steps.some((step) => step.kind !== "skipped")) {
      throw new Error("No page actions were captured. Record the task while the recording frame is visible, then stop.");
    }
    const document = previewSkillDocument(session);
    if (!document.preview) throw new Error(document.previewError || "This recording cannot be saved.");
    const saved = await write(document.preview);
    stopPorts();
    await saveSession(null);
    publish(null);
    return saved;
  });
}

export async function forgetRecordingTab(tabId: number): Promise<void> {
  await enqueue(async () => {
    const session = await loadSession();
    if (!session || session.status === "review" || session.observedTabId !== tabId) return;
    session.observedTabId = undefined;
    await saveSession(session);
    publish(session);
  });
}

export function followRecordingActivation(tabId: number): void {
  void enqueue(async () => {
    const session = await loadSession();
    if (!session || session.status === "review") return;
    const next = await followTab(session, tabId);
    await saveSession(next);
    publish(next);
  });
}

export function noteRecordingNavigation(tabId: number, url: string | undefined): void {
  if (!url) return;
  void enqueue(async () => {
    const session = await loadSession();
    if (!session || session.status !== "recording") return;
    if (session.observedTabId !== undefined && session.observedTabId !== tabId) return;
    if (session.observedTabId === undefined) {
      const active = await focusedActiveTab();
      if (active?.id !== tabId) return;
    }
    const next = await followTab(session, tabId);
    await saveSession(next);
    publish(next);
  });
}

export function acceptRecorderPort(port: chrome.runtime.Port): void {
  if (port.name !== RECORDER_PORT_NAME) return;
  const sender = port.sender;
  const tabId = sender?.tab?.id;
  if (!sender || sender.id !== chrome.runtime.id || sender.frameId !== 0 || tabId === undefined) {
    port.disconnect();
    return;
  }
  void enqueue(async () => {
    const session = await loadSession();
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    const location = tab?.url ? publicLocation(tab.url) : null;
    let originPattern = "";
    try {
      originPattern = tab?.url ? originPatternForUrl(tab.url) : "";
    } catch {
      originPattern = "";
    }
    const senderOrigin = typeof sender.origin === "string" ? sender.origin : "";
    const allowed = originPattern ? await hasRememberedControlAccess(originPattern) : false;
    if (
      !session ||
      session.status !== "recording" ||
      session.observedTabId !== tabId ||
      !location ||
      !allowed ||
      (senderOrigin && senderOrigin !== location.origin)
    ) {
      port.disconnect();
      return;
    }
    const previous = recorderPorts.get(tabId);
    if (previous && previous !== port) {
      try {
        previous.disconnect();
      } catch {
        // The replaced port is already closed.
      }
    }
    recorderPorts.set(tabId, port);
    port.onDisconnect.addListener(() => {
      if (recorderPorts.get(tabId) === port) recorderPorts.delete(tabId);
    });
    port.onMessage.addListener((message: unknown) => {
      void enqueue(() => ingestRecorderStep(tabId, message));
    });
    try {
      port.postMessage({ type: "START", nonce: session.nonce });
    } catch {
      recorderPorts.delete(tabId);
    }
  });
}

async function ingestRecorderStep(tabId: number, message: unknown): Promise<void> {
  const parsed = recorderMessageSchema.safeParse(message);
  if (!parsed.success) return;
  const session = await loadSession();
  if (!session || session.status !== "recording" || session.nonce !== parsed.data.nonce || session.observedTabId !== tabId) return;
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  const location = tab?.url ? publicLocation(tab.url) : null;
  if (!location) return;
  if (session.lastOrigin && (session.lastOrigin !== location.origin || session.lastPath !== location.path)) {
    addStep(session, { id: crypto.randomUUID(), kind: "navigate", origin: location.origin, path: location.path });
    session.lastOrigin = location.origin;
    session.lastPath = location.path;
  }
  addStep(session, withRecorderLocation(parsed.data.step, location));
  await saveSession(session);
  publish(session);
}
