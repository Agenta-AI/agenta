#!/usr/bin/env node
// P8b derisk probe: does resuming a codex session after daemon death need the CODEX_HOME state?
// Phase 1: daemon A, fresh CODEX_HOME, teach the session a codeword, destroy the daemon.
// Phase 2: daemon B, SAME CODEX_HOME, seed the persist driver like the runner does
//          (environment.ts synthetic record) and resumeSession -> ask for the codeword.
// Phase 3: daemon C, FRESH CODEX_HOME (auth.json only, like a per-run ephemeral home),
//          same resume -> ask for the codeword.
// A resume that keeps the prior agentSessionId went through ACP session/load (native resume);
// a changed agentSessionId means the patch fell back to createRemoteSession (fresh thread).
import { appendFileSync, mkdirSync, writeFileSync, cpSync, rmSync, readFileSync } from "node:fs";
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
  "/home/mahmoud/code/agenta/.claude/worktrees/codex-harness/docs/design/codex-harness/spike/transcripts/p8-resume.jsonl";
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, "");
const rec = (kind, data) =>
  appendFileSync(
    out,
    JSON.stringify({ t: new Date().toISOString(), kind, ...data }) + "\n",
  );

const SCRATCH = "/tmp/codex-derisk";
const cwd = `${SCRATCH}/ws-p8`;
const HOME_PRESERVED = `${SCRATCH}/home-p8-preserved`;
const HOME_FRESH = `${SCRATCH}/home-p8-fresh`;
const LOCAL_ID = "p8sess:codex";
mkdirSync(cwd, { recursive: true });

const sessionInit = { cwd, mcpServers: [] };

async function startDaemon(codexHome) {
  const persist = new InMemorySessionPersistDriver();
  const client = await SandboxAgent.start({
    sandbox: local({
      env: {
        HOME: process.env.HOME,
        PATH: process.env.PATH,
        OPENAI_API_KEY: "",
        CODEX_HOME: codexHome,
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
  // --- Phase 1: teach ---
  const a = await startDaemon(HOME_PRESERVED);
  const s1 = await a.client.createSession({
    id: LOCAL_ID,
    agent: "codex",
    cwd,
    sessionInit,
  });
  rec("phase1-session", { id: s1.id, agentSessionId: s1.agentSessionId });
  try {
    await s1.setModel("gpt-5.6-luna");
  } catch {}
  await runTurn(
    "phase1-teach",
    s1,
    "Remember this codeword: FLAMINGO-42. Reply with exactly: OK",
  );
  const priorAgentSessionId = s1.agentSessionId;
  await a.client.destroySandbox();
  rec("phase1-done", { priorAgentSessionId });

  const seed = async (persist) =>
    persist.updateSession({
      id: LOCAL_ID,
      agent: "codex",
      agentSessionId: priorAgentSessionId,
      lastConnectionId: "",
      createdAt: Date.now(),
      sessionInit,
    });

  // --- Phase 2: resume with the SAME CODEX_HOME ---
  const b = await startDaemon(HOME_PRESERVED);
  await seed(b.persist);
  const s2 = await b.client.resumeSession(LOCAL_ID);
  const loaded2 = s2.agentSessionId === priorAgentSessionId;
  rec("phase2-resume", {
    agentSessionId: s2.agentSessionId,
    nativeLoad: loaded2,
  });
  try {
    await s2.setModel("gpt-5.6-luna");
  } catch {}
  const ans2 = await runTurn(
    "phase2-ask",
    s2,
    "What codeword did I ask you to remember earlier in this conversation? Reply with just the codeword.",
  );
  await b.client.destroySandbox();
  rec("phase2-done", { nativeLoad: loaded2, answer: ans2 });

  // --- Phase 3: resume with a FRESH CODEX_HOME (auth.json only, runner-ephemeral style) ---
  rmSync(HOME_FRESH, { recursive: true, force: true });
  mkdirSync(HOME_FRESH, { recursive: true });
  cpSync(`${HOME_PRESERVED}/auth.json`, `${HOME_FRESH}/auth.json`);
  writeFileSync(
    `${HOME_FRESH}/config.toml`,
    readFileSync(`${HOME_PRESERVED}/config.toml`),
  );
  const c = await startDaemon(HOME_FRESH);
  await seed(c.persist);
  let s3;
  let phase3Error = null;
  try {
    s3 = await c.client.resumeSession(LOCAL_ID);
  } catch (err) {
    phase3Error = String(err);
  }
  if (s3) {
    const loaded3 = s3.agentSessionId === priorAgentSessionId;
    rec("phase3-resume", {
      agentSessionId: s3.agentSessionId,
      nativeLoad: loaded3,
    });
    try {
      await s3.setModel("gpt-5.6-luna");
    } catch {}
    const ans3 = await runTurn(
      "phase3-ask",
      s3,
      "What codeword did I ask you to remember earlier in this conversation? Reply with just the codeword.",
    );
    rec("phase3-done", { nativeLoad: loaded3, answer: ans3 });
  } else {
    rec("phase3-resume-error", { error: phase3Error });
  }
  await c.client.destroySandbox().catch(() => {});
} catch (err) {
  rec("fatal", { error: String(err?.stack ?? err) });
} finally {
  clearTimeout(watchdog);
  process.exit(0);
}
