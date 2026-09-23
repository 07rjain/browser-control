import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const MAX_SKILL_NAME_CHARS = 100;
export const MAX_SKILL_DESCRIPTION_CHARS = 500;
export const MAX_SKILL_FILE_CHARS = 24_000;
export const MAX_CATALOG_SKILLS = 40;
const CATALOG_CHAR_BUDGET = 8_000;
const MAX_SKILL_DEPTH = 6;

export function skillsDirectory(sidebarHome) {
  return join(sidebarHome, "skills");
}

function isInside(root, target) {
  const fromRoot = relative(root, target);
  return fromRoot === "" || (fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot));
}

function singleLine(value) {
  return value.replace(/\s+/g, " ").trim();
}

export function parseSkillDocument(text) {
  if (!text.startsWith("---")) return null;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return null;
  const fields = {};
  for (const line of text.slice(3, end).split("\n")) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    fields[match[1]] = singleLine(value);
  }
  const name = fields.name ?? "";
  const description = fields.description ?? "";
  if (!name || name.length > MAX_SKILL_NAME_CHARS || /[\\/\0]/.test(name)) return { error: "Skill name is missing, too long, or contains a path separator." };
  if (!description || description.length > MAX_SKILL_DESCRIPTION_CHARS) return { error: "Skill description is missing or too long." };
  return { name, description };
}

function walkSkills(directory, root, depth, skills, errors) {
  if (depth > MAX_SKILL_DEPTH) return;
  let entries = [];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      walkSkills(full, root, depth + 1, skills, errors);
      continue;
    }
    if (entry.name !== "SKILL.md" || !entry.isFile()) continue;
    try {
      if (lstatSync(full).isSymbolicLink()) continue;
      const real = realpathSync(full);
      if (!isInside(root, real)) {
        errors.push({ path: full, message: "Skill path escapes the sidebar skills directory." });
        continue;
      }
      const parsed = parseSkillDocument(readFileSync(real, "utf8"));
      if (!parsed || parsed.error) {
        errors.push({ path: real, message: parsed?.error ?? "SKILL.md is missing YAML frontmatter." });
        continue;
      }
      skills.push({
        name: parsed.name,
        description: parsed.description,
        path: real,
        directory: dirname(real),
        enabled: true,
      });
    } catch (error) {
      errors.push({ path: full, message: error instanceof Error ? error.message : "Unable to read SKILL.md." });
    }
  }
}

export function discoverSkillsOnDisk(root) {
  const skills = [];
  const errors = [];
  let rootReal;
  try {
    rootReal = realpathSync(root);
  } catch {
    return { skills, errors };
  }
  if (!lstatSync(rootReal).isDirectory()) return { skills, errors };
  walkSkills(rootReal, rootReal, 0, skills, errors);
  skills.sort((left, right) => left.name.localeCompare(right.name) || left.path.localeCompare(right.path));
  return { skills, errors };
}

export function mergeSkillEnablement(skills, remoteEntries) {
  const disabledNames = new Set();
  const disabledPaths = new Set();
  for (const entry of remoteEntries) {
    if (!entry || entry.enabled !== false || typeof entry.name !== "string") continue;
    if (typeof entry.path === "string" && entry.path) disabledPaths.add(entry.path);
    else disabledNames.add(entry.name);
  }
  return skills.map((skill) => ({
    ...skill,
    enabled: !disabledPaths.has(skill.path) && !disabledNames.has(skill.name),
  }));
}

export function remoteSkillEntries(result) {
  const groups = Array.isArray(result?.data) ? result.data : [];
  const entries = [];
  for (const group of groups) {
    const skills = Array.isArray(group?.skills) ? group.skills : [];
    for (const skill of skills) {
      if (!skill || typeof skill.name !== "string") continue;
      entries.push({
        name: skill.name,
        enabled: skill.enabled !== false,
        ...(typeof skill.path === "string" ? { path: skill.path } : {}),
      });
    }
  }
  return entries;
}

function catalogLines(skills, descriptionLimit) {
  return skills.map((skill) => {
    const description = descriptionLimit === undefined ? skill.description : skill.description.slice(0, descriptionLimit);
    return `- ${skill.name}: ${description}`;
  });
}

export function renderSkillCatalog(enabledSkills) {
  const intro = [
    "## Skills",
    "A taught Browser Control skill is a local procedure in SKILL.md. Use a skill when the user names it or the task clearly matches its description. Do not ask the user to confirm skill selection.",
    "Call skills.read with the skill name and follow the returned instructions before browser actions. Demonstrated values are examples; use the current request for new titles, dates, and recipients.",
    "skills.read is limited to taught skills in this sidebar. Do not open local files, and do not use skills from any other Codex home.",
    "Permission mode, Stop, and hard refusals still apply after a skill is selected.",
  ];
  if (enabledSkills.length === 0) {
    const text = `${intro.join("\n")}\nNo taught skills are available.\n`;
    return { text, hash: hashCatalog(text) };
  }
  const visible = enabledSkills.slice(0, MAX_CATALOG_SKILLS);
  const omitted = enabledSkills.length - visible.length;
  let descriptions = catalogLines(visible);
  let body = [...intro, "### Available skills", ...descriptions];
  if (omitted > 0) body.push(`${omitted} more skills were omitted from this list.`);
  if (body.join("\n").length > CATALOG_CHAR_BUDGET) {
    descriptions = catalogLines(visible, 160);
    body = [...intro, "### Available skills", ...descriptions, "Some descriptions were shortened to fit the skills list."];
  }
  const text = `${body.join("\n")}\n`;
  return { text, hash: hashCatalog(text) };
}

