# mini-agent

A mini coding agent as a Node.js CLI, implementing the [Agent Skills specification](https://agentskills.io/specification). Powered by Claude Sonnet.

## Architecture

```
mini-agent/
├── AGENTS.md                   # contributor map, constraints, verification contract
├── init.sh                     # reproducible install + full-check entry point
├── .skills/                    # bundled skills (welcome-me, changelog-generator, file-organizer)
└── src/
    ├── cli.js      # REPL / one-shot entry point, output rendering, /skill-name activation
    ├── agent.js    # bounded loop, completion gate, task lifecycle events
    ├── repository.js # repository instruction + verification command discovery
    ├── session.js  # bounded, atomic cross-session checkpoints
    ├── skills.js   # multi-scope discovery, spec validation, progressive-disclosure loading
    ├── trace.js    # structured JSONL observability
    └── tools.js    # read_file, search, apply_patch, bash, load_skill
```

## Reliability harness

The harness implements five controls aimed at reliable autonomous coding:

1. **Repository as system of record.** `AGENTS.md` (or `CLAUDE.md`) is loaded into
   the system context at startup. The strongest standard package script is discovered
   as the repository-owned verification command (`check`, then `test`).
2. **Task contracts.** Before editing, the model records an objective, concrete
   acceptance criteria, and explicit exclusions with `set_task_contract`.
3. **Evidence-gated completion.** Every `apply_patch` mutation advances a version.
   The agent cannot finish until `verify` passes after the latest version; an early
   completion attempt is rejected by the host loop, not merely discouraged by a prompt.
4. **Durable continuity.** Successful message history is atomically checkpointed to
   `.mini-agent/session.json`, capped at 200,000 characters and resumed on the next run.
   Failed turns roll back and are never checkpointed.
5. **Structured observability.** Runs, model turns, tool timings/errors, task contracts,
   completion blocks, and verification evidence are written as JSONL to
   `.mini-agent/task-trace.jsonl`. Trace failures never interrupt agent work.

Both local runtime files are mode `0600` where supported and `.mini-agent/` is ignored
by git.

Implements the [Agent Skills spec](https://agentskills.io/specification) following the
official [client-implementation guide](https://agentskills.io/client-implementation/adding-skills-support):

- **Tier 1 — catalog**: at startup, only `name` + `description` of each discovered skill
  goes into the system prompt. Omitted entirely when no skills exist.
- **Tier 2 — activation**: the model itself decides relevance (no harness-side keyword
  matching) and calls `load_skill`, whose `name` parameter is enum-constrained to real
  skills. Content arrives wrapped in `<skill>` tags with the skill directory and a list
  of bundled resources. Activations are deduplicated per session.
- **Tier 3 — resources**: `scripts/` / `references/` / `assets/` are listed, never eagerly
  loaded; the model reads them on demand via `read_file`.
- **Multi-scope discovery**: `<cwd>/.skills`, `<cwd>/.agents/skills`, `~/.agents/skills`,
  plus the bundled skills as fallback. Earlier scopes shadow later ones on name collisions,
  with diagnostics printed.
- **Lenient validation** per the guide: malformed name format/mismatched directory names
  warn-but-load; only missing name/description or unparseable files are skipped.
- **User-explicit activation**: `/skill-name` in the REPL injects the skill harness-side.

## Coding tools

- `read_file`: line-numbered, ranged reads with bounded output.
- `search`: structured ripgrep search with optional path, glob, and result limit.
- `apply_patch`: workspace-scoped create/replace/delete operations. Existing files must
  be read first and replacements must match exactly once, preventing stale edits.
- `bash`: explicit Bash execution from the immutable workspace root for git, tests,
  builds, and escape-hatch operations. Potentially destructive commands require approval.
- `set_task_contract`: records objective acceptance criteria and exclusions for edits.
- `verify`: runs the repository-owned full verification command; the model cannot replace
  it with an easier command.

Every path is resolved against the launch directory and checked after symlink
resolution. Tool failures are sent to Claude as `is_error` results. The agent also
enforces model-turn, tool-call, and wall-clock budgets, rolls conversation history
back after failed tasks, and runs independent read/search calls concurrently.

## Setup

```bash
npm install
cp .env.local.example .env.local   # then fill in your key
# Or perform a clean install and full local verification in one step:
./init.sh
```

`.env.local` holds `ANTHROPIC_API_KEY`, optionally `ANTHROPIC_BASE_URL`, and
optionally `MINI_AGENT_MODEL` and `MINI_AGENT_MAX_TOKENS`. The output default is
16,384 because source code inside tool calls counts against this limit. For the
Anthropic SDK through Requesty, the tested values are
`https://router.requesty.ai` and `vertex/claude-sonnet-5`.
Exported environment variables take precedence.

## Run

```bash
node src/cli.js                     # interactive REPL
node src/cli.js "your prompt here"  # one-shot
npm test                            # deterministic tests (no API calls)
npm run check                       # syntax check + all deterministic tests
```

In the REPL, `/skills` lists available skills, `/skill-name` explicitly activates
one, and `/clear` resets conversation history and deletes its persisted checkpoint.
Use `--no-persist` for an ephemeral session, `--session path/to/file.json` for a named
checkpoint, or `--no-trace` to disable the local JSONL audit trail.

## Example prompts

- `I'm new to this project, what should I do?` → activates `welcome-me`, prints the required welcome header.
- `what's the weather?` → no skill is loaded; answers directly.
- `create a changelog from this week's commits` → activates `changelog-generator`, uses git via bash.

## Time spent

Record your actual tracked total here before submission.

## Challenges

- The assignment email says the welcome header is `> Welcome to our agent!`, while
  the registry's `welcome-me` skill hard-requires
  `> Welcome to our Command Code assignment agent!`. Because the agent must follow
  the selected skill, the registry skill is bundled verbatim and its requirement wins.
- The interesting matching constraint is negative: unrelated prompts must not load
  `welcome-me`. The model sees only each skill's name and description, then decides
  semantically whether to call `load_skill`; there is no brittle keyword matcher.
- Keeping the agent small while making file edits reliable required a narrow tool set:
  specialized read/search/patch tools for routine work and Bash as the fallback.
- Requesty's documented Anthropic path returned 404 in this environment; its root
  base URL correctly exposed the Anthropic Messages API used by the SDK.
