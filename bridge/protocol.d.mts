export class LengthPrefixedJsonDecoder {
  constructor(maxBytes?: number);
  push(chunk: Buffer): unknown[];
}

export class JsonLineDecoder {
  push(chunk: Buffer): unknown[];
}

export function encodeNativeMessage(message: unknown): Buffer;

export function normalizeAppServerNotification(message: {
  method: string;
  params?: unknown;
}): { event: string; data: unknown } | null;

export function isAllowedDynamicTool(namespace: unknown, tool: unknown): boolean;
