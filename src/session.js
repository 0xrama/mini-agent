// Durable, bounded conversation checkpoints for cross-session continuity.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

const VERSION = 1;
const DEFAULT_MAX_CHARS = 200_000;

function messageSize(message) {
  return JSON.stringify(message).length;
}

function boundedMessages(messages, maxChars) {
  let size = 0;
  let start = messages.length;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    size += messageSize(messages[index]);
    if (size > maxChars) break;
    if (messages[index].role === "user" && typeof messages[index].content === "string") start = index;
  }
  return messages.slice(start);
}

function validMessages(value) {
  return (
    Array.isArray(value) &&
    value.every(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        (typeof message.content === "string" || Array.isArray(message.content))
    )
  );
}

export class SessionStore {
  constructor(path, { maxChars = DEFAULT_MAX_CHARS } = {}) {
    this.path = path;
    this.maxChars = maxChars;
  }

  load() {
    if (!existsSync(this.path)) return [];
    const saved = JSON.parse(readFileSync(this.path, "utf8"));
    if (saved.version !== VERSION || !validMessages(saved.messages)) {
      throw new Error(`invalid mini-agent session file: ${this.path}`);
    }
    return saved.messages;
  }

  save(messages) {
    mkdirSync(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp-${process.pid}-${randomUUID()}`;
    const payload = {
      version: VERSION,
      saved_at: new Date().toISOString(),
      messages: boundedMessages(messages, this.maxChars),
    };
    writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    renameSync(temporary, this.path);
  }

  clear() {
    if (existsSync(this.path)) unlinkSync(this.path);
  }
}
