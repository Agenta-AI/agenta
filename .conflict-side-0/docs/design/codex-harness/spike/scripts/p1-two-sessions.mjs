#!/usr/bin/env node
// P1 derisk probe: ONE daemon process, multiple createSession calls.
// The daemon is started with CODEX_CONFIG='{"approval_policy":"untrusted"}' while the
// CODEX_HOME config.toml says approval_policy="never". If untrusted gating shows up in
// EVERY session on this daemon — including one whose sessionInit smuggles an (untyped)
// per-session env override attempt — then CODEX_CONFIG is fixed at daemon start and has
// no per-session channel.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const RUNNER =
  "/home/mahmoud/code/agenta/.claude/worktrees/codex-harness/services/runner";
const { SandboxAgent, InMemorySessionPersistDriver } = await import(
  `${RUNNER}/node_modules/sandbox-agent/dist/index.js`
);
const { local } = await import(
  `${RUNNER}/node_modules/sandbox-agent/dist/providers/local.js`
);

const out =
  "/home/mahmoud/code/agenta/.claude/worktrees/codex-harness/docs/design/codex-harness/spike/transcripts/p1-two-sessions.jsonl";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, "");
const rec = (kind, data) =>
  appendFileSync(
    out,
    JSON.stringify({ t: new Date().toISOString(), kind, ...data }) + "\n",
  );

const cwd = "/tmp/codex-derisk/ws-p1-daemon-reuse";
const env = {
  HOME: process.env.HOME,
  PATH: process.env.PATH,
  OPENAI_API_KEY: "",
  CODEX_HOME: "/tmp/codex-derisk/home-p1-daemon-reuse",
  CODEX_CONFIG: '{"approval_policy":"untrusted"}',
};
rec("scenario", {
  note: "one daemon; config.toml=never; daemon env CODEX_CONFIG=untrusted; three sessions",
  env: { ...env, OPENAI_API_KEY: "<empty>" },
});

const client = await SandboxAgent.start({
  sandbox: local({ env, log: "inherit" }),
  persist: new InMemorySessionPersistDriver(),
});
rec("daemon", { sandboxId: client.sandboxId });

const watchdog = setTimeout(async () => {
  rec("watchdog", { note: "timed out after 420000ms" });
  await client.destroySandbox().catch(() => {});
  process.exit(3);
}, 420000);

async function runSession(label, sessionInitExtra, promptText) {
  const gates = [];
  const session = await client.createSession({
    agent: "codex",
    cwd,
    sessionInit: { cwd, mcpServers: [], ...sessionInitExtra },
  });
  rec("session", { label, id: session.id, agentSessionId: session.agentSessionId });
  session.onEvent((event) => rec("event", { label, sender: event.sender, payload: event.payload }));
  session.onPermissionRequest((request) => {
    gates.push(request.toolCall?.rawInput ?? request.toolCall);
    rec("permission-request", { label, request });
    session
      .respondPermission(request.id, "once")
      .then(() => rec("permission-reply", { label, permissionId: request.id, reply: "once" }))
      .catch((err) => rec("permission-reply-error", { label, error: String(err) }));
  });
  try {
    await session.setModel("gpt-5.6-luna");
  } catch (err) {
    rec("set-model-error", { label, error: String(err) });
  }
  const result = await session.prompt([{ type: "text", text: promptText }]);
  rec("prompt-result", { label, gateCount: gates.length, result });
  return gates.length;
}

try {
  const a = await runSession(
    "session-A",
    {},
    "Run the shell command `echo p1-session-a` and report its raw output.",
  );
  const b = await runSession(
    "session-B",
    {},
    "Run the shell command `echo p1-session-b` and report its raw output.",
  );
  // Attempted per-session env override: not part of NewSessionRequest (cwd, additionalDirectories,
  // mcpServers, _meta only) — smuggle both a top-level `env` and a _meta variant to prove they are
  // dead letters.
  const c = await runSession(
    "session-C-env-override-attempt",
    {
      env: { CODEX_CONFIG: '{"approval_policy":"never"}' },
      _meta: { env: { CODEX_CONFIG: '{"approval_policy":"never"}' } },
    },
    "Run the shell command `echo p1-session-c` and report its raw output.",
  );
  rec("verdict-data", { gatesA: a, gatesB: b, gatesC: c });
} catch (err) {
  rec("fatal", { error: String(err?.stack ?? err) });
} finally {
  clearTimeout(watchdog);
  await client.destroySandbox().catch(() => {});
  process.exit(0);
}
