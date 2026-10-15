export type AuthState = "checking" | "signed-out" | "authenticating" | "ready" | "offline" | "error";

export type SetupStepState = "done" | "current" | "attention" | "upcoming";

export interface SetupStep {
  id: "companion" | "sign-in" | "start";
  label: string;
  detail: string;
  state: SetupStepState;
}

export interface StarterTask {
  id: "summarize" | "tabs" | "find" | "checklist";
  title: string;
  detail: string;
  prompt: string;
}

export const STARTER_TASKS: readonly StarterTask[] = [
  {
    id: "summarize",
    title: "Summarize a page",
    detail: "Attach it, get the key points",
    prompt: "Summarize the page I attach in five bullets.",
  },
  {
    id: "tabs",
    title: "Organize my tabs",
    detail: "Group open tabs by topic",
    prompt: "List my open tabs and group them by topic.",
  },
  {
    id: "find",
    title: "Find on this site",
    detail: "Look through the working tab",
    prompt: "Look through this page and find the contact or pricing details.",
  },
  {
    id: "checklist",
    title: "Turn it into steps",
    detail: "A short checklist from the page",
    prompt: "Turn the page I attach into a short checklist of next steps.",
  },
];

export function setupSteps(authState: AuthState, companionMissing: boolean): SetupStep[] {
  const companionReachable = authState === "signed-out" || authState === "authenticating" || authState === "error";
  const companion: SetupStep = authState === "checking"
    ? { id: "companion", label: "Connect the companion", detail: "Looking for it on this computer…", state: "current" }
    : authState === "offline"
      ? {
        id: "companion",
        label: "Connect the companion",
        detail: companionMissing ? "Not installed in this browser yet" : "Not responding. Retry below",
        state: "attention",
      }
      : { id: "companion", label: "Companion connected", detail: "Codex runs locally on this computer", state: "done" };
  const signIn: SetupStep = {
    id: "sign-in",
    label: "Sign in with ChatGPT",
    detail: authState === "authenticating"
      ? "Finish in the browser tab we opened"
      : authState === "error"
        ? "Sign-in didn't start. Try again"
        : "Uses your ChatGPT plan through Codex",
    state: !companionReachable ? "upcoming" : authState === "error" ? "attention" : "current",
  };
  return [
    companion,
    signIn,
    { id: "start", label: "Start a task", detail: "Chat, attach a page, or hand off tab work", state: "upcoming" },
  ];
}

export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 18) return "Good afternoon";
  return "Good evening";
}