function hashCatalog(text) {
  return createHash("sha256").update(text).digest("hex");
}

function findNamedSkill(skills, name) {
  const requested = singleLine(typeof name === "string" ? name : "").slice(0, MAX_SKILL_NAME_CHARS);
  if (!requested) throw new Error("A skill name is required.");
  const matches = skills.filter((skill) => skill.name === requested);
  if (matches.length === 0) throw new Error(`No taught skill is named ${requested}.`);
  if (matches.length > 1) throw new Error(`More than one taught skill is named ${requested}.`);
  return matches[0];
}

export function readSkillInstructions(skills, name, relativePath = "SKILL.md") {
  const skill = findNamedSkill(skills, name);
  if (!skill.enabled) throw new Error(`The skill ${skill.name} is disabled.`);
  return readSkillFile(skill, relativePath);
}

function skillDirectorySlug(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  if (!slug) throw new Error("The skill name cannot be used as a folder.");
  return slug;
}

export function writeNamedSkill(root, markdown) {
  if (typeof markdown !== "string" || markdown.length === 0) throw new Error("A skill document is required.");
  if (markdown.length > MAX_SKILL_FILE_CHARS) throw new Error("That skill is too long to save.");
  const parsed = parseSkillDocument(markdown);
  if (!parsed || parsed.error) throw new Error(parsed?.error ?? "SKILL.md is missing YAML frontmatter.");
  const slug = skillDirectorySlug(parsed.name);
  if (existsSync(root) && lstatSync(root).isSymbolicLink()) {
    throw new Error("Refusing to write through a symlinked skills directory.");
  }
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (lstatSync(root).isSymbolicLink()) throw new Error("Refusing to write through a symlinked skills directory.");
  const rootReal = realpathSync(root);
  if (!lstatSync(rootReal).isDirectory()) throw new Error("The sidebar skills directory is not available.");
  if (discoverSkillsOnDisk(rootReal).skills.some((skill) => skill.name === parsed.name)) {
    throw new Error(`A taught skill is already named ${parsed.name}.`);
  }
  const directory = join(rootReal, slug);
  if (existsSync(directory)) throw new Error("A skill folder with that name already exists.");
  mkdirSync(directory, { mode: 0o700 });
  const directoryReal = realpathSync(directory);
  if (!isInside(rootReal, directoryReal) || directoryReal === rootReal) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error("Refusing to create a skill outside the sidebar skills directory.");
  }
  const tempPath = join(directoryReal, `.skill-draft-${process.pid}`);
  const finalPath = join(directoryReal, "SKILL.md");
  try {
    writeFileSync(tempPath, markdown.endsWith("\n") ? markdown : `${markdown}\n`, { mode: 0o600, flag: "wx" });
    renameSync(tempPath, finalPath);
    const confirmed = parseSkillDocument(readFileSync(finalPath, "utf8"));
    if (!confirmed || confirmed.error || confirmed.name !== parsed.name || confirmed.description !== parsed.description) {
      throw new Error("The saved skill could not be read back.");
    }
    return { name: confirmed.name, description: confirmed.description };
  } catch (error) {
    rmSync(directoryReal, { recursive: true, force: true });
    throw error;
  }
}

export function deleteNamedSkill(root, name) {
  const { skills } = discoverSkillsOnDisk(root);
  const skill = findNamedSkill(skills, name);
  let rootReal;
  try {
    rootReal = realpathSync(root);
  } catch {
    throw new Error("The sidebar skills directory is not available.");
  }
  const directory = realpathSync(skill.directory);
  if (!isInside(rootReal, directory) || directory === rootReal) {
    throw new Error("Refusing to delete a skill outside its own directory.");
  }
  if (lstatSync(skill.directory).isSymbolicLink()) throw new Error("Refusing to delete a symlinked skill directory.");
  rmSync(directory, { recursive: true, force: false });
  return { name: skill.name };
}

function assertNoSymlink(root, target) {
  const fromRoot = relative(root, target);
  if (fromRoot === "") return;
  let current = root;
  for (const part of fromRoot.split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error("Skill files cannot be read through a symlink.");
  }
}

export function readSkillFile(skill, relativePath = "SKILL.md") {
  const requested = singleLine(typeof relativePath === "string" ? relativePath : "").slice(0, 200);
  const parts = requested.split("/").filter((part) => part.length > 0);
  if (parts.length === 0 || parts.some((part) => part === "." || part === ".." || part.startsWith("."))) {
    throw new Error("That skill file path is not allowed.");
  }
  const skillRoot = realpathSync(skill.directory);
  const candidate = resolve(skillRoot, ...parts);
  if (!isInside(skillRoot, candidate)) throw new Error("That skill file is outside the skill directory.");
  assertNoSymlink(skillRoot, candidate);
  const info = lstatSync(candidate);
  if (!info.isFile()) throw new Error("That skill path is not a file.");
  const real = realpathSync(candidate);
  if (!isInside(skillRoot, real)) throw new Error("That skill file is outside the skill directory.");
  const text = readFileSync(real, "utf8");
  if (text.length <= MAX_SKILL_FILE_CHARS) return text;
  return `${text.slice(0, MAX_SKILL_FILE_CHARS)}\n\n[Skill file truncated]`;
}
