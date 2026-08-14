// Skill discovery, validation, and loading per the Agent Skills spec and the
// official client-implementation guide (agentskills.io/client-implementation).
//
// Progressive disclosure:
//   1. Catalog (name + description) is discovered at startup for every skill.
//   2. The full SKILL.md body is loaded only when a skill is activated.
//   3. Bundled resources (scripts/, references/, assets/) are read on demand
//      by the agent via its regular file tools.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import matter from "gray-matter";

const NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Skill directory search scopes, highest precedence first. Later scopes are
 * shadowed by earlier ones when skill names collide.
 */
export function skillSearchDirs(cwd = process.cwd()) {
  return [
    join(cwd, ".skills"), // project-level, per the assignment layout
    join(cwd, ".agents", "skills"), // cross-client convention
    join(homedir(), ".agents", "skills"), // user-level, cross-client
  ];
}

/**
 * Validate a skill's frontmatter against the Agent Skills specification.
 * Returns { errors, warnings }. Errors mean the skill cannot be disclosed
 * (missing/unusable description, unparseable file). Everything else is a
 * warning: per the client guide, we warn but still load.
 */
export function validateSkill(dirName, frontmatter) {
  const errors = [];
  const warnings = [];
  const { name, description, compatibility, metadata } = frontmatter;

  if (typeof description !== "string" || description.trim().length === 0) {
    errors.push("missing required field: description");
  } else if (description.length > 1024) {
    warnings.push("description exceeds 1024 characters");
  }

  if (typeof name !== "string" || name.length === 0) {
    errors.push("missing required field: name");
  } else {
    if (name.length > 64) warnings.push("name exceeds 64 characters");
    if (!NAME_PATTERN.test(name))
      warnings.push(
        "name should be lowercase alphanumeric with single hyphens (no leading/trailing/consecutive hyphens)"
      );
    if (name !== dirName)
      warnings.push(`name "${name}" does not match directory name "${dirName}"`);
  }

  if (compatibility !== undefined) {
    if (typeof compatibility !== "string" || compatibility.length === 0 || compatibility.length > 500)
      warnings.push("compatibility should be a string of 1-500 characters");
  }

  if (metadata !== undefined) {
    const bad =
      typeof metadata !== "object" ||
      metadata === null ||
      Object.entries(metadata).some(([k, v]) => typeof k !== "string" || typeof v !== "string");
    if (bad) warnings.push("metadata should be a map of string keys to string values");
  }

  return { errors, warnings };
}

/**
 * Discover all skills across the given search dirs (tier 1 only: frontmatter
 * is parsed, bodies are not loaded). Earlier dirs win on name collisions.
 */
export function discoverSkills(searchDirs) {
  const skills = [];
  const diagnostics = [];
  const seen = new Set();

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;

    for (const entry of readdirSync(dir)) {
      const skillDir = join(dir, entry);
      const skillFile = join(skillDir, "SKILL.md");
      if (!statSync(skillDir).isDirectory() || !existsSync(skillFile)) continue;

      let parsed;
      try {
        parsed = matter(readFileSync(skillFile, "utf8"));
      } catch (err) {
        diagnostics.push(`${skillFile}: skipped, failed to parse (${err.message})`);
        continue;
      }

      const { errors, warnings } = validateSkill(entry, parsed.data);
      for (const w of warnings) diagnostics.push(`${skillFile}: ${w}`);
      if (errors.length > 0) {
        diagnostics.push(`${skillFile}: skipped, ${errors.join("; ")}`);
        continue;
      }

      const name = parsed.data.name;
      if (seen.has(name)) {
        diagnostics.push(`${skillFile}: skipped, "${name}" shadowed by a higher-precedence skill`);
        continue;
      }
      seen.add(name);

      skills.push({
        name,
        description: parsed.data.description.trim(),
        location: resolve(skillFile),
        dir: resolve(skillDir),
      });
    }
  }

  return { skills, diagnostics };
}

/**
 * Tier 2: load the full SKILL.md body for an activated skill, plus a listing
 * of bundled resource files (tier 3 stays on-demand).
 */
export function loadSkill(skill) {
  const { content } = matter(readFileSync(skill.location, "utf8"));

  const resources = [];
  for (const sub of ["scripts", "references", "assets"]) {
    const subDir = join(skill.dir, sub);
    if (existsSync(subDir) && statSync(subDir).isDirectory()) {
      for (const f of readdirSync(subDir)) resources.push(join(sub, f));
    }
  }

  return { name: skill.name, dir: skill.dir, body: content.trim(), resources };
}
