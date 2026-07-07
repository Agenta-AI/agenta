/**
 * WP-1 runner: install Pi, run a small tool-using agent task, and export the run
 * to Agenta as OpenTelemetry traces via the agenta-otel extension.
 *
 * Auth: uses AuthStorage.create(), which reads ~/.pi/agent/auth.json. Log in once
 * with `pnpm exec pi` -> `/login` -> "ChatGPT Plus/Pro (Codex)" (no API key needed),
 * or set OPENAI_API_KEY / ANTHROPIC_API_KEY in the environment.
 *
 * Run: `pnpm start`
 */
import dotenv from "dotenv";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRegistry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import agentaOtel, { runConfig, shutdownTracing } from "./agenta-otel.ts";

// Load env before anything reads it: poc-local .env first, then walk up to the
// repo-root .env.test.local for the shared dev-box Agenta credentials.
function loadEnv(): void {
  dotenv.config();
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, ".env.test.local");
    if (existsSync(candidate)) {
      dotenv.config({ path: candidate });
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
}

type Scenario = { name: string; seed: (dir: string) => void; prompts: string[] };

const SCENARIOS: Record<string, Scenario> = {
  simple: {
    name: "simple",
    seed: (dir) =>
      writeFileSync(
        join(dir, "notes.txt"),
        "TODO: greet the user by name (use 'Mahmoud')\n" +
          "TODO: add a two-line haiku about tracing\n",
      ),
    prompts: [
      "Read notes.txt in the current directory, then create greeting.txt that " +
        "addresses each TODO. Keep it short.",
    ],
  },
  // Many tool calls across several turns, ending in a structured return.
  complex: {
    name: "complex",
    seed: (dir) => {
      writeFileSync(
        join(dir, "alpha.py"),
        "def add(a, b):\n    return a + b\n\n\ndef sub(a, b):\n    return a - b\n",
      );
      writeFileSync(
        join(dir, "beta.py"),
        "import math\n\n\ndef area(r):\n    return math.pi * r * r\n",
      );
      writeFileSync(join(dir, "README.md"), "# demo\n\nA tiny demo package.\n");
    },
    prompts: [
      "Explore this directory: list the files, read every .py file, and use bash " +
        "(wc -l) to count the total number of lines across the .py files. Then write " +
        "REPORT.md describing what each .py file does and the total line count. " +
        "Finally, reply with ONLY a JSON object: " +
        '{"files": ["..."], "total_py_lines": <int>, "report": "REPORT.md"}.',
    ],
  },
  // A longer, multi-prompt session: each prompt is its own trace, all sharing one session.id.
  session: {
    name: "session",
    seed: () => {},
    prompts: [
      "Create todo.md with exactly 3 short tasks about adding distributed tracing to a service.",
      "Append 2 more tasks to todo.md, then show me the full file with the bash 'cat' command.",
      'Read todo.md and reply with ONLY a JSON object: {"count": <number of tasks>, "tasks": ["..."]}.',
    ],
  },
};

function pickScenario(cliPrompts: string[]): Scenario {
  if (cliPrompts.length > 0) {
    return { name: "custom", seed: SCENARIOS.complex.seed, prompts: cliPrompts };
  }
  const key = process.env.PI_SCENARIO || "complex";
  return SCENARIOS[key] ?? SCENARIOS.complex;
}

async function main(): Promise<void> {
  loadEnv();

  // A throwaway working dir seeded per scenario so the agent actually uses tools.
  const cwd = mkdtempSync(join(tmpdir(), "pi-poc-"));
  const scenario = pickScenario(process.argv.slice(2));
  scenario.seed(cwd);

  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const available = await modelRegistry.getAvailable();
  if (available.length === 0) {
    console.error(
      "\nNo model is available. Authenticate Pi first:\n" +
        "  pnpm exec pi   then  /login  ->  \"ChatGPT Plus/Pro (Codex)\"\n" +
        "or export OPENAI_API_KEY / ANTHROPIC_API_KEY.\n",
    );
    process.exit(1);
  }

  const wanted = process.env.PI_MODEL; // "gpt-5.5" or "openai-codex/gpt-5.5"
  const model =
    (wanted &&
      available.find(
        (m: any) => m.id === wanted || `${m.provider}/${m.id}` === wanted,
      )) ||
    available.find((m: any) => m.id === "gpt-5.5") ||
    available.find((m: any) => !/spark|mini/i.test(m.id)) ||
    available[0];
  if (wanted && model.id !== wanted && `${model.provider}/${model.id}` !== wanted) {
    console.warn(`[run] PI_MODEL="${wanted}" not available; using ${model.id}`);
  }
  console.log(`[run] scenario: ${scenario.name} (${scenario.prompts.length} prompt(s))`);
  console.log(`[run] model: ${model.provider}/${model.id}`);
  console.log(`[run] cwd:   ${cwd}`);

  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: getAgentDir(),
    extensionFactories: [agentaOtel],
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd,
    model,
    authStorage,
    modelRegistry,
    tools: ["read", "bash", "edit", "write", "ls"],
    sessionManager: SessionManager.inMemory(cwd),
    resourceLoader: loader,
  });

  // Hand the session id + model to the extension so spans carry them.
  runConfig.sessionId = session.sessionId;
  runConfig.provider = model.provider;
  runConfig.requestModel = model.id;

  session.subscribe((event: any) => {
    if (
      event.type === "message_update" &&
      event.assistantMessageEvent?.type === "text_delta"
    ) {
      process.stdout.write(event.assistantMessageEvent.delta);
    } else if (event.type === "tool_execution_start") {
      process.stdout.write(`\n[tool] ${event.toolName}\n`);
    }
  });

  const traceIds: string[] = [];
  for (let i = 0; i < scenario.prompts.length; i++) {
    const p = scenario.prompts[i];
    console.log(`\n[run] prompt ${i + 1}/${scenario.prompts.length}: ${p}\n`);
    await session.prompt(p);
    if (runConfig.traceId) traceIds.push(runConfig.traceId);
  }

  console.log("\n\n[run] flushing spans to Agenta...");
  session.dispose();
  await shutdownTracing();

  const host = (process.env.AGENTA_HOST || "").replace(/\/+$/, "");
  console.log("[run] flushed.");
  console.log(`[run] session_id=${session.sessionId}`);
  traceIds.forEach((tid, i) => {
    console.log(`[run] trace ${i + 1}: ${tid}`);
    console.log(`        ${host}/api/spans/?trace_id=${tid}`);
  });
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
