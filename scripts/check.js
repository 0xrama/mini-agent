#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const sourceFiles = readdirSync(join(root, "src"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => join("src", name));

for (const file of sourceFiles) {
  const checked = spawnSync(process.execPath, ["--check", file], { cwd: root, stdio: "inherit" });
  if (checked.status !== 0) process.exit(checked.status ?? 1);
}

const tested = spawnSync(process.execPath, ["--test"], { cwd: root, stdio: "inherit" });
process.exit(tested.status ?? 1);
