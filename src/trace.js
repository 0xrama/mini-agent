// Structured JSONL task traces: enough evidence to diagnose loops and failures.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function createJsonlTracer(path) {
  return (event) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  };
}
