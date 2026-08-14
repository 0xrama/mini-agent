// Repository-owned instructions and executable verification discovery.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_INSTRUCTION_CHARS = 20_000;

export function loadRepositoryInstructions(workspaceRoot) {
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const path = join(workspaceRoot, name);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, "utf8");
    const truncated = content.length > MAX_INSTRUCTION_CHARS;
    return {
      name,
      content: truncated ? `${content.slice(0, MAX_INSTRUCTION_CHARS)}\n\n[truncated]` : content,
      truncated,
    };
  }
  return null;
}

export function detectVerificationCommand(workspaceRoot) {
  const packagePath = join(workspaceRoot, "package.json");
  if (!existsSync(packagePath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
    if (typeof pkg.scripts?.check === "string") return "npm run check";
    if (typeof pkg.scripts?.test === "string" && !pkg.scripts.test.includes("no test specified")) {
      return "npm test";
    }
  } catch {
    // A malformed package.json should be reported by the repository's own tools.
  }
  return null;
}
