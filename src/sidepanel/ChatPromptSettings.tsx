import { useEffect, useState } from "react";
import { chatSettingsSchema, DEFAULT_CHAT_SYSTEM_PROMPT, MAX_CHAT_SYSTEM_PROMPT, type ChatSettings } from "../shared/chat-settings";

interface Props {
  disabled: boolean;
  request: (message: Record<string, unknown>) => Promise<ChatSettings>;
}

export default function ChatPromptSettings({ disabled, request }: Props) {
  const [draft, setDraft] = useState(DEFAULT_CHAT_SYSTEM_PROMPT);
  const [saved, setSaved] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void request({ type: "CHAT_SETTINGS_READ" }).then((result) => {
      const settings = chatSettingsSchema.parse(result);
      if (current) { setDraft(settings.systemPrompt); setSaved(settings.systemPrompt); }
    }).catch(() => {
      if (current) setError("Unable to load the main system prompt. Update or reconnect the companion, then reopen Settings.");
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [request]);

  const save = async (systemPrompt: string) => {
    setError(null); setNotice(null);
    const parsed = chatSettingsSchema.safeParse({ version: 1, systemPrompt });
    if (!parsed.success) {
      setError(`Enter a non-empty main system prompt of at most ${MAX_CHAT_SYSTEM_PROMPT.toLocaleString()} characters, without null characters.`);
      return;
    }
    setSaving(true);
    try {
      const settings = chatSettingsSchema.parse(await request({ type: "CHAT_SETTINGS_WRITE", settings: parsed.data }));
      setDraft(settings.systemPrompt); setSaved(settings.systemPrompt);
      setNotice("Main system prompt saved. Start a new chat to use it.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save the main system prompt."); }
    finally { setSaving(false); }
  };

  const busy = disabled || loading || saving;
  return <details className="prompt-settings">
    <summary>Main chat system prompt</summary>
    <label>
      Main system prompt
      <textarea className="system-prompt" rows={8} maxLength={MAX_CHAT_SYSTEM_PROMPT} spellCheck={false} value={draft} disabled={busy} onChange={(event) => {
        setDraft(event.target.value); setError(null); setNotice(null);
      }} />
    </label>
    <p className="menu-hint">{draft.length.toLocaleString()} / {MAX_CHAT_SYSTEM_PROMPT.toLocaleString()} characters. Applies to new chats and forks. Existing chats keep their original prompt. Browser permissions and tool restrictions still apply.</p>
    <div className="prompt-settings-actions">
      <button type="button" disabled={busy || saved === null || draft === saved} onClick={() => void save(draft)}>Save main prompt</button>
      <button type="button" disabled={busy || (draft === DEFAULT_CHAT_SYSTEM_PROMPT && saved === DEFAULT_CHAT_SYSTEM_PROMPT)} onClick={() => void save(DEFAULT_CHAT_SYSTEM_PROMPT)}>Reset main prompt to default</button>
    </div>
    {error && <p className="menu-hint prompt-settings-error" role="alert">{error}</p>}
    {notice && <p className="menu-hint" role="status">{notice}</p>}
  </details>;
}
