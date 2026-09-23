export interface DiscoveredSkill {
  name: string;
  description: string;
  path: string;
  directory: string;
  enabled: boolean;
}

export interface RemoteSkillEntry {
  name: string;
  enabled: boolean;
  path?: string;
}

export function skillsDirectory(sidebarHome: string): string;

export function parseSkillDocument(text: string): { name: string; description: string } | { error: string } | null;

export function discoverSkillsOnDisk(root: string): {
  skills: DiscoveredSkill[];
  errors: Array<{ path: string; message: string }>;
};

export function mergeSkillEnablement(skills: DiscoveredSkill[], remoteEntries: RemoteSkillEntry[]): DiscoveredSkill[];

export function remoteSkillEntries(result: { data?: Array<{ cwd?: string; skills?: unknown[] }> } | null | undefined): RemoteSkillEntry[];

export function renderSkillCatalog(enabledSkills: DiscoveredSkill[]): { text: string; hash: string };

export function readSkillInstructions(skills: DiscoveredSkill[], name: string, relativePath?: string): string;

export function writeNamedSkill(root: string, markdown: string): { name: string; description: string };

export function deleteNamedSkill(root: string, name: string): { name: string };

export function readSkillFile(skill: DiscoveredSkill, relativePath?: string): string;
