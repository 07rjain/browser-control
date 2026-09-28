export interface FileManifestTarget {
  kind: "file";
  path: string;
}

export interface RegistryManifestTarget {
  kind: "registry";
  key: string;
  path: string;
}

export interface CompanionLayout {
  platform: string;
  applicationRoot: string;
  runtimeDir: string;
  launcherPath: string;
  sidebarHome: string;
  browsers: string;
  manifestTargets: Array<FileManifestTarget | RegistryManifestTarget>;
}

export function companionLayout(
  platform: string,
  home: string,
  env?: Record<string, string | undefined>,
  version?: string,
): CompanionLayout;

export function nativeMessagingManifest(launcherPath: string): string;

export function posixLauncherScript(input: {
  nodePath: string;
  nodeDir: string;
  hostScript: string;
  codexPath: string;
  sidebarHome: string;
}): string;

export function windowsLauncherSource(input: {
  nodePath: string;
  hostScript: string;
  codexPath: string;
  sidebarHome: string;
}): string;

export function resolveCodexBinary(input: {
  platform: string;
  env?: Record<string, string | undefined>;
  execFileSync: (file: string, args: string[], options: { encoding: "utf8" }) => string;
  realpathSync: (value: string) => string;
  statSync: (value: string) => { isFile: () => boolean; mode: number };
}): string;

export function chromeLikePath(platform: string, env?: Record<string, string | undefined>): string;
