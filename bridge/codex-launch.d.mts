export function codexInvocation(options?: {
  platform?: string;
  env?: Record<string, string | undefined>;
  home?: string;
  existsSync?: (file: string) => boolean;
  readFileSync?: (file: string, encoding: "utf8") => string;
  execFileSync?: (command: string, args: string[], options: { encoding: "utf8"; windowsHide?: boolean }) => string;
  nodePath?: string;
}): { command: string; args: string[] };
