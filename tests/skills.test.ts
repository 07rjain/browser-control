import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteNamedSkill,
  discoverSkillsOnDisk,
  parseSkillDocument,
  writeNamedSkill,
  mergeSkillEnablement,
  readSkillInstructions,
  remoteSkillEntries,
  renderSkillCatalog,
} from "../bridge/skills.mjs";

const roots: string[] = [];

function skillRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "sidebar-skills-"));
  roots.push(root);
  return root;
}

function writeSkill(root: string, directory: string, name: string, description: string, body = "Click Create, then fill the title.") {
  const folder = join(root, directory);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
  return folder;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("sidebar skill discovery", () => {
  it("reads name and description from skills under the sidebar home", () => {
    const root = skillRoot();
    writeSkill(root, "calendar-event", "calendar-event", "Add an event on Google Calendar");
    mkdirSync(join(root, ".system", "hidden"), { recursive: true });
    writeFileSync(join(root, ".system", "hidden", "SKILL.md"), "---\nname: hidden\ndescription: Should stay hidden\n---\n");

    const discovered = discoverSkillsOnDisk(root);
    expect(discovered.errors).toEqual([]);
    expect(discovered.skills).toMatchObject([
      { name: "calendar-event", description: "Add an event on Google Calendar", enabled: true },
    ]);
  });

  it("skips symlinked skills and files that escape the skills directory", () => {
    const root = skillRoot();
    const outside = skillRoot();
    writeSkill(outside, "outside", "outside-skill", "A skill stored somewhere else");
    symlinkSync(join(outside, "outside"), join(root, "linked"));

    const discovered = discoverSkillsOnDisk(root);
    expect(discovered.skills).toEqual([]);
  });

  it("hides a skill the App Server marks disabled and keeps the file", () => {
    const root = skillRoot();
    const folder = writeSkill(root, "calendar-event", "calendar-event", "Add an event on Google Calendar");
    const [skill] = discoverSkillsOnDisk(root).skills;
    const merged = mergeSkillEnablement([skill], remoteSkillEntries({
      data: [{ cwd: root, skills: [{ name: "calendar-event", description: skill.description, path: skill.path, enabled: false }] }],
    }));

    expect(merged[0].enabled).toBe(false);
    expect(renderSkillCatalog(merged.filter((item) => item.enabled)).text).toContain("No taught skills are available.");
    expect(folder).toBeTruthy();
  });

  it("does not disable a sidebar skill because another Codex home used the same name", () => {
    const root = skillRoot();
    writeSkill(root, "calendar-event", "calendar-event", "Add an event on Google Calendar");
    const [skill] = discoverSkillsOnDisk(root).skills;
    const merged = mergeSkillEnablement([skill], [
      { name: "calendar-event", enabled: false, path: "/Users/someone/.agents/skills/calendar-event/SKILL.md" },
    ]);

    expect(merged[0].enabled).toBe(true);
  });

  it("puts only the name and description in the model catalog", () => {
    const root = skillRoot();
    writeSkill(root, "calendar-event", "calendar-event", "Add an event on Google Calendar");
    const [skill] = discoverSkillsOnDisk(root).skills;
    const catalog = renderSkillCatalog([skill]);

    expect(catalog.text).toContain("- calendar-event: Add an event on Google Calendar");
    expect(catalog.text).toContain("skills.read");
    expect(catalog.text).not.toContain(skill.path);
    expect(catalog.hash).toHaveLength(64);
  });

  it("reads a skill file and refuses paths that leave the skill directory", () => {
    const root = skillRoot();
    writeSkill(root, "calendar-event", "calendar-event", "Add an event on Google Calendar", "Use the title from the request.");
    const skills = discoverSkillsOnDisk(root).skills;
    mkdirSync(join(root, "calendar-event", "references"), { recursive: true });
    writeFileSync(join(root, "calendar-event", "references", "notes.md"), "Week view first.");

    expect(readSkillInstructions(skills, "calendar-event")).toContain("Use the title from the request.");
    expect(readSkillInstructions(skills, "calendar-event", "references/notes.md")).toBe("Week view first.");
    expect(() => readSkillInstructions(skills, "calendar-event", "../calendar-event/SKILL.md")).toThrow(/not allowed/);
    expect(() => readSkillInstructions(skills, "missing")).toThrow(/No taught skill/);
  });

  it("writes one parser-checked skill and refuses a symlink, a duplicate, or an existing folder", () => {
    const root = skillRoot();
    const markdown = "---\nname: \"Reply tibo\"\ndescription: \"Draft replies from the current request.\"\n---\n\nFollow the steps.\n";
    expect(writeNamedSkill(root, markdown)).toEqual({
      name: "Reply tibo",
      description: "Draft replies from the current request.",
    });
    const discovered = discoverSkillsOnDisk(root);
    expect(discovered.skills.map((skill) => skill.name)).toEqual(["Reply tibo"]);
    expect(parseSkillDocument(readSkillInstructions(discovered.skills, "Reply tibo"))).toMatchObject({ name: "Reply tibo" });
    expect(() => writeNamedSkill(root, markdown)).toThrow(/already named/);

    const outside = skillRoot();
    const linkParent = skillRoot();
    symlinkSync(outside, join(linkParent, "linked-skills"));
    expect(() => writeNamedSkill(join(linkParent, "linked-skills"), markdown.replace("Reply tibo", "Other skill"))).toThrow(/symlink/);
  });

  it("deletes one skill directory and leaves the skills root in place", () => {
    const root = skillRoot();
    writeSkill(root, "calendar-event", "calendar-event", "Add an event on Google Calendar");
    writeSkill(root, "other", "other-task", "Do the other task");

    expect(deleteNamedSkill(root, "calendar-event")).toEqual({ name: "calendar-event" });
    expect(discoverSkillsOnDisk(root).skills.map((skill) => skill.name)).toEqual(["other-task"]);
  });
});
