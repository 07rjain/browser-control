// Match authentication failures from Codex, never assistant or page content.
// Network/workspace/companion failures need their own recovery paths.
export function requiresSignIn(message: string | null | undefined): boolean {
  return /\brefresh_token_(?:revoked|expired|reused|invalidated)\b/i.test(message ?? "") ||
    /\brefresh token\b[^\n]*(?:revoked|expired|already been used|invalidated)/i.test(message ?? "") ||
    /\b(?:access|authentication) token\b[^\n]*expired[^\n]*sign(?:ed|ing)?[ -]?in again/i.test(message ?? "");
}
