export class LengthPrefixedJsonDecoder {
  #buffer = Buffer.alloc(0);
  #maxBytes;

  constructor(maxBytes = 1024 * 1024) {
    this.#maxBytes = maxBytes;
  }

  push(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    const messages = [];
    while (this.#buffer.length >= 4) {
      const length = this.#buffer.readUInt32LE(0);
      if (length > this.#maxBytes) throw new Error(`Native message exceeds ${this.#maxBytes} bytes.`);
      if (this.#buffer.length < length + 4) break;
      const payload = this.#buffer.subarray(4, length + 4).toString("utf8");
      this.#buffer = this.#buffer.subarray(length + 4);
      messages.push(JSON.parse(payload));
    }
    return messages;
  }
}

export class JsonLineDecoder {
  #buffer = "";

  push(chunk) {
    this.#buffer += chunk.toString("utf8");
    const messages = [];
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line) messages.push(JSON.parse(line));
    }
    return messages;
  }
}

export function encodeNativeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export function normalizeAppServerNotification(message) {
  switch (message.method) {
    case "account/updated":
      return { event: "auth.updated", data: message.params };
    case "account/login/completed":
      return { event: "auth.loginCompleted", data: message.params };
    case "item/agentMessage/delta":
      return { event: "chat.delta", data: message.params };
    case "item/completed":
      if (message.params?.item?.type === "agentMessage") {
        return { event: "chat.messageCompleted", data: message.params };
      }
      if (message.params?.item?.type === "dynamicToolCall") {
        return { event: "tool.completed", data: message.params };
      }
      return null;
    case "turn/completed":
      return { event: "chat.turnCompleted", data: message.params };
    case "error":
      return { event: "chat.error", data: message.params };
    case "warning":
      return { event: "bridge.warning", data: message.params };
    case "skills/changed":
      return { event: "skills.changed", data: message.params ?? {} };
    default:
      return null;
  }
}

const ALLOWED_DYNAMIC_TOOLS = {
  tabs: new Set(["list", "activate", "open", "reload", "group", "ungroup", "close"]),
  page: new Set(["inspect", "click", "fill", "select", "check", "drag", "keypress", "scroll", "history", "wait", "submit"]),
};

export function isAllowedDynamicTool(namespace, tool) {
  return (namespace === "tabs" || namespace === "page") && ALLOWED_DYNAMIC_TOOLS[namespace].has(tool);
}

export function isHostSkillTool(namespace, tool) {
  return namespace === "skills" && (tool === "read" || tool === "offer_recording");
}

// Codex built-in tools run inside the app-server, outside the dynamic-tool
// allowlist above, so they are switched off for every thread. Codex ignores
// unknown keys without failing; scripts/probe-codex-tools.mjs checks the tool
// list Codex actually sends to the model.
export const CODEX_THREAD_RESTRICTIONS = Object.freeze({
  environments: [],
  config: Object.freeze({
    web_search: "disabled",
    mcp_servers: {},
    "features.shell_tool": false,
    "features.unified_exec": false,
    "features.view_image": false,
    "features.image_generation": false,
    "features.goals": false,
    "features.multi_agent": false,
    "features.apps": false,
    "features.plugins": false,
    "features.remote_plugin": false,
    "features.browser_use": false,
    "features.browser_use_external": false,
    "features.in_app_browser": false,
    "features.computer_use": false,
    "features.tool_suggest": false,
    "features.hooks": false,
    "features.memories": false,
  }),
});

function tomlValue(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && Object.keys(value).length === 0) return "{}";
  throw new Error("Unsupported Codex config override value.");
}

// Thread-level config does not replace feature state a resumed thread was
// created with, so the same overrides also apply to the whole app-server.
export function codexConfigArgs(config = CODEX_THREAD_RESTRICTIONS.config) {
  return Object.entries(config).flatMap(([key, value]) => ["-c", `${key}=${tomlValue(value)}`]);
}
