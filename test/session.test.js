import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/session.js";

test("session checkpoints are bounded at complete user turns", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mini-agent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new SessionStore(join(root, "state", "session.json"), { maxChars: 180 });
  const messages = [
    { role: "user", content: "old request" },
    { role: "assistant", content: [{ type: "text", text: "x".repeat(200) }] },
    { role: "user", content: "recent request" },
    { role: "assistant", content: [{ type: "text", text: "recent answer" }] },
  ];

  store.save(messages);
  const loaded = store.load();

  assert.deepEqual(loaded, messages.slice(2));
});
