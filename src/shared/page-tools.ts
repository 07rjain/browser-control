import { z } from "zod";

export const MAX_PAGE_ELEMENTS = 80;
export const PAGE_REF_TTL_MS = 30_000;
export const MAX_PAGE_WAIT_MS = 8_000;
export const DEFAULT_BROWSER_TASK_ACTION_LIMIT = 40;
export const MIN_BROWSER_TASK_ACTION_LIMIT = 5;
export const MAX_BROWSER_TASK_ACTION_LIMIT = 100;
export const BROWSER_TASK_ACTION_LIMIT_KEY = "codexSidebarBrowserTaskActionLimit";
export const browserTaskActionLimitSchema = z.number().int()
  .min(MIN_BROWSER_TASK_ACTION_LIMIT)
  .max(MAX_BROWSER_TASK_ACTION_LIMIT);

export function normalizeBrowserTaskActionLimit(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_BROWSER_TASK_ACTION_LIMIT;
  return Math.min(MAX_BROWSER_TASK_ACTION_LIMIT, Math.max(MIN_BROWSER_TASK_ACTION_LIMIT, Math.round(numeric)));
}

export const elementRefSchema = z
  .object({
    id: z.string().min(1).max(80),
    snapshotId: z.string().min(1).max(80),
    tabId: z.number().int().positive(),
    origin: z.string().url(),
  })
  .strict();

export type ElementRef = z.infer<typeof elementRefSchema>;

const idempotencySchema = z.object({ idempotencyKey: z.string().min(8).max(160) });

export const inspectArgumentsSchema = idempotencySchema.extend({}).strict();
export const clickArgumentsSchema = idempotencySchema.extend({ ref: elementRefSchema }).strict();
export const fillArgumentsSchema = idempotencySchema
  .extend({
    ref: elementRefSchema,
    value: z.string().max(20_000),
    mode: z.enum(["replace", "append", "clear"]).default("replace"),
  })
  .strict();
export const selectArgumentsSchema = idempotencySchema
  .extend({ ref: elementRefSchema, value: z.string().max(2_000) })
  .strict();
export const checkArgumentsSchema = idempotencySchema
  .extend({ ref: elementRefSchema, checked: z.boolean() })
  .strict();
export const dragArgumentsSchema = idempotencySchema
  .extend({ sourceRef: elementRefSchema, targetRef: elementRefSchema })
  .strict()
  .superRefine((value, context) => {
    if (
      value.sourceRef.tabId !== value.targetRef.tabId ||
      value.sourceRef.origin !== value.targetRef.origin ||
      value.sourceRef.snapshotId !== value.targetRef.snapshotId
    ) {
      context.addIssue({ code: "custom", message: "Drag source and target must come from the same page inspection." });
    }
  });
export const keypressArgumentsSchema = idempotencySchema
  .extend({
    ref: elementRefSchema,
    key: z.enum(["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]),
  })
  .strict();
export const scrollArgumentsSchema = idempotencySchema
  .extend({
    direction: z.enum(["up", "down", "top", "bottom", "element"]),
    amount: z.number().int().min(100).max(2_000).optional(),
    ref: elementRefSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.direction === "element" && !value.ref) {
      context.addIssue({ code: "custom", message: "Element scrolling requires a reference." });
    }
    if (value.direction !== "element" && value.ref) {
      context.addIssue({ code: "custom", message: "A reference is allowed only for element scrolling." });
    }
  });
export const historyArgumentsSchema = idempotencySchema
  .extend({ direction: z.enum(["back", "forward"]) })
  .strict();
export const waitArgumentsSchema = idempotencySchema
  .extend({ condition: z.literal("load"), timeoutMs: z.number().int().min(100).max(MAX_PAGE_WAIT_MS).default(4_000) })
  .strict();
export const submitArgumentsSchema = idempotencySchema.extend({ ref: elementRefSchema }).strict();

export const pageToolNameSchema = z.enum([
  "inspect",
  "click",
  "fill",
  "select",
  "check",
  "drag",
  "keypress",
  "scroll",
  "history",
  "wait",
  "submit",
]);

export type PageToolName = z.infer<typeof pageToolNameSchema>;

export const pageToolCallSchema = z
  .object({
    requestId: z.union([z.string(), z.number()]),
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    callId: z.string().min(1),
    namespace: z.literal("page"),
    tool: pageToolNameSchema,
    arguments: z.unknown(),
  })
  .strict();

export type PageToolCall = z.infer<typeof pageToolCallSchema>;

export type PageToolArguments =
  | z.infer<typeof inspectArgumentsSchema>
  | z.infer<typeof clickArgumentsSchema>
  | z.infer<typeof fillArgumentsSchema>
  | z.infer<typeof selectArgumentsSchema>
  | z.infer<typeof checkArgumentsSchema>
  | z.infer<typeof dragArgumentsSchema>
  | z.infer<typeof keypressArgumentsSchema>
  | z.infer<typeof scrollArgumentsSchema>
  | z.infer<typeof historyArgumentsSchema>
  | z.infer<typeof waitArgumentsSchema>
  | z.infer<typeof submitArgumentsSchema>;

export function parsePageToolArguments(call: PageToolCall): PageToolArguments {
  switch (call.tool) {
    case "inspect":
      return inspectArgumentsSchema.parse(call.arguments);
    case "click":
      return clickArgumentsSchema.parse(call.arguments);
    case "fill":
      return fillArgumentsSchema.parse(call.arguments);
    case "select":
      return selectArgumentsSchema.parse(call.arguments);
    case "check":
      return checkArgumentsSchema.parse(call.arguments);
    case "drag":
      return dragArgumentsSchema.parse(call.arguments);
    case "keypress":
      return keypressArgumentsSchema.parse(call.arguments);
    case "scroll":
      return scrollArgumentsSchema.parse(call.arguments);
    case "history":
      return historyArgumentsSchema.parse(call.arguments);
    case "wait":
      return waitArgumentsSchema.parse(call.arguments);
    case "submit":
      return submitArgumentsSchema.parse(call.arguments);
  }
}

export function originPatternForUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Browser control supports only http and https pages.");
  }
  return `${url.origin}/*`;
}

const blockedActionPattern = /\b(buy|checkout|pay|purchase|place order|confirm order|transfer|send money|bet|wager)\b/i;
const blockedUrlPattern = /\/(checkout|payment|purchase|order-confirmation)(?:\/|$|[?#])/i;

export function isBlockedConsequentialTarget(label: string, url?: string): boolean {
  return blockedActionPattern.test(label) || (url ? blockedUrlPattern.test(url) : false);
}
