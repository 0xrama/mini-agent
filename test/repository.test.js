import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectVerificationCommand, loadRepositoryInstructions } from "../src/repository.js";

test("repository instructions and strongest verification script are discovered", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mini-agent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "AGENTS.md"), "# Project rules\n\nRun the full check.\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node --test", check: "node scripts/check.js" } })
  );

  const instructions = loadRepositoryInstructions(root);

  assert.equal(instructions.name, "AGENTS.md");
  assert.match(instructions.content, /Project rules/);
  assert.equal(detectVerificationCommand(root), "npm run check");
});
