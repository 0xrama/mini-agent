import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTools } from "../src/tools.js";

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "mini-agent-"));
  writeFileSync(join(root, "sample.txt"), "alpha\nbeta\ngamma\n", "utf8");
  return root;
}

async function recordContract(tools) {
  return tools.execute("set_task_contract", {
    objective: "test the requested edit",
    acceptance_criteria: ["the expected file state is present"],
  });
}

test("read_file returns ranged line-numbered content", async (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tools = buildTools({ workspaceRoot: root });

  const output = await tools.execute("read_file", { path: "sample.txt", offset: 2, limit: 1 });

  assert.equal(output.isError, false);
  assert.match(output.content, /lines 2-2 of 4/);
  assert.match(output.content, /2: beta/);
});

test("apply_patch requires a read and rejects ambiguous replacements", async (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "repeat.txt"), "same\nsame\n", "utf8");
  const tools = buildTools({ workspaceRoot: root });

  const beforeRead = await tools.execute("apply_patch", {
    operation: "replace",
    path: "sample.txt",
    old_text: "beta",
    new_text: "delta",
  });
  assert.equal(beforeRead.isError, true);

  await recordContract(tools);
  await tools.execute("read_file", { path: "sample.txt" });
  const changed = await tools.execute("apply_patch", {
    operation: "replace",
    path: "sample.txt",
    old_text: "beta",
    new_text: "delta",
  });
  assert.equal(changed.isError, false);
  assert.match(readFileSync(join(root, "sample.txt"), "utf8"), /delta/);

  await tools.execute("read_file", { path: "repeat.txt" });
  const ambiguous = await tools.execute("apply_patch", {
    operation: "replace",
    path: "repeat.txt",
    old_text: "same",
    new_text: "different",
  });
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.content, /more than once/);
});

test("file tools reject paths outside the workspace", async (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tools = buildTools({ workspaceRoot: root });
  await recordContract(tools);

  const read = await tools.execute("read_file", { path: "/etc/hosts" });
  const write = await tools.execute("apply_patch", {
    operation: "create",
    path: "../escape.txt",
    new_text: "nope",
  });

  assert.equal(read.isError, true);
  assert.equal(write.isError, true);
});

test("apply_patch rejects symlinks that resolve outside the workspace", async (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  symlinkSync("/etc/hosts", join(root, "outside-link"));
  const tools = buildTools({ workspaceRoot: root });
  await recordContract(tools);

  const output = await tools.execute("apply_patch", {
    operation: "replace",
    path: "outside-link",
    old_text: "localhost",
    new_text: "changed",
  });

  assert.equal(output.isError, true);
  assert.match(output.content, /outside the workspace/);
});

test("bash uses the workspace and denied commands are errors", async (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tools = buildTools({ workspaceRoot: root, confirm: async () => false });

  const pwd = await tools.execute("bash", { command: "pwd" });
  assert.equal(pwd.content, realpathSync(root));

  const denied = await tools.execute("bash", { command: "rm -rf sample.txt" });
  assert.equal(denied.isError, true);
  assert.match(denied.content, /rejected/);
});

test("load_skill is omitted when no skills exist", () => {
  const root = workspace();
  try {
    const tools = buildTools({ workspaceRoot: root });
    assert.equal(tools.definitions.some((tool) => tool.name === "load_skill"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("task contracts and verification produce completion evidence", async (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const taskState = {};
  const tools = buildTools({
    workspaceRoot: root,
    verificationCommand: "test -f created.txt",
    taskState,
  });

  const contract = await tools.execute("set_task_contract", {
    objective: "create the requested file",
    acceptance_criteria: ["created.txt exists"],
  });
  const changed = await tools.execute("apply_patch", {
    operation: "create",
    path: "created.txt",
    new_text: "ready\n",
  });
  const verified = await tools.execute("verify", {});

  assert.equal(contract.isError, false);
  assert.equal(changed.isError, false);
  assert.equal(verified.isError, false);
  assert.equal(taskState.contract.objective, "create the requested file");
  assert.equal(taskState.mutationVersion, 1);
  assert.equal(taskState.verifiedMutationVersion, 1);
});

test("apply_patch mechanically rejects edits without a task contract", async (t) => {
  const root = workspace();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tools = buildTools({ workspaceRoot: root });

  const output = await tools.execute("apply_patch", {
    operation: "create",
    path: "unscoped.txt",
    new_text: "no\n",
  });

  assert.equal(output.isError, true);
  assert.match(output.content, /task contract/);
});
