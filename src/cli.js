#!/usr/bin/env node
// mini-agent CLI: REPL + one-shot mode.

import { createInterface } from "node:readline";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverSkills, skillSearchDirs } from "./skills.js";
import { Agent } from "./agent.js";
import { createJsonlTracer } from "./trace.js";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const style = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = (text) => style(2, text);
const bold = (text) => style(1, text);
const cyan = (text) => style(36, text);

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const options = { persist: true, trace: true, prompt: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-persist") options.persist = false;
    else if (arg === "--no-trace") options.trace = false;
    else if (arg === "--session") {
      if (!argv[index + 1]) throw new Error("--session requires a file path");
      options.session = argv[++index];
    } else options.prompt.push(arg);
  }
  return options;
}

// Minimal .env.local loader (KEY=value lines; does not override existing env).
// Supports gateways like requesty.ai via ANTHROPIC_BASE_URL.
function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvFile(join(rootDir, ".env.local"));

function makeConfirm(rl, interactive) {
  return (command) =>
    new Promise((resolvePromise) => {
      if (!interactive) return resolvePromise(false);
      console.error(dim(`\npotentially destructive command:\n  ${command}`));
      rl.question("Run it? [y/N] ", (answer) => {
        resolvePromise(/^y(es)?$/i.test(answer.trim()));
      });
    });
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Error: ANTHROPIC_API_KEY is not set.");
    process.exit(1);
  }

  // Discover skills across scopes; the bundled .skills dir acts as a
  // built-in fallback below project- and user-level directories.
  const searchDirs = [...new Set([...skillSearchDirs(), join(rootDir, ".skills")])];
  const { skills, diagnostics } = discoverSkills(searchDirs);
  for (const d of diagnostics) console.error(dim(`skills: ${d}`));

  const options = parseArgs(process.argv.slice(2));
  const workspaceRoot = process.cwd();
  const oneShot = options.prompt.join(" ").trim();
  const interactive = process.stdin.isTTY && !oneShot;
  const stateDir = join(workspaceRoot, ".mini-agent");
  const sessionFile = options.persist
    ? resolve(workspaceRoot, options.session ?? join(".mini-agent", "session.json"))
    : undefined;
  const onEvent = options.trace ? createJsonlTracer(join(stateDir, "task-trace.jsonl")) : undefined;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: interactive,
  });
  const confirm = makeConfirm(rl, interactive);

  const agent = new Agent({
    skills,
    workspaceRoot,
    confirm,
    sessionFile,
    onEvent,
    onTextDelta: (delta) => process.stdout.write(delta),
    onToolUse: (call) => {
      if (call.name === "bash") console.error(dim(`$ ${call.input.command}`));
      else if (call.name === "read_file") console.error(dim(`read ${call.input.path}`));
      else if (call.name === "search") console.error(dim(`search /${call.input.pattern}/`));
      else if (call.name === "apply_patch") console.error(dim(`${call.input.operation} ${call.input.path}`));
      else if (call.name === "set_task_contract") console.error(dim(`contract: ${call.input.objective}`));
      else if (call.name === "verify") console.error(dim("verify repository"));
    },
    onSkillLoaded: (name) => console.error(cyan(`skill loaded: ${name}`)),
  });
  await agent.init();

  if (!oneShot) {
    console.log(
      bold("mini-agent") +
        dim(
          ` - ${skills.length} skill(s): ${skills.map((skill) => skill.name).join(", ") || "none"}` +
            `${agent.messages.length ? `; resumed ${agent.messages.length} messages` : ""}`
        )
    );
  }

  if (oneShot) {
    await agent.run(oneShot);
    rl.close();
    return;
  }

  console.log(dim('Type a prompt, /skill-name, /skills, /clear, or "exit".\n'));

  const prompt = () =>
    rl.question(cyan("you › "), async (input) => {
      const text = input.trim();
      if (!text) return prompt();
      if (/^(exit|quit)$/i.test(text)) return rl.close();
      try {
        if (text === "/clear") {
          agent.clear();
          console.log(dim("Conversation cleared."));
          return prompt();
        }
        if (text === "/skills") {
          console.log(skills.map((skill) => `${skill.name}: ${skill.description}`).join("\n"));
          return prompt();
        }
        // User-explicit activation: /welcome-me loads the skill harness-side.
        const slash = text.match(/^\/([a-z0-9-]+)$/i);
        if (slash) {
          const ok = await agent.activateSkillExplicit(slash[1]);
          console.log(ok ? cyan(`skill activated: ${slash[1]}`) : `Unknown skill "${slash[1]}"`);
          return prompt();
        }
        await agent.run(text);
      } catch (err) {
        console.error(`\nError: ${err.message}\n`);
      }
      prompt();
    });

  rl.on("close", () => {
    process.exitCode = 0;
  });
  prompt();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
