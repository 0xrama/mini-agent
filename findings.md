# Findings: mini-agent

## Executive summary

`mini-agent` satisfies the core technical shape of the take-home assignment: it is a
Node.js CLI powered by Claude Sonnet, discovers three local Agent Skills, exposes only
their metadata initially, lets Claude select a relevant skill, and loads the complete
`SKILL.md` only after selection.

The agent runs well in practice. Its deterministic suite passes 18 of 18 tests, its
clean initialization path succeeds, and a live Claude smoke test completed a scoped
file-editing task through the full contract -> edit -> verification -> completion loop.
The two assignment-critical live prompts also behaved correctly at the selection
level: the onboarding prompt loaded `welcome-me`, while the unrelated weather prompt
did not.

The implementation goes beyond the minimum assignment without replacing its central
idea. Skill matching remains model-driven and easy to inspect; the additional harness
features make edits safer, completion evidence-based, sessions recoverable, and failures
diagnosable.

## Assignment fit

### Required behavior implemented

- The program is a Node.js command-line application using the Anthropic SDK.
- Claude Sonnet is configurable through `MINI_AGENT_MODEL` and defaults to
  `claude-sonnet-5`.
- Three bundled skills are present:
  - `welcome-me`
  - `changelog-generator`
  - `file-organizer`
- `changelog-generator` and `file-organizer` are existing registry/community skills.
- Skills use the required directory layout: `.skills/<skill-name>/SKILL.md`.
- `SKILL.md` YAML frontmatter is parsed and validated.
- Only skill `name` and `description` are placed in the initial model context.
- Claude decides whether a catalog entry matches the user's request.
- A dedicated `load_skill` tool loads the full instructions after selection.
- The tool's `name` argument is enum-constrained to discovered skills, preventing
  hallucinated skill names.
- When no skills exist, neither an empty catalog nor an unusable `load_skill` tool is
  registered.
- Skill activations are deduplicated during a session.
- Users can also activate a skill explicitly with `/skill-name`.
- Referenced `scripts/`, `references/`, and `assets/` remain available for on-demand
  reads instead of being eagerly inserted into context.

This follows the official Agent Skills model of progressive disclosure:

1. Metadata at discovery time.
2. Full instructions at activation time.
3. Bundled resources only when needed.

References:

- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Skills client implementation guide](https://agentskills.io/client-implementation/adding-skills-support)

## The welcome-header contradiction

There are two conflicting observable requirements.

The supplied `welcome-me` skill states:

```text
## HARD REQUIREMENTS:
Your response must include at the top:
> Welcome to our Command Code assignment agent!
```

The assignment's illustrative flow says the agent should print:

```text
> Welcome to our agent!
```

These cannot both be the exclusive first line. The skill instruction is more specific
and the exercise is explicitly testing whether the agent loads and follows skill content.
The assignment also warns the candidate to consider all requirements rather than only
the example flow. For those reasons, preserving the skill-required first line is a
reasonable interpretation of the intended gotcha.

The safest compatibility output for the final submission is a two-line header:

```text
> Welcome to our Command Code assignment agent!
> Welcome to our agent!
```

This keeps the skill-mandated line at the top while also including the exact example
line. Importantly, these strings should remain in `SKILL.md`; they should not be
hardcoded into the matching engine. That keeps the behavior skill-driven and proves
that activation actually delivered the instructions to Claude.

### Current live behavior

For the prompt:

```text
I'm new to this project, what should I do?
```

the CLI logged:

```text
skill loaded: welcome-me
```

and placed the skill-required line at the top of its response:

```text
> Welcome to our Command Code assignment agent!
```

For the unrelated prompt:

```text
what's the weather?
```

the CLI answered without loading `welcome-me`. This is the most important negative
matching behavior in the exercise: making a skill available does not mean polluting
every request with its complete content.

Before submission, the two-line compatibility output should be adopted or the ambiguity
should be confirmed with Command Code. A strict test that requires both different
strings to be the sole first line would be logically impossible.

## Harness-engineering improvements

The project was reviewed against the [Learn Harness Engineering](https://walkinglabs.github.io/learn-harness-engineering/en/)
material. Five high-value improvements were implemented.

### 1. Repository as the system of record

At startup, the agent discovers and loads repository instructions from `AGENTS.md` or
`CLAUDE.md`. It also inspects `package.json` and selects the strongest conventional
verification script: `npm run check` when present, otherwise `npm test`.

The repository now includes a compact `AGENTS.md` containing:

- Project purpose.
- A code map.
- Install, test, verification, and run commands.
- Security and compatibility invariants.
- An executable definition of done.

This gives a fresh agent session enough information to understand, operate, and verify
the project without relying on facts held outside the repository.

### 2. Explicit task contracts

Before `apply_patch` is permitted to edit a file, Claude must call
`set_task_contract` with:

- An objective.
- One or more concrete acceptance criteria.
- Optional out-of-scope items.

This makes the intended result visible before implementation begins and prevents
unscoped edits. Contract creation is enforced by the tool host, not only requested in
the system prompt.

### 3. Evidence-gated completion

Each successful `apply_patch` operation advances a mutation version. The repository-
owned `verify` tool records the mutation version it verified. If Claude attempts to end
an editing task before the latest mutation has passed verification, the host rejects
completion and sends it back to continue working.

This replaces subjective statements such as "the code looks correct" with executable
evidence. The model cannot silently replace the repository verifier with an easier
command.

### 4. Durable session continuity

Successful conversations are atomically checkpointed to
`.mini-agent/session.json` and resumed on the next CLI run. Stored history is capped at
200,000 characters and retained at complete user-turn boundaries. Failed turns roll
back in memory and are not checkpointed.

`/clear` resets the in-memory conversation and removes the persisted checkpoint.
`--no-persist` provides an explicitly ephemeral run, while `--session <path>` supports
named checkpoints.

### 5. Structured observability

The CLI writes JSONL task events to `.mini-agent/task-trace.jsonl`. Events include:

- Run start, completion, and failure.
- Model-turn start and completion.
- Tool start, duration, result, and error status.
- The task contract and acceptance criteria.
- Completion-gate rejections.
- Verification command, mutation version, and pass/fail result.

Trace failures are isolated from agent execution so a diagnostics problem cannot break
the task it is observing. Runtime files are git-ignored and created with mode `0600`
where supported.

## How well the coding agent runs

### Deterministic verification

The final clean verification command was:

```sh
npm run check
```

Result:

```text
18 tests
18 passed
0 failed
```

The suite covers:

- Failed-turn history rollback.
- Model-turn and tool-call budget enforcement.
- Anthropic-compatible tool error reporting.
- Completion rejection before post-edit verification.
- Successful contract -> edit -> verify -> completion flow.
- Atomic session persistence and resumption.
- Repository instruction and verification-command discovery.
- Bounded session history.
- Skill-scope precedence and malformed-skill handling.
- Ranged, line-numbered file reads.
- Read-before-write enforcement.
- Ambiguous replacement rejection.
- Workspace and symlink escape rejection.
- Destructive-command denial.
- Omission of `load_skill` when no skills exist.
- Task-contract enforcement.
- Verification evidence tracking.
- Machine-readable JSONL traces.

### Clean-start verification

The one-command initialization path also passed:

```sh
./init.sh
```

It performed a clean `npm ci`, reported zero dependency vulnerabilities, ran syntax
checks over the source tree, executed all 18 tests, and printed the CLI start command.
On the test machine, the complete command took approximately 1.2 seconds; exact timing
will vary by machine and package cache.

### Live Claude editing test

A disposable workspace was created with its own `AGENTS.md`, `package.json`, and a
verifier that required `result.txt` to contain exactly `harness-ok\n`. The real CLI was
then asked:

```text
Create result.txt containing exactly harness-ok followed by a newline.
Do not modify any other file.
```

The live agent:

1. Recorded a task contract.
2. Created only the requested file through `apply_patch`.
3. Called the repository-owned verifier.
4. Received a successful verification result.
5. Reported completion.

The trace recorded:

```text
model turns: 4
tool calls: 3
mutations: 1
verification passed: true
duration: approximately 10.6 seconds
```

The disposable workspace was removed after verification.

### Live skill-selection tests

Two real Claude runs exercised the assignment's most important selection boundary:

| Prompt | Result | Approximate duration |
| --- | --- | ---: |
| `I'm new to this project, what should I do?` | Loaded `welcome-me` and followed its required first-line instruction | 9.6 s |
| `what's the weather?` | Did not load `welcome-me`; answered directly | 3.1 s |

These live results show that the matching design works as intended: Claude sees a small
catalog, makes a semantic relevance decision, and pays the context cost of full skill
instructions only for the matching request.

## Engineering strengths

- The skill-matching mechanism is semantic and model-driven rather than a hardcoded
  onboarding keyword test.
- The core loop is small enough to read end-to-end.
- Independent read-only tool calls run concurrently.
- File and search output is bounded to protect the model context.
- Existing files must be read before replacement or deletion.
- Replacements must match exactly once, preventing stale or ambiguous edits.
- All paths are resolved against an immutable workspace root and checked after symlink
  resolution.
- Potentially destructive shell commands require interactive approval and are rejected
  in one-shot mode.
- Model turns, tool calls, task duration, and output tokens are bounded.
- Tool failures are returned to Claude as structured error results so it can recover.
- Skill content is treated as untrusted task guidance and cannot override host safety or
  the user's intent.
- Tests use fake Claude clients and temporary workspaces, so the main suite is fast,
  deterministic, and does not spend API credits.

## Honest limitations

- Semantic skill selection is ultimately an LLM decision and therefore not perfectly
  deterministic across every possible wording or future model version.
- The completion gate version-tracks `apply_patch` operations. Bash is instructed not
  to edit files, but arbitrary shell mutation is not comprehensively classified by the
  host.
- A live run still depends on API availability, credentials, latency, and model access.
- Persisted conversations can contain user prompts and file excerpts. They are local,
  permission-restricted, and git-ignored, but users handling sensitive material may
  prefer `--no-persist`.
- The permanent automated suite uses fake API clients. The real-model checks described
  above were manual smoke tests because network-dependent tests would make the interview
  suite slower and flaky.
- The extra harness features exceed the assignment's minimum. They are valuable only as
  long as the submission continues to foreground the simple Agent Skills lifecycle.

## Submission recommendations

Before sending the project:

1. Resolve the welcome-header ambiguity with the two-line compatibility output or ask
   Command Code for clarification.
2. Add deterministic tests specifically proving positive `welcome-me` activation,
   full instruction injection, exact header output, and negative unrelated-prompt
   behavior.
3. Make the example environment default to the official Anthropic API and
   `claude-sonnet-5`; document Requesty as an optional gateway rather than the default.
4. Replace the README's time-spent placeholder with the real amount of time spent.
5. Lead the README with skill discovery, progressive disclosure, activation, and the
   two evaluator prompts. Present the reliability harness as a secondary enhancement.
6. Remove unrelated demo artifacts such as `dashboard/` from the final submission.
7. Add source attribution for the two registry skills.
8. Add and commit the intended project files before packaging or sharing the repository.

## Overall assessment

The coding agent is technically strong and demonstrably functional. Its central Agent
Skills implementation aligns with the official progressive-disclosure workflow, its
positive and negative selection behavior works with the real model, and its editing
loop produces verifiable outcomes rather than optimistic completion claims.

The remaining work is primarily submission polish: resolve or document the conflicting
welcome headers, focus the narrative on the assignment's core, add direct tests around
skill activation, and remove unrelated files. With those adjustments, the project
should present a clear combination of requirement comprehension, clean implementation,
thoughtful AI usage, and practical harness engineering.
