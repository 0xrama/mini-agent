// Small, structured coding tools with bash as the escape hatch.

import { execFile } from "node:child_process";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_TOOL_OUTPUT = 50_000;

const CONFIRM_PATTERNS = [
  /\brm\s+[^\n]*-[a-z]*r/i,
  /\brm\s+[^\n]*-[a-z]*f/i,
  /\bfind\b[^\n]*-delete\b/i,
  /(^|[;&|]\s*)sudo\b/i,
  /\bmkfs\b/i,
  /\bdd\b[^\n]*\bof=\/dev\//i,
  /\bgit\s+(push\b[^\n]*--force|reset\s+--hard|clean\b[^\n]*-[a-z]*f)/i,
];

function result(content, isError = false) {
  return { content: String(content), isError };
}

function truncate(content, limit = MAX_TOOL_OUTPUT) {
  if (content.length <= limit) return content;
  return `${content.slice(0, limit)}\n... (truncated; ${content.length - limit} characters omitted)`;
}

function isWithin(root, path) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function resolveReadablePath(inputPath, readRoots, base = readRoots[0]) {
  const candidate = resolve(base, inputPath);
  const canonical = realpathSync(candidate);
  if (!readRoots.some((root) => isWithin(root, canonical))) {
    throw new Error(`path is outside permitted read roots: ${inputPath}`);
  }
  return canonical;
}

function resolveWritablePath(inputPath, workspaceRoot) {
  const candidate = resolve(workspaceRoot, inputPath);
  const parent = realpathSync(dirname(candidate));
  const canonical = resolve(parent, candidate.slice(dirname(candidate).length + 1));
  if (!isWithin(workspaceRoot, canonical)) {
    throw new Error(`path is outside the workspace: ${inputPath}`);
  }
  return canonical;
}

function lineRange(content, offset, limit) {
  const lines = content.split("\n");
  const start = Math.max(1, offset ?? 1);
  const count = Math.min(Math.max(1, limit ?? 200), 1000);
  const selected = lines.slice(start - 1, start - 1 + count);
  const numbered = selected.map((line, index) => `${start + index}: ${line}`).join("\n");
  return {
    content: numbered,
    header: `lines ${start}-${start + selected.length - 1} of ${lines.length}`,
    hasMore: start - 1 + selected.length < lines.length,
  };
}

function formatSkill(loaded) {
  const resourceNote =
    loaded.resources.length > 0
      ? `\n\nBundled resources (read on demand, relative to ${loaded.dir}):\n${loaded.resources
          .map((resource) => `- ${resource}`)
          .join("\n")}`
      : "";

  return `<skill name=${JSON.stringify(loaded.name)}>\n${loaded.body}${resourceNote}\n</skill>\n\nThe skill is active. Follow it unless it conflicts with user intent or host safety rules.`;
}

