import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "../src/agent.js";

function response(content, stopReason = "end_turn") {
  return {
    on() {},
    async finalMessage() {
      return { content, stop_reason: stopReason };
    },
  };
}

test("failed turns roll conversation history back", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mini-agent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const client = {
    messages: {
      stream() {
        return {
          on() {},
          async finalMessage() {
            throw new Error("gateway unavailable");
          },
        };
      },
    },
  };
  const agent = new Agent({ client, workspaceRoot: root });
  await agent.init();

  await assert.rejects(agent.run("hello"), /gateway unavailable/);
  assert.deepEqual(agent.messages, []);
});

test("tool call budget stops loops and rolls history back", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mini-agent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const client = {
    messages: {
      stream() {
        return response(
          [{ type: "tool_use", id: "tool-1", name: "bash", input: { command: "pwd" } }],
          "tool_use"
        );
      },
    },
  };
  const agent = new Agent({ client, workspaceRoot: root, maxToolCalls: 0 });
  await agent.init();

  await assert.rejects(agent.run("loop"), /tool call limit/);
  assert.deepEqual(agent.messages, []);
});

test("tool errors are marked for Anthropic", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mini-agent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let turn = 0;
  let capturedMessages;
  const client = {
    messages: {
      stream(request) {
        capturedMessages = request.messages;
        turn += 1;
        if (turn === 1) {
          return response(
            [{ type: "tool_use", id: "tool-1", name: "read_file", input: { path: "missing.txt" } }],
            "tool_use"
          );
        }
        return response([{ type: "text", text: "handled" }]);
      },
    },
  };
  const agent = new Agent({ client, workspaceRoot: root });
  await agent.init();
  await agent.run("read missing");

  const resultMessage = capturedMessages.find(
    (message) => Array.isArray(message.content) && message.content[0]?.type === "tool_result"
  );
  assert.equal(resultMessage.content[0].is_error, true);
});

test("completion gate requires a contract and post-edit verification", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mini-agent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const events = [];
  let turn = 0;
  const turns = [
    response(
      [
        {
          type: "tool_use",
          id: "contract",
          name: "set_task_contract",
          input: { objective: "create output", acceptance_criteria: ["output exists"] },
        },
      ],
      "tool_use"
    ),
    response(
      [
        {
          type: "tool_use",
          id: "edit",
          name: "apply_patch",
          input: { operation: "create", path: "output.txt", new_text: "done\n" },
        },
      ],
      "tool_use"
    ),
    response([{ type: "text", text: "done" }]),
    response([{ type: "tool_use", id: "verify", name: "verify", input: {} }], "tool_use"),
    response([{ type: "text", text: "verified" }]),
  ];
  const client = { messages: { stream: () => turns[turn++] } };
  const agent = new Agent({
    client,
    workspaceRoot: root,
    verificationCommand: "test -f output.txt",
    onEvent: (event) => events.push(event),
  });
  await agent.init();

  await agent.run("create output.txt");

  assert.equal(readFileSync(join(root, "output.txt"), "utf8"), "done\n");
  assert.equal(turn, 5);
  assert.equal(events.some((event) => event.type === "completion_blocked"), true);
  assert.equal(events.some((event) => event.type === "task_contract_recorded"), true);
  assert.equal(events.some((event) => event.type === "verification_completed" && event.passed), true);
  assert.equal(events.at(-1).type, "run_completed");
  assert.equal(events.at(-1).verification_passed, true);
});

test("successful conversations resume from an atomic session checkpoint", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "mini-agent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sessionFile = join(root, ".mini-agent", "session.json");
  const client = { messages: { stream: () => response([{ type: "text", text: "hello" }]) } };
  const first = new Agent({ client, workspaceRoot: root, sessionFile, verificationCommand: null });
  await first.init();
  await first.run("hi");

  const second = new Agent({ client, workspaceRoot: root, sessionFile, verificationCommand: null });
  await second.init();

  assert.equal(second.messages.length, 2);
  assert.equal(second.messages[0].content, "hi");
  second.clear();
  assert.equal(existsSync(sessionFile), false);
});
