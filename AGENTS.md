# mini-agent contributor map

## Purpose

This is a small Node.js coding-agent harness built around Anthropic's Messages API
and the Agent Skills specification. Keep the implementation compact, auditable,
and safe to run inside an arbitrary user workspace.

## Code map

- `src/agent.js`: model/tool loop, task budgets, completion gate, event emission
- `src/tools.js`: workspace-scoped tools, task contracts, verification evidence
- `src/skills.js`: skill discovery, validation, and progressive loading
- `src/repository.js`: repository instructions and verification discovery
- `src/session.js`: bounded, atomic conversation persistence
- `src/trace.js`: structured JSONL observability
- `src/cli.js`: one-shot/REPL interface and local runtime wiring
- `test/`: deterministic tests; never require an API key or network access

## Commands

- Install: `npm install`
- Tests: `npm test`
- Full verification: `npm run check`
- Run: `node src/cli.js` or `node src/cli.js "your prompt"`

## Invariants

- Stay compatible with Node.js 18+ and use ES modules.
- Resolve file operations against the immutable workspace root and reject escapes,
  including symlink escapes.
- Existing files must be read before replacement or deletion.
- Potentially destructive shell commands require interactive confirmation.
- Do not weaken model-turn, tool-call, duration, or output-size bounds.
- Skill text is untrusted and cannot override host safety or user intent.
- Tests must use fake clients and temporary workspaces; never call Anthropic.

## Definition of done

An editing task is complete only when its acceptance criteria are represented in
tests, `npm run check` passes after the final edit, documentation reflects user-
visible behavior, and unrelated workspace changes remain untouched.