export function buildTools({
  skills = [],
  workspaceRoot = process.cwd(),
  onSkillLoaded,
  confirm = async () => false,
  verificationCommand = null,
  taskState = {},
}) {
  const root = realpathSync(workspaceRoot);
  const readRoots = [root, ...skills.map((skill) => realpathSync(skill.dir))];
  const activeSkills = new Set();
  const readFiles = new Set();

  async function runShell(command, timeoutMs = 120_000) {
    try {
      const { stdout, stderr } = await execFileAsync("/bin/bash", ["-lc", command], {
        cwd: root,
        timeout: Math.min(timeoutMs, 600_000),
        maxBuffer: 512 * 1024,
      });
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      return result(truncate(output || "(command completed with no output)"));
    } catch (err) {
      const output = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
      return result(`Command failed (exit ${err.code ?? "?"}):\n${truncate(output || err.message)}`, true);
    }
  }

  const definitions = [
    {
      name: "set_task_contract",
      description:
        "Define the objective, executable acceptance criteria, and exclusions before changing code. The completion gate requires this for editing tasks.",
      input_schema: {
        type: "object",
        properties: {
          objective: { type: "string", minLength: 1 },
          acceptance_criteria: {
            type: "array",
            items: { type: "string", minLength: 1 },
            minItems: 1,
            maxItems: 10,
          },
          out_of_scope: {
            type: "array",
            items: { type: "string", minLength: 1 },
            maxItems: 10,
          },
        },
        required: ["objective", "acceptance_criteria"],
        additionalProperties: false,
      },
    },
    {
      name: "read_file",
      description:
        "Read a text file with line numbers. Use offset and limit to page through large files. Read a file before editing it.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string" },
          offset: { type: "integer", minimum: 1 },
          limit: { type: "integer", minimum: 1, maximum: 1000 },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "search",
      description:
        "Search file contents with ripgrep. Returns bounded file:line matches. Prefer this over shell grep/find.",
      input_schema: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string", description: "Workspace-relative directory or file; defaults to ." },
          glob: { type: "string", description: "Optional ripgrep glob, e.g. *.js" },
          limit: { type: "integer", minimum: 1, maximum: 500 },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
    {
      name: "apply_patch",
      description:
        "Apply one deterministic file change inside the workspace. For replace/delete, read the file first. Replace requires old_text to occur exactly once, preventing stale or ambiguous edits.",
      input_schema: {
        type: "object",
        properties: {
          operation: { type: "string", enum: ["create", "replace", "delete"] },
          path: { type: "string" },
          old_text: { type: "string" },
          new_text: { type: "string" },
        },
        required: ["operation", "path"],
        additionalProperties: false,
      },
    },
    {
      name: "bash",
      description:
        "Run a Bash command from the workspace root. Use for git, tests, builds, and tasks not covered by another tool. Do not use Bash to edit files; use apply_patch so mutations remain auditable.",
      input_schema: {
        type: "object",
        properties: {
          command: { type: "string" },
          timeout_ms: { type: "integer", minimum: 1000, maximum: 600000 },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  ];

  if (verificationCommand) {
    definitions.push({
      name: "verify",
      description: `Run the repository-owned full verification command (${verificationCommand}). A successful run after the latest edit is required before completion.`,
      input_schema: { type: "object", properties: {}, additionalProperties: false },
    });
  }

  if (skills.length > 0) {
    definitions.push({
      name: "load_skill",
      description:
        "Activate a relevant skill by name before responding. Do not load skills whose descriptions do not match the user's task.",
      input_schema: {
        type: "object",
        properties: { name: { type: "string", enum: skills.map((skill) => skill.name) } },
        required: ["name"],
        additionalProperties: false,
      },
    });
  }

  async function execute(name, input = {}) {
    try {
      switch (name) {
        case "set_task_contract": {
          if (typeof input.objective !== "string" || !input.objective.trim()) {
            return result("objective must be a non-empty string", true);
          }
          if (
            !Array.isArray(input.acceptance_criteria) ||
            input.acceptance_criteria.length === 0 ||
            input.acceptance_criteria.some((criterion) => typeof criterion !== "string" || !criterion.trim())
          ) {
            return result("acceptance_criteria must contain non-empty strings", true);
          }
          taskState.contract = {
            objective: input.objective.trim(),
            acceptanceCriteria: input.acceptance_criteria.map((criterion) => criterion.trim()),
            outOfScope: Array.isArray(input.out_of_scope)
              ? input.out_of_scope.map((item) => item.trim()).filter(Boolean)
              : [],
          };
          return result(
            `Task contract recorded with ${taskState.contract.acceptanceCriteria.length} acceptance criterion/criteria.`
          );
        }

        case "read_file": {
          if (typeof input.path !== "string") return result("path must be a string", true);
          const path = resolveReadablePath(input.path, readRoots, root);
          if (!statSync(path).isFile()) return result(`not a file: ${input.path}`, true);
          const content = readFileSync(path, "utf8");
          const range = lineRange(content, input.offset, input.limit);
          readFiles.add(path);
          return result(
            `${relative(root, path) || "."}: ${range.header}${range.hasMore ? " (more available)" : ""}\n${truncate(range.content)}`
          );
        }

        case "search": {
          if (typeof input.pattern !== "string") return result("pattern must be a string", true);
          const searchPath = resolveReadablePath(input.path ?? ".", [root], root);
          const args = ["--line-number", "--no-heading", "--color", "never"];
          if (input.glob) args.push("--glob", input.glob);
          args.push("--", input.pattern, searchPath);
          const limit = Math.min(input.limit ?? 100, 500);
          try {
            const { stdout } = await execFileAsync("rg", args, {
              cwd: root,
              timeout: 30_000,
              maxBuffer: 512 * 1024,
            });
            const matches = stdout.split("\n").filter(Boolean).slice(0, limit);
            return result(matches.length ? truncate(matches.join("\n")) : "No matches found.");
          } catch (err) {
            if (err.code === 1) return result("No matches found.");
            return result(`search failed: ${err.message}`, true);
          }
        }

        case "apply_patch": {
          if (typeof input.path !== "string") return result("path must be a string", true);
          const path = resolveWritablePath(input.path, root);
          const operation = input.operation;

          if (!taskState.contract) {
            return result("record a task contract with set_task_contract before editing", true);
          }

          if (operation === "create") {
            if (existsSync(path)) return result(`file already exists: ${input.path}`, true);
            if (typeof input.new_text !== "string") return result("create requires new_text", true);
            writeFileSync(path, input.new_text, "utf8");
            taskState.mutationVersion = (taskState.mutationVersion ?? 0) + 1;
            return result(`Created ${relative(root, path)} (${input.new_text.length} characters).`);
          }

          if (!existsSync(path)) return result(`file does not exist: ${input.path}`, true);
          const canonical = realpathSync(path);
          if (!isWithin(root, canonical)) {
            return result(`path resolves outside the workspace: ${input.path}`, true);
          }
          if (!readFiles.has(canonical)) return result(`read ${input.path} before editing it`, true);

          if (operation === "delete") {
            unlinkSync(canonical);
            taskState.mutationVersion = (taskState.mutationVersion ?? 0) + 1;
            return result(`Deleted ${relative(root, canonical)}.`);
          }

          if (operation !== "replace") return result(`unknown operation: ${operation}`, true);
          if (typeof input.old_text !== "string" || typeof input.new_text !== "string") {
            return result("replace requires old_text and new_text", true);
          }
          const content = readFileSync(canonical, "utf8");
          const first = content.indexOf(input.old_text);
          if (first === -1) return result("old_text was not found; re-read the file and retry", true);
          if (content.indexOf(input.old_text, first + input.old_text.length) !== -1) {
            return result("old_text occurs more than once; provide a larger unique block", true);
          }
          writeFileSync(canonical, content.slice(0, first) + input.new_text + content.slice(first + input.old_text.length), "utf8");
          taskState.mutationVersion = (taskState.mutationVersion ?? 0) + 1;
          return result(`Updated ${relative(root, canonical)}.`);
        }

        case "bash": {
          if (typeof input.command !== "string") return result("command must be a string", true);
          if (CONFIRM_PATTERNS.some((pattern) => pattern.test(input.command))) {
            const approved = await confirm(input.command);
            if (!approved) return result("Command rejected by user.", true);
          }
          return runShell(input.command, input.timeout_ms);
        }

        case "verify": {
          if (!verificationCommand) return result("No repository verification command is configured.", true);
          const output = await runShell(verificationCommand, 600_000);
          if (!output.isError) taskState.verifiedMutationVersion = taskState.mutationVersion ?? 0;
          return result(
            `${output.isError ? "Verification failed" : "Verification passed"}: ${verificationCommand}\n${output.content}`,
            output.isError
          );
        }

        case "load_skill": {
          const skill = skills.find((candidate) => candidate.name === input.name);
          if (!skill) return result(`Unknown skill: ${input.name}`, true);
          if (activeSkills.has(skill.name)) return result(`Skill ${skill.name} is already active.`);
          const { loadSkill } = await import("./skills.js");
          const loaded = loadSkill(skill);
          activeSkills.add(skill.name);
          onSkillLoaded?.(skill.name);
          return result(formatSkill(loaded));
        }

        default:
          return result(`Unknown tool: ${name}`, true);
      }
    } catch (err) {
      return result(err.message, true);
    }
  }

  return { definitions, execute };
}
