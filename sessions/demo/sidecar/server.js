// Node sidecar: owns the sandbox-agent TS SDK; FastAPI calls this over HTTP.
// Responsibilities:
//   - ensure a per-session geesefs mount (demo:<sid> -> /work/<sid>) inside the sandbox
//   - create/resume an ACP "claude" session with cwd=/work/<sid>
//   - stream ACP events back to FastAPI as NDJSON (so it can persist them live)
//   - flush geesefs write-back before returning
import express from "express";
import { SandboxAgent } from "sandbox-agent";
import { makePersist } from "./session-persist.js";

const AGENT_URL = process.env.SANDBOX_AGENT_URL || "http://sandbox:2468";
const API_URL = process.env.API_URL || "http://fastapi:8000";
const S3_ENDPOINT = process.env.SEAWEEDFS_S3_URL || "http://seaweedfs:8333";
const S3_KEY = process.env.SEAWEEDFS_S3_ACCESS_KEY || "demo";
const S3_SECRET = process.env.SEAWEEDFS_S3_SECRET_KEY || "demosecret";
const BUCKET = process.env.SEAWEEDFS_S3_BUCKET || "demo";
const PORT = 8080;

// Survive a single run's network failure. An ACP request (e.g. a sandbox-agent call) can reject
// with a HeadersTimeout from deep inside the SDK's async machinery, where no try/catch of ours
// can reach it. Without these guards that one rejection crashes the WHOLE sidecar process (and
// `node --watch` then parks it until a file change), so every subsequent /invoke gets a
// ConnectError. Log and keep serving instead — the failed run is already lost, the server isn't.
process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", String(err?.stack || err).slice(0, 300));
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", String(err?.stack || err).slice(0, 300));
});

// PERSISTENCE PATH — producer-driven and 100% independent of any /invoke client. As rivet
// produces each transcript event we POST it to FastAPI's /events ingest, so the transcript is
// durable whether or not a browser is connected, attached, or watching. The NDJSON view stream
// is a SEPARATE, disposable concern (see emit() in /run). Best-effort: a persist failure must
// not break the run (the SDK's own replay store is a backstop).
//
// Events MUST persist in produced-order (the DB assigns a dense per-session seq at insert), so
// we serialize per session through a promise chain instead of firing POSTs concurrently. The
// caller does NOT await the chain — the run is never blocked on persistence — but the writes
// themselves land in order.
const PERSIST_DEBUG = process.env.PERSIST_DEBUG === "1";
async function postEvent(sid, evt) {
  // bounded retry: a transient ingest failure must not silently drop an event from the
  // transcript (the durable record). Each event persists in produced-order via the chain.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(`${API_URL}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sid, ...evt }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (PERSIST_DEBUG) console.log(`[persist ${sid}] ok su=${evt.session_update} idx=${evt.event_index} try=${attempt}`);
      return;
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 100 * attempt));
    }
  }
  console.warn(`[persist ${sid}] DROPPED su=${evt.session_update} after retries: ${String(lastErr?.message).slice(0, 80)}`);
}

const persistChains = new Map(); // sid -> tail Promise
function persistEvent(sid, evt) {
  const tail = (persistChains.get(sid) || Promise.resolve()).then(() => postEvent(sid, evt));
  persistChains.set(sid, tail);
  return tail;
}

// Wait for all queued persists for a session to land. The run does NOT block on persistence
// mid-stream (so it stays responsive), but it MUST NOT report _done — or tear down a sandbox —
// until its own events are durable, or the last agent_message can be lost to the teardown race
// (notably on a force-takeover, whose cancel/recreate skews the timing). Drains then prunes.
async function drainPersist(sid) {
  const tail = persistChains.get(sid);
  if (!tail) return;
  await tail;
  if (persistChains.get(sid) === tail) persistChains.delete(sid);
}

// Persist the remote sandbox id (for resume) independently of the view stream, so a detached
// run still records where it ran. null clears it (docker teardown). Best-effort.
async function persistSandboxId(sid, sandboxId) {
  try {
    await fetch(`${API_URL}/sessions/${sid}/sandbox-id`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sandbox_id: sandboxId }),
    });
  } catch (e) { console.warn(`[persist-sbx ${sid}] ${e?.message?.slice(0, 80)}`); }
}

