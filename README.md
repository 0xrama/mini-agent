# mini-agent

A small Node.js coding-agent CLI for working inside an existing repository. It uses Anthropic's Messages API and implements the [Agent Skills specification](https://agentskills.io/specification).

The design is intentionally plain: a short tool list, bounded model runs, exact file edits, and a verification gate. The agent does not commit or push changes on its own.

## Quick start

Requirements:

- Node.js 18+
- An Anthropic API key, or a compatible Anthropic Messages API gateway

```bash
npm install
cp .env.local.example .env.local
# Add ANTHROPIC_API_KEY to .env.local
npm run check
```

Start the interactive REPL from the repository you want to work on:

```bash
node /path/to/mini-agent/src/cli.js
```

Or run one task:

```bash
node /path/to/mini-agent/src/cli.js "Find the failing test and fix it"
```

For a clean install and local verification in one command:

```bash
./init.sh
```

## The Agent Skills implementation

Skills are discovered from `.skills/<name>/SKILL.md`. The agent uses progressive disclosure:

1. **Discover:** parse each skill's `name` and `description` frontmatter.
2. **Select:** give Claude only that catalog and let it decide whether a skill matches the request.
3. **Activate:** load the complete `SKILL.md` through the `load_skill` tool only after selection.
4. **Read resources:** list `scripts/`, `references/`, and `assets/`, but leave their contents for on-demand reads.

The matcher is not a keyword list in the host application. This matters for the negative case: making `welcome-me` available must not load it for an unrelated request such as `what's the weather?`.

The checkout includes three bundled skills:

| Skill | Intended use |
| --- | --- |
| `welcome-me` | Requests from users who are new or ask for a welcome message |
| `changelog-generator` | User-facing changelogs from git history |
| `file-organizer` | Planning and carrying out file-organization work |

The `load_skill` argument is constrained to the discovered skill names, and repeated activations are ignored. In the REPL, `/skill-name` can activate a skill explicitly.

The bundled `welcome-me` skill contains its own required header. That text is deliberately not hardcoded in the matching engine; it appears only after the skill is activated.

## Agent loop and safety

Before editing, the model records a task contract with an objective, acceptance criteria, and exclusions. The host then enforces the editing workflow:

- `read_file` provides bounded, line-numbered reads.
- `search` uses ripgrep within the workspace.
- `apply_patch` performs create, replace, and delete operations with exact matching.
- Existing files must be read before replacement or deletion.
- Paths are checked against the real workspace root, including symlink escapes.
- Potentially destructive shell commands require confirmation in the interactive REPL and are denied in one-shot mode.
- When the repository exposes `npm run check` or `npm test`, that command must pass after edits before completion.
- Model turns, tool calls, task duration, and tool output are bounded.

Successful conversations are checkpointed to `.mini-agent/session.json`. Task events are written as JSONL to `.mini-agent/task-trace.jsonl`. Both files are local, git-ignored, and created with restrictive permissions where supported. Use `--no-persist` or `--no-trace` when those behaviors are not wanted.

## Configuration

The CLI reads `.env.local` from this checkout and does not overwrite variables already exported in the environment.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | — | Required API credential |
| `ANTHROPIC_BASE_URL` | SDK default | Optional compatible API endpoint |
| `MINI_AGENT_MODEL` | `claude-sonnet-5` | Model passed to the SDK |
| `MINI_AGENT_MAX_TOKENS` | `16384` | Maximum streamed output tokens; values below `1024` use the default |

## REPL commands and options

- `/skills` — list discovered skills
- `/skill-name` — explicitly activate a skill, for example `/changelog-generator`
- `/clear` — clear the conversation and its persisted checkpoint
- `exit` or `quit` — leave the REPL

```bash
node src/cli.js --no-persist "Review the error handling"
node src/cli.js --no-trace "Run the tests"
node src/cli.js --session .tmp/review.json "Continue the review"
```

## Development

```bash
npm test       # deterministic tests; no API calls
npm run check  # syntax checks plus the test suite
```

The test suite uses fake model clients and temporary workspaces. It does not need an API key or network access.

The main implementation lives in:

- `src/cli.js` — REPL, one-shot mode, environment loading, and output
- `src/agent.js` — bounded streaming model/tool loop and completion gate
- `src/tools.js` — workspace-scoped tools and shell confirmation
- `src/skills.js` — discovery, validation, and progressive loading
- `src/repository.js` — repository instruction and verification discovery
- `src/session.js` — bounded atomic conversation persistence
- `src/trace.js` — JSONL task tracing
- `test/` — deterministic behavior and safety tests

## Known limits

Skill selection is an LLM decision, so it is not perfectly deterministic across every wording or model version. The deterministic suite uses fake clients; live runs still require credentials, network access, and model availability. Bash is intentionally an escape hatch, so the host strongly directs it not to edit files but cannot classify every possible shell mutation.
