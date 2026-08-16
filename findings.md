# Findings: mini-agent

## What I built

I built `mini-agent` as a small Node.js coding-agent CLI around Anthropic's Messages API and the Agent Skills specification. I spent about five hours on the implementation and verification.

I wanted the project to stay small enough to understand end to end, while still being safe to run inside an existing repository. The core agent can inspect files, search, edit, run commands, load relevant skills, and verify its work. I focused most of my extra effort on the agent harness and on preventing unsafe or unverifiable edits.

The Agent Skills flow uses progressive disclosure:

1. I discover each skill's `name` and `description` from its frontmatter.
2. I give Claude only that metadata initially.
3. Claude decides whether a skill matches the user's request.
4. Claude calls `load_skill` to receive the full `SKILL.md` only when the skill is relevant.
5. Skill resources remain available for on-demand reads instead of being loaded eagerly.

This lets the agent use skills without putting every skill's full instructions into every conversation.

## How the implementation meets the assignment

I implemented the following assignment behaviors:

- A Node.js 18+ CLI using the Anthropic SDK.
- A configurable model through `MINI_AGENT_MODEL`, defaulting to `claude-sonnet-5`.
- Three bundled skills: `welcome-me`, `changelog-generator`, and `file-organizer`.
- Discovery of `.skills/<skill-name>/SKILL.md` files with YAML frontmatter parsing.
- Metadata-only disclosure before activation.
- Model-driven skill selection instead of a hardcoded keyword matcher.
- An enum-constrained `load_skill.name` argument so Claude can only request discovered skills.
- Activation deduplication within a session.
- Explicit skill activation through `/skill-name` in the REPL.
- On-demand access to `scripts/`, `references/`, and `assets/` directories.
- Skill-directory precedence, so workspace and user skills can shadow bundled skills.
- Omission of `load_skill` when no valid skills are available.

I kept the required welcome text inside `welcome-me/SKILL.md` rather than hardcoding it in the CLI. When Claude selects that skill, it receives the instruction and follows it. That makes the activation behavior observable and keeps the host implementation generic.

The relevant references I used were the [Agent Skills specification](https://agentskills.io/specification) and the [client implementation guide](https://agentskills.io/client-implementation/adding-skills-support).

## The main design challenge: progressive disclosure

The most important design decision for me was not to load every skill into the system prompt. It would have been simpler to concatenate all of the `SKILL.md` files, but that would defeat the point of the skills model and make unrelated requests carry unnecessary context.

I also decided not to implement host-side keyword matching. The host exposes a small catalog and lets Claude make the semantic relevance decision. The `load_skill` tool is the boundary that controls when the full instructions enter the conversation.

There are three useful consequences:

- A relevant request can receive detailed instructions.
- An unrelated request does not automatically activate a skill.
- A hallucinated skill name cannot be loaded because the tool schema is limited to discovered names.

The bundled `welcome-me` skill has a hard requirement for this header:

```text
> Welcome to our Command Code assignment agent!
```

I left that requirement in the skill file and did not add special-case output logic for it. The model should follow the selected skill, not a hidden rule in the application.

## The agent harness

I added a task contract before edits. Before the first mutation, Claude must record an objective, concrete acceptance criteria, and any exclusions with `set_task_contract`.

I also made completion evidence-based. Every successful `apply_patch` increments a mutation version. If the repository has a verifier, the agent cannot report completion until `verify` has passed after the latest mutation. This is enforced by the host loop rather than relying only on the system prompt.

The agent also:

- Reads `AGENTS.md` or `CLAUDE.md` before working.
- Detects `npm run check` or `npm test` as the repository-owned verification command.
- Rolls back failed turns instead of persisting partial conversation state.
- Persists successful sessions atomically and within a size limit.
- Writes structured JSONL events for runs, model turns, tool calls, contracts, verification, and failures.
- Enforces model-turn, tool-call, duration, and output limits.

I added these controls because a coding agent should not be considered successful merely because it says that a change is complete. It should leave behind a contract and verification evidence.

## Safety decisions

I kept routine file operations behind narrow tools instead of making Bash the only interface. The tools:

- Return bounded, line-numbered file reads.
- Search only within the workspace.
- Require an existing file to be read before replacement or deletion.
- Require replacement text to match exactly once.
- Reject workspace escapes and symlink escapes.
- Require confirmation for known destructive shell commands in the interactive REPL.
- Reject those commands in one-shot mode when confirmation is unavailable.

Bash is still available for tests, builds, git inspection, and commands that do not fit the dedicated tools. I instruct the model to use `apply_patch` for file changes so mutations remain visible to the host and to the trace.

I also treat repository instructions and skill text as untrusted guidance. They can describe project conventions, but they cannot override the user's request, workspace boundaries, or host safety rules.

## Testing and verification

I ran the final local check with:

```sh
npm run check
```

The result was:

```text
18 tests
18 passed
0 failed
```

The tests cover the agent loop, failed-turn rollback, budgets, session persistence, repository instruction discovery, skill precedence and validation, ranged reads, read-before-write behavior, ambiguous replacements, workspace and symlink escapes, destructive-command denial, completion evidence, and JSONL tracing.

I also ran `./init.sh`, which performs a clean `npm ci` followed by the same verification command.

Separately, I ran three live Claude smoke tests because the deterministic suite intentionally never uses an API key:

| Prompt | Result |
| --- | --- |
| `I'm new to this project, what should I do?` | `welcome-me` loaded and its required header appeared. |
| `what's the weather?` | `welcome-me` was not loaded; the agent answered directly. |
| `Create result.txt containing exactly harness-ok followed by a newline. Do not modify any other file.` | The agent recorded a contract, made the edit, passed repository verification, and completed. |

I consider these smoke tests useful evidence of the live integration, but I do not treat them as a replacement for the offline suite.

## Tradeoffs and limitations

I made a few deliberate tradeoffs:

- Skill selection is semantic and model-driven, so it can vary across wording and model versions.
- The permanent tests use fake clients so they remain fast, deterministic, and free of network dependencies.
- Bash is an escape hatch. I restrict known destructive patterns and direct the model not to edit through Bash, but I cannot prove that every arbitrary shell command is mutation-free.
- Persisted sessions can contain prompts and file excerpts. They are local, git-ignored, and permission-restricted, but I would use `--no-persist` for sensitive work.
- I added more reliability infrastructure than the minimum assignment required. I kept the implementation compact and documented the skill lifecycle first so the extra harness does not obscure the main exercise.

## Reviewer walkthrough

From the checkout, I would verify the project with:

```sh
npm install
npm run check
```

With an API key configured, these prompts exercise the important paths:

```sh
node src/cli.js "I'm new to this project, what should I do?"
node src/cli.js "what's the weather?"
node src/cli.js "Create a changelog from this week's commits"
```

The first prompt should activate `welcome-me`. The second should not. The third exercises the same catalog → selection → activation flow with another skill.

## What I would improve next

If I had more time, I would add deterministic tests around the exact positive and negative skill-selection flows without making the test suite depend on a live model. I would also add a small attribution note for the bundled community skills and a dedicated integration-test mode that can be run manually when credentials are available.
