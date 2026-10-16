import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("./chat-config.json", import.meta.url), "utf8"));

function validate(value) {
  if (value?.version !== 1 || typeof value.systemPrompt !== "string" || !value.systemPrompt.trim() || value.systemPrompt.length > config.maxSystemPromptChars || value.systemPrompt.includes("\0")) {
    throw new Error(`Enter a non-empty main system prompt of at most ${config.maxSystemPromptChars.toLocaleString()} characters, without null characters.`);
  }
  return { version: 1, systemPrompt: value.systemPrompt };
}

export function createChatSettingsStore(path) {
  function checkPath() {
    if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile())) throw new Error("Invalid chat settings file.");
  }
  return {
    read() {
      checkPath();
      if (!existsSync(path)) return { version: 1, systemPrompt: config.systemPrompt };
      return validate(JSON.parse(readFileSync(path, "utf8")));
    },
    write(value) {
      const settings = validate(value);
      checkPath();
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, JSON.stringify(settings), { mode: 0o600, flag: "wx" });
        renameSync(temporary, path);
      } finally { rmSync(temporary, { force: true }); }
      return settings;
    },
  };
}
