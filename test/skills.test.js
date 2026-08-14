import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverSkills } from "../src/skills.js";

function writeSkill(root, dir, name, description) {
  const path = join(root, dir);
  mkdirSync(path, { recursive: true });
  writeFileSync(
    join(path, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n# Instructions\n`,
    "utf8"
  );
}

test("higher-precedence skill directories shadow later scopes", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mini-agent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, "project");
  const user = join(root, "user");
  writeSkill(project, "demo", "demo", "project description");
  writeSkill(user, "demo", "demo", "user description");

  const { skills, diagnostics } = discoverSkills([project, user]);

  assert.equal(skills.length, 1);
  assert.equal(skills[0].description, "project description");
  assert.equal(diagnostics.some((message) => message.includes("shadowed")), true);
});

test("missing descriptions are skipped", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mini-agent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const skill = join(root, "broken");
  mkdirSync(skill);
  writeFileSync(join(skill, "SKILL.md"), "---\nname: broken\n---\n", "utf8");

  const { skills, diagnostics } = discoverSkills([root]);

  assert.equal(skills.length, 0);
  assert.equal(diagnostics.some((message) => message.includes("missing required field: description")), true);
});