// --- raw sandbox-agent REST helpers (process API: run shell inside the sandbox) ---
async function runInSandbox(script, env = {}) {
  const res = await fetch(`${AGENT_URL}/v1/processes/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      command: "bash",
      args: ["-lc", script],
      env,
      waitForExit: true,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`runInSandbox failed (${res.status}): ${text}`);
  const out = JSON.parse(text);
  if (out.exitCode !== 0)
    throw new Error(`runInSandbox exit ${out.exitCode}: ${out.stderr || out.stdout}`);
  return out.stdout || "";
}

// geesefs mount is idempotent: skip if /work/<sid> is already a mountpoint.
async function ensureMount(sid) {
  const mnt = `/work/${sid}`;
  const cmd = [
    `mkdir -p ${mnt}`,
    `if mountpoint -q ${mnt}; then echo "already-mounted"; exit 0; fi`,
    // path-style addressing = no --subdomain; --no-detect skips AWS autodetection
    `geesefs --endpoint ${S3_ENDPOINT} --region us-east-1 --no-detect ` +
      `-o allow_other ${BUCKET}:${sid} ${mnt}`,
    `echo "mounted"`,
  ].join(" && ");
  const out = await runInSandbox(cmd, {
    AWS_ACCESS_KEY_ID: S3_KEY,
    AWS_SECRET_ACCESS_KEY: S3_SECRET,
  });
  console.log(`[mount ${sid}] ${out.trim()}`);
}

// Flush geesefs write-back cache to S3 before we consider the turn durable.
async function flushMount(sid) {
  try {
    await runInSandbox(`sync; sync`);
  } catch (e) {
    console.warn(`[flush ${sid}] ${e.message}`);
  }
}

// Unmount + remove the cwd dir (used on session delete). Best-effort, idempotent.
async function unmount(sid) {
  const mnt = `/work/${sid}`;
  await runInSandbox(
    `fusermount -u ${mnt} 2>/dev/null || umount -l ${mnt} 2>/dev/null || true; ` +
      `rmdir ${mnt} 2>/dev/null || true; echo unmounted`
  );
  console.log(`[unmount ${sid}] done`);
}

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

// POST /unmount { session_id } — tear down the geesefs mount + cwd dir (on delete).
app.post("/unmount", async (req, res) => {
  const sid = req.body?.session_id;
  if (!sid) return res.status(400).json({ error: "session_id required" });
  try {
    await unmount(sid);
    res.json({ unmounted: sid });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// POST /kill { sandbox, sandbox_id } — destroy a remote sandbox (cwd stays durable in S3).
app.post("/kill", async (req, res) => {
  const { sandbox, sandbox_id } = req.body || {};
  if (!sandbox_id) return res.status(400).json({ error: "sandbox_id required" });
  try {
    if (!["daytona", "e2b", "modal", "docker"].includes(sandbox))
      return res.status(400).json({ error: `kill not supported for sandbox '${sandbox}'` });
    if (sandbox === "modal") {
      const { modalKill } = await import("./provider-modal.js");
      await modalKill(sandbox_id);
    } else {
      // the provider's own kill()/destroy() — no running agent needed to tear a sandbox down.
      const { makeProvider } = await import("./sandbox-provider.js");
      const provider = makeProvider(sandbox, { sid: "kill", agentEnv: {} });
      await (provider.kill ?? provider.destroy).call(provider, sandbox_id);
    }
    res.json({ killed: sandbox_id });
  } catch (e) {
    // idempotent: a sandbox that's already gone (cloud GC'd, container removed) IS the
    // desired end state — report success so the caller clears the stale sandbox_id, instead
    // of a 500 that leaves a dead-but-unkillable "live" badge in the UI.
    const msg = String(e?.message || e);
    if (/not\s*found|no such|does not exist|404|destroyed|terminated/i.test(msg)) {
      console.warn(`[/kill ${sandbox}] sandbox already gone: ${msg.slice(0, 100)}`);
      return res.json({ killed: sandbox_id, note: "already gone" });
    }
    res.status(500).json({ error: msg });
  }
});

// Per-harness session mode. claude/codex have an auto-accept mode; opencode uses its
// default 'build' and pi has no modes — both rely on the onPermissionRequest backstop.
const HARNESS_MODE = { claude: "acceptEdits", codex: "agent-full-access", opencode: "build" };

// reasoning (none|low|medium|high) -> per-harness thoughtLevel. 'none' = pass nothing.
// claude/opencode accept low|medium|high; codex maps to its effort tiers; pi uses
// off|low|medium|high|xhigh thought levels. We forward the canonical token and let the
// adapter map/ignore; 'none' means we don't set a level at all.
function thoughtLevelFor(harness, reasoning) {
  if (!reasoning || reasoning === "none") return undefined;
  return reasoning; // low|medium|high pass through; adapters normalize
}

// Auto-approve permission backstop (modes above usually skip prompts).
function autoApprove(session) {
  session.onPermissionRequest?.((reqEvt) => {
    const opts = reqEvt?.options || [];
    const pick =
      opts.find((o) => /allow.*always|always/i.test(o.kind || o.name || "")) ||
      opts.find((o) => /allow/i.test(o.kind || o.name || "")) ||
      opts.find((o) => !/reject|deny/i.test(o.kind || o.name || "")) ||
      opts[0];
    session.respondPermission?.(reqEvt.id, { optionId: pick?.optionId ?? pick?.id, allow: true });
  });
}

// On resume the SDK prepends the prior transcript to the live prompt as a synthetic text
// block (prefix below) so the agent has context. That injected block flows back as a client
// session/prompt event — if we persisted it, the NEXT resume would replay a transcript that
// already contains a replay, nesting (and doubling) the context every turn. Strip the
// injected block before storing so the transcript only ever holds the real user prompt.
const REPLAY_PREFIX = "Previous session history is replayed below as JSON-RPC envelopes.";
function stripReplay(payload) {
  const prompt = payload?.params?.prompt;
  if (payload?.method !== "session/prompt" || !Array.isArray(prompt)) return payload;
  const cleaned = prompt.filter((p) => !(p?.type === "text" && p.text?.startsWith(REPLAY_PREFIX)));
  if (cleaned.length === prompt.length) return payload;
  return { ...payload, params: { ...payload.params, prompt: cleaned } };
}

// Stream a prompt's events to `write`, coalescing agent_message_chunks into agent_message.
// If `lock` is given, register a cancel fn so a force-takeover can interrupt this live prompt.
// The SDK forbids a manual "session/cancel" RPC; the supported interrupt is the owning
// client's destroySession(id), which sends the cancel internally and makes the in-flight
// prompt() resolve (stopReason "cancelled"). The stream then ends cleanly and the run's
// finally releases the lock. (The session is recreated on the next resume anyway.)
async function streamSession(session, prompt, emit, lock, client) {
  autoApprove(session);
  lock?.setCancel(async () => {
    try {
      await client.destroySession(session.id);
    } catch (e) { console.warn(`[cancel] ${e?.message?.slice(0, 80)}`); }
  });
  let buf = null;
  const flushBuf = () => {
    if (!buf) return;
    emit({
      event_index: buf.evt.eventIndex, sender: buf.evt.sender, session_update: "agent_message",
      payload: { method: "session/update", params: {
        sessionId: buf.evt.payload?.params?.sessionId,
        update: { sessionUpdate: "agent_message", messageId: buf.messageId,
                  content: { type: "text", text: buf.text } } } },
    });
    buf = null;
  };
  const unsub = session.onEvent((evt) => {
    const upd = evt.payload?.params?.update ?? evt.payload;
    const su = upd?.sessionUpdate ?? null;
    if (su === "agent_message_chunk") {
      const mid = upd.messageId;
      if (buf && buf.messageId !== mid) flushBuf();
      if (!buf) buf = { messageId: mid, text: "", evt };
      buf.text += upd.content?.text ?? "";
      return;
    }
    flushBuf();
    // The SDK sometimes emits a standalone (non-chunk) agent_message with EMPTY text as a
    // turn artifact — the real text already arrived via chunks (flushed just above). Persisting
    // the empty one would shadow the good message in the transcript, so drop empties.
    if (su === "agent_message" && !((upd?.content?.text ?? "").length)) return;
    emit({ event_index: evt.eventIndex, sender: evt.sender, session_update: su, payload: stripReplay(evt.payload) });
  });
  const result = await session.prompt(
    Array.isArray(prompt) ? prompt : [{ type: "text", text: String(prompt) }]
  );
  unsub?.();
  flushBuf();
  return result;
}

// POST /run  { session_id, prompt, sandbox, harness, provider, model, reasoning, sandbox_id? }
// Streams NDJSON: one line per ACP event, then a final {"_done": true, stop_reason, sandbox_id?}.
app.post("/run", async (req, res) => {
  const {
    session_id: sid, prompt, data, sandbox = "local", harness = "claude",
    provider = "anthropic", model = null, reasoning = "none", sandbox_id,
    force = false,
  } = req.body;
  if (!sid) return res.status(400).json({ error: "session_id required" });

  // CONTROL PLANE: data === null = no work, intent only. The only control intent that reaches
  // the sidecar is CANCEL (data=null + force): cancel the alive holder, run nothing. (ATTACH is
  // FastAPI-only — it just holds `attached` + polls the transcript, never calls the sidecar.)
  if (data === null) {
    const { cancel } = await import("./run-lock.js");
    if (!force) return res.status(400).json({ error: "control invoke (data=null) requires force" });
    const cancelled = await cancel(sid); // cancels the local holder; its /run unwinds + releases live
    return res.json({ cancelled });
  }

  if (!prompt) return res.status(400).json({ error: "session_id and prompt required" });
  if (!["local", "daytona", "e2b", "modal", "docker"].includes(sandbox))
    return res.status(400).json({ error: `sandbox '${sandbox}' not supported yet` });

  // ALIVE lock: one in-flight run per session. force=true cancels the current holder (graceful
  // ACP cancel) and takes over; force=false replies 409 "in use" (no queue). Acquire BEFORE the
  // NDJSON stream so 409 is a clean HTTP status, not a mid-stream frame.
  const { acquire, status } = await import("./run-lock.js");
  let lock;
  try {
    lock = await acquire(sid, { force: !!force });
  } catch (e) {
    if (e.code === "in_use") {
      // Tell the caller WHICH kind of busy this is: a detached alive run is reattachable
      // (the driving client left); an attached one is being watched -> force to take over.
      const st = await status(sid); // { alive, attached }
      return res.status(409).json({
        code: "in_use",
        alive: st.alive,
        attached: st.attached,
        reattachable: st.alive && !st.attached,
      });
    }
    return res.status(500).json({ error: String(e?.message || e) });
  }

  res.setHeader("content-type", "application/x-ndjson");
  // NOTE: the sidecar owns only the ALIVE lock. The ATTACHED lock (is a BROWSER watching?) is
  // owned by FastAPI, which sits at the browser boundary — a client leaving must NOT cancel
  // this run, and the sidecar can't observe the browser anyway. A dropped FastAPI<->sidecar
  // socket here just stops the (no-op) view writes; the run keeps executing to completion.
  //
  // Two independent sinks:
  //   view(obj)   — push to the live NDJSON response (best-effort; no-op once the socket closes)
  //   emit(evt)   — a TRANSCRIPT event: PERSIST it (durable, client-independent) AND view it
  // Control frames (_done / _sandbox_id) use view() only: FastAPI consumes them from the live
  // stream. _sandbox_id is persisted separately (persistSandboxId) so resume survives a detach.
  const view = (obj) => { try { res.write(JSON.stringify(obj) + "\n"); } catch {} };
  const emit = (evt) => { persistEvent(sid, evt); view(evt); };
  const mode = HARNESS_MODE[harness];                 // undefined for pi (no modes)
  const thoughtLevel = thoughtLevelFor(harness, reasoning);
  // model is keyed by provider; null/empty -> let the harness use its default model.
  const sessionInit = { id: sid, agent: harness, mode };
  if (model) sessionInit.model = model;
  if (thoughtLevel) sessionInit.thoughtLevel = thoughtLevel;

  try {
    if (sandbox === "local") {
      // local = the long-lived compose `sandbox` container; geesefs mounts to seaweedfs
      // directly (no tunnel), creds already in the container env. Just connect + run.
      await ensureMount(sid);
      const sdk = await SandboxAgent.connect({ baseUrl: AGENT_URL, persist: makePersist() });
      const session = await sdk.resumeOrCreateSession({ ...sessionInit, cwd: `/work/${sid}` });
      const result = await streamSession(session, prompt, emit, lock, sdk);
      await flushMount(sid);
      await drainPersist(sid); // all events durable before _done
      view({ _done: true, stop_reason: result?.stopReason ?? "end_turn" });
    } else if (sandbox === "modal") {
      // modal stays on the dedicated Python-bridge provider (the Node modal SDK needs a
      // separately-baked Modal image; the bridge already bakes one and works e2e).
      const agentEnv = {};
      if (process.env.ANTHROPIC_API_KEY) agentEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
      if (process.env.OPENAI_API_KEY) agentEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      const { modalSession } = await import("./provider-modal.js");
      const remote = await modalSession({ sid, harness, sandboxId: sandbox_id, mode, model, thoughtLevel, agentEnv });
      persistSandboxId(sid, remote.sandboxId); view({ _sandbox_id: remote.sandboxId });
      const result = await streamSession(remote.session, prompt, emit, lock, remote.client);
      await remote.flush();
      await drainPersist(sid);
      view({ _done: true, stop_reason: result?.stopReason ?? "end_turn", sandbox_id: remote.sandboxId });
    } else {
      // daytona/e2b/docker: the SDK provider drives create/reconnect/getUrl/destroy; our
      // withGeesefs wrapper adds the durable cwd (mount demo:<sid> over the tunnel + seed
      // auth). SandboxAgent.start() runs the whole lifecycle from one provider object.
      const { makeProvider, CWD } = await import("./sandbox-provider.js");
      const agentEnv = {};
      if (process.env.ANTHROPIC_API_KEY) agentEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
      if (process.env.OPENAI_API_KEY) agentEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      const provider = makeProvider(sandbox, { sid, agentEnv });
      // Resume: reconnect to the recorded sandbox. If it's GONE (docker is AutoRemove, a
      // cloud sandbox may have been GC'd), start() throws on reconnect/getUrl — fall back to
      // a fresh sandbox, which remounts the same demo:<sid> prefix, so the durable cwd in
      // SeaweedFS is preserved. This is the whole point of the geesefs layer.
      let agent;
      try {
        agent = await SandboxAgent.start({ sandbox: provider, sandboxId: sandbox_id || undefined, persist: makePersist() });
      } catch (e) {
        if (!sandbox_id) throw e;
        console.warn(`[/run ${sandbox}] resume of ${sandbox_id} failed (${e?.message?.slice(0, 80)}); recreating`);
        agent = await SandboxAgent.start({ sandbox: provider, persist: makePersist() });
      }
      persistSandboxId(sid, agent.sandboxId); view({ _sandbox_id: agent.sandboxId }); // for resume
      const session = await agent.resumeOrCreateSession({ ...sessionInit, cwd: CWD });
      const result = await streamSession(session, prompt, emit, lock, agent);
      await drainPersist(sid); // events durable BEFORE any teardown (docker kills the container)
      // docker is fresh-per-turn: the container runs `sleep infinity` so AutoRemove never
      // fires on its own. Tear it down after the turn (cwd is durable in SeaweedFS; resume
      // recreates + remounts). Cloud sandboxes are kept for fast resume. Sequence matters:
      // flush geesefs, DISPOSE the agent (closes the ACP connection) so killing the container
      // doesn't yank it out from under in-flight requests, THEN destroy. All best-effort —
      // the work is already durable, so teardown errors must not fail the turn.
      let finalSandboxId = agent.sandboxId;
      if (sandbox === "docker") {
        // geesefs mounts with --fsync-on-close, so the agent's writes are already durable on
        // close (proven by the resume test). dispose() closes the ACP connection cleanly
        // before we destroy the container, avoiding "other side closed" on in-flight requests.
        try { await agent.dispose(); } catch {}
        try { await agent.killSandbox(); } catch (e) { console.warn(`[/run docker] teardown: ${e?.message?.slice(0, 80)}`); }
        finalSandboxId = null;
        persistSandboxId(sid, null); view({ _sandbox_id: null }); // clear it
      }
      view({ _done: true, stop_reason: result?.stopReason ?? "end_turn", sandbox_id: finalSandboxId });
    }
    res.end();
  } catch (err) {
    console.error("[/run] error", err);
    view({ _done: true, error: String(err?.stack || err) });
    res.end();
  } finally {
    await lock.release(); // free the session for the next run (or the force-taker)
  }
});

// GET /files?session_id=&path=  -> proxy sandbox-agent fs listing (live view)
app.get("/files", async (req, res) => {
  const { session_id: sid, path = "" } = req.query;
  const abs = `/work/${sid}/${path}`.replace(/\/+$/, "") || `/work/${sid}`;
  try {
    const r = await fetch(`${AGENT_URL}/v1/fs/entries?path=${encodeURIComponent(abs)}`);
    res.status(r.status).type("application/json").send(await r.text());
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.listen(PORT, () => console.log(`sidecar listening on :${PORT}, agent=${AGENT_URL}`));
