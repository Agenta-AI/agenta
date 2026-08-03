#!/usr/bin/env node
// Drive the sandbox-agent daemon exactly the way the runner does:
//   SandboxAgent.start({ sandbox: local({ env }) }) -> createSession({ agent: "codex", ... })
//   -> session.prompt(...) while recording every ACP envelope + permission request.
//
// Usage: node drive.mjs <scenario.json>
// The scenario file controls CODEX_HOME, env overrides, mcpServers, prompt, and how to
// answer permission requests. Everything observed is written as JSONL to the transcript.
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const RUNNER = "/home/mahmoud/code/agenta/.claude/worktrees/codex-harness/services/runner";
const { SandboxAgent, InMemorySessionPersistDriver } = await import(
  `${RUNNER}/node_modules/sandbox-agent/dist/index.js`
);
const { local } = await import(
  `${RUNNER}/node_modules/sandbox-agent/dist/providers/local.js`
);

const scenarioPath = process.argv[2];
if (!scenarioPath) {
  console.error("usage: node drive.mjs <scenario.json>");
  process.exit(2);
}
const scenario = JSON.parse(readFileSync(scenarioPath, "utf8"));
const out = scenario.transcript;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, "");
const rec = (kind, data) =>
  appendFileSync(out, JSON.stringify({ t: new Date().toISOString(), kind, ...data }) + "\n");

// Redact secret-bearing env values before the scenario lands in the transcript.
const redactedScenario = {
  ...scenario,
  env: Object.fromEntries(
    Object.entries(scenario.env ?? {}).map(([k, v]) => [
      k,
      /KEY|TOKEN|AUTH/i.test(k) && v ? `<redacted len=${String(v).length}>` : v,
    ]),
  ),
};
rec("scenario", { scenario: redactedScenario });

// Environment for the daemon. local() spawns `{...process.env, ...options.env}` (inherit-then-
// apply), so anything we must NOT inherit has to be explicitly overridden here.
const env = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  // Isolation defaults: no ambient provider keys, no ambient CODEX_HOME unless the scenario
  // sets them.
  OPENAI_API_KEY: "",
  CODEX_HOME: "",
  ...(scenario.env ?? {}),
};

const client = await SandboxAgent.start({
  sandbox: local({ env, log: "inherit" }),
  persist: new InMemorySessionPersistDriver(),
});
rec("daemon", { sandboxId: client.sandboxId, inspectorUrl: client.inspectorUrl });

let finished = false;
const watchdogMs = scenario.timeoutMs ?? 180000;
const watchdog = setTimeout(async () => {
  rec("watchdog", { note: `timed out after ${watchdogMs}ms` });
  await shutdown(3);
}, watchdogMs);

async function shutdown(code) {
  if (finished) return;
  finished = true;
  clearTimeout(watchdog);
  try {
    await client.destroySandbox();
  } catch (err) {
    rec("destroy-error", { error: String(err) });
  }
  process.exit(code);
}

try {
  const session = await client.createSession({
    agent: scenario.agent ?? "codex",
    cwd: scenario.cwd,
    sessionInit: {
      cwd: scenario.cwd,
      mcpServers: scenario.mcpServers ?? [],
    },
  });
  rec("session", { id: session.id, agentSessionId: session.agentSessionId });

  session.onEvent((event) => {
    rec("event", { sender: event.sender, payload: event.payload });
  });

  session.onPermissionRequest((request) => {
    rec("permission-request", { request });
    const reply = scenario.reply ?? "none";
    if (reply !== "none") {
      session
        .respondPermission(request.id, reply)
        .then(() => rec("permission-reply", { permissionId: request.id, reply }))
        .catch((err) =>
          rec("permission-reply-error", { permissionId: request.id, reply, error: String(err) }),
        );
    }
  });

  try {
    const modes = await session.getModes();
    const configOptions = await session.getConfigOptions();
    rec("session-state", { modes, configOptions });
  } catch (err) {
    rec("session-state-error", { error: String(err) });
  }

  // Derisk round: set ACP session config options (e.g. {"mode": "agent-full-access"}) before
  // the prompt, mirroring what a runner-side per-session policy switch would do.
  for (const [id, value] of Object.entries(scenario.configOptions ?? {})) {
    try {
      const res = await session.setConfigOption(id, value);
      rec("set-config-option", { id, value, res });
    } catch (err) {
      rec("set-config-option-error", { id, value, error: String(err) });
    }
  }

  if (scenario.model) {
    try {
      const res = await session.setModel(scenario.model);
      rec("set-model", { model: scenario.model, res });
    } catch (err) {
      rec("set-model-error", { model: scenario.model, error: String(err) });
    }
  }

  const result = await session.prompt([{ type: "text", text: scenario.prompt }]);
  rec("prompt-result", { result });

  if (scenario.secondPrompt) {
    const result2 = await session.prompt([{ type: "text", text: scenario.secondPrompt }]);
    rec("prompt-result-2", { result: result2 });
  }

  await shutdown(0);
} catch (err) {
  rec("fatal", { error: String(err?.stack ?? err) });
  await shutdown(1);
}
