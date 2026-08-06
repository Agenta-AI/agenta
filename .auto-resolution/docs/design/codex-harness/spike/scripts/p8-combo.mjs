#!/usr/bin/env node
// P8a/P8b combo probe: CODEX_SQLITE_HOME redirect + resume.
// Phase 1: daemon A, CODEX_HOME=home-p8combo, CODEX_SQLITE_HOME=sq1 (throwaway). Teach codeword.
//          Then verify: no *.sqlite under CODEX_HOME; sqlite under sq1; sessions/ rollouts under
//          CODEX_HOME (the Option-2 file split).
// Phase 2: daemon B, SAME CODEX_HOME, FRESH empty CODEX_SQLITE_HOME=sq2. Native resume + ask.
//          If the codeword survives, resume depends only on the plain-file part of CODEX_HOME
//          (rollouts), not on the redirected sqlite -> Option 2 keeps native continuity.
import { appendFileSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const RUNNER =
  "/home/mahmoud/code/agenta/.claude/worktrees/codex-harness/services/runner";
const { SandboxAgent, InMemorySessionPersistDriver } = await import(
  `${RUNNER}/node_modules/sandbox-agent/dist/index.js`
);
const { local } = await import(
  `${RUNNER}/node_modules/sandbox-agent/dist/providers/local.js`
);

const out =
  "/home/mahmoud/code/agenta/.claude/worktrees/codex-harness/docs/design/codex-harness/spike/transcripts/p8-combo.jsonl";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, "");
const rec = (kind, data) =>
  appendFileSync(
    out,
    JSON.stringify({ t: new Date().toISOString(), kind, ...data }) + "\n",
  );

const SCRATCH = "/tmp/codex-derisk";
const cwd = `${SCRATCH}/ws-p8combo`;
const HOME = `${SCRATCH}/home-p8combo`;
const SQ1 = `${SCRATCH}/sqlite-p8-run1`;
const SQ2 = `${SCRATCH}/sqlite-p8-run2`;
const LOCAL_ID = "p8combo:codex";
mkdirSync(cwd, { recursive: true });
for (const d of [SQ1, SQ2]) {
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
}

const sessionInit = { cwd, mcpServers: [] };

function tree(dir, depth = 0) {
  if (depth > 2) return [];
  let names = [];
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      names.push(e.name + (e.isDirectory() ? "/" : ""));
      if (e.isDirectory()) {
        names.push(
          ...tree(join(dir, e.name), depth + 1).map((n) => `${e.name}/${n}`),
        );
      }
    }
  } catch {}
  return names;
}

async function startDaemon(sqliteHome) {
  const persist = new InMemorySessionPersistDriver();
  const client = await SandboxAgent.start({
    sandbox: local({
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        OPENAI_API_KEY: "",
        CODEX_HOME: HOME,
        CODEX_SQLITE_HOME: sqliteHome,
      },
      log: "inherit",
    }),
    persist,
  });
  return { client, persist };
}

async function runTurn(label, session, text) {
  let answer = "";
  session.onEvent((event) => {
    const u = event?.payload?.params?.update;
    if (u?.sessionUpdate === "agent_message_chunk")
      answer += u?.content?.text ?? "";
    rec("event", { label, sender: event.sender, payload: event.payload });
  });
  session.onPermissionRequest((request) => {
    rec("permission-request", { label, request });
    session.respondPermission(request.id, "reject").catch(() => {});
  });
  const result = await session.prompt([{ type: "text", text }]);
  rec("turn", { label, stopReason: result?.stopReason, answer });
  return answer;
}

const watchdog = setTimeout(() => {
  rec("watchdog", { note: "timed out after 480000ms" });
  process.exit(3);
}, 480000);

try {
  const a = await startDaemon(SQ1);
  const s1 = await a.client.createSession({
    id: LOCAL_ID,
    agent: "codex",
    cwd,
    sessionInit,
  });
  rec("phase1-session", { agentSessionId: s1.agentSessionId });
  try {
    await s1.setModel("gpt-5.6-luna");
  } catch {}
  await runTurn(
    "phase1-teach",
    s1,
    "Remember this codeword: OCELOT-77. Reply with exactly: OK",
  );
  const priorAgentSessionId = s1.agentSessionId;
  await a.client.destroySandbox();
  rec("phase1-files", {
    codexHome: tree(HOME),
    sqliteRedirect: tree(SQ1),
  });

  const b = await startDaemon(SQ2);
  await b.persist.updateSession({
    id: LOCAL_ID,
    agent: "codex",
    agentSessionId: priorAgentSessionId,
    lastConnectionId: "",
    createdAt: Date.now(),
    sessionInit,
  });
  const s2 = await b.client.resumeSession(LOCAL_ID);
  const nativeLoad = s2.agentSessionId === priorAgentSessionId;
  rec("phase2-resume", { agentSessionId: s2.agentSessionId, nativeLoad });
  try {
    await s2.setModel("gpt-5.6-luna");
  } catch {}
  const ans = await runTurn(
    "phase2-ask",
    s2,
    "What codeword did I ask you to remember earlier in this conversation? Reply with just the codeword.",
  );
  rec("phase2-done", { nativeLoad, answer: ans, freshSqliteDir: tree(SQ2) });
  await b.client.destroySandbox();
} catch (err) {
  rec("fatal", { error: String(err?.stack ?? err) });
} finally {
  clearTimeout(watchdog);
  process.exit(0);
}
