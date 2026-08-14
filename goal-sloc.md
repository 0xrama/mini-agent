# SLOC retrospective

Metric: `cloc` code lines, measured consistently with `npx --yes cloc@2.06`.
The primary target is maintained application code (`src/`, `test/`, and `scripts/`);
unrelated product code is reported separately. No numeric target was supplied, so the
stop condition is diminishing structural returns without feature or safety loss.

## Baseline

- Shipping JavaScript (`src/`): 934 code lines.
- Tests: 380 code lines.
- Verification (`scripts/`): 14 code lines.
- Orphaned dashboard: 503 HTML/CSS/JavaScript code lines.
- Combined baseline: 1,831 code lines; harness-only baseline: 1,328 code lines.
- Generated/vendored floor: `node_modules/` is ignored and excluded; `package-lock.json`
  is generated dependency metadata and excluded from the maintained-code target.

Feedback loops: `npm run check` passed 18/18 tests; CLI startup, skill discovery, and
clean REPL exit passed without an API key. A new live Anthropic run is unavailable
because `ANTHROPIC_API_KEY` is not set. `knip` found no dead files or dependencies and
one unused export (`validateSkill`). `madge` found no orphaned source modules. ESLint's
AST complexity report identified `tools.execute` (56), skill validation (17), and
`Agent.run` (16) as hotspots.

## Milestones

### 1. Dead subsystem removal

- Deleted `dashboard/index.html`: an unrelated, standalone daily tracker with no import,
  package entry point, documentation, test, or contributor-map presence.
- Made the internally used `validateSkill` function private, matching the semantic
  unused-export report.
- Reduction classification: 100% structural (orphan removal / API contraction), 0%
  cheap levers. No comments, whitespace, formatting, or measuring rules were changed.
- Verification: `npm run check` passed 18/18 tests; `knip` reported no unused files,
  dependencies, or exports; CLI startup/discovery/exit passed.
- Result: 1,328 code lines, down 503 (27.5%) from the combined baseline.

### 2. Dead state and surface removal

- Removed verification-history accumulation that had no reader; completion gating and
  trace events continue to use `verifiedMutationVersion` and emitted evidence.
- Stopped exposing undocumented tool-factory internals unused by every caller.
- Inlined a one-hop `canonicalExisting` wrapper into its five call sites.
- Reduction classification: 100% structural (dead state / API contraction / redundant
  abstraction removal), 0% cheap levers.
- Verification: `npm run check` passed 18/18 tests and `knip` remained clean.
- Result: 1,318 harness code lines, down 10 (0.8%) from the harness baseline and 513
  (28.0%) from the combined baseline.

## Stop decision

There is no generated code in the 1,318-line primary target. All seven shipping modules
have inbound references, both runtime dependencies are used, and the remaining test and
verification code is active scaffolding. The largest complexity hotspots remain
`tools.execute` (54), skill validation (17), and `Agent.run` (16), but their branches
encode distinct tool, safety, validation, and lifecycle behavior. Rewriting those areas
for a small line-count gain would increase risk under the current branch-level coverage.

The structural well is therefore dry under the current feature set. Further material
reduction requires a product decision to drop behavior, reduce safety contracts, or
remove test coverage; none was done.
