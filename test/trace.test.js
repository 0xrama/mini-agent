import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonlTracer } from "../src/trace.js";

test("JSONL tracer records machine-readable events", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mini-agent-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "nested", "trace.jsonl");
  const trace = createJsonlTracer(path);

  trace({ type: "run_started", run_id: "run-1" });
  trace({ type: "run_completed", run_id: "run-1", duration_ms: 12 });

  const events = readFileSync(path, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(events.map((event) => event.type), ["run_started", "run_completed"]);
});
