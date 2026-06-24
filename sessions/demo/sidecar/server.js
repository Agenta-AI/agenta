// Node sidecar: owns the sandbox-agent TS SDK; FastAPI calls this over HTTP.
// Responsibilities:
//   - ensure a per-session geesefs mount (demo:<sid> -> /work/<sid>) inside the sandbox
//   - create/resume an ACP "claude" session with cwd=/work/<sid>
//   - stream ACP events back to FastAPI as NDJSON (so it can persist them live)
//   - flush geesefs write-back before returning
import express from "express";
import { SandboxAgent } from "sandbox-agent";

const AGENT_URL = process.env.SANDBOX_AGENT_URL || "http://sandbox:2468";
const S3_ENDPOINT = process.env.SEAWEEDFS_S3_URL || "http://seaweedfs:8333";
const S3_KEY = process.env.SEAWEEDFS_S3_ACCESS_KEY || "demo";
const S3_SECRET = process.env.SEAWEEDFS_S3_SECRET_KEY || "demosecret";
const BUCKET = process.env.SEAWEEDFS_S3_BUCKET || "demo";
const PORT = 8080;

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
    if (sandbox === "e2b") {
      const { e2bKill } = await import("./provider-e2b.js");
      await e2bKill(sandbox_id);
    } else if (sandbox === "modal") {
      const { modalKill } = await import("./provider-modal.js");
      await modalKill(sandbox_id);
    } else {
      return res.status(400).json({ error: `kill not supported for sandbox '${sandbox}'` });
    }
    res.json({ killed: sandbox_id });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
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

// Stream a prompt's events to `write`, coalescing agent_message_chunks into agent_message.
async function streamSession(session, prompt, write) {
  autoApprove(session);
  let buf = null;
  const flushBuf = () => {
    if (!buf) return;
    write({
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
    write({ event_index: evt.eventIndex, sender: evt.sender, session_update: su, payload: evt.payload });
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
    session_id: sid, prompt, sandbox = "local", harness = "claude",
    provider = "anthropic", model = null, reasoning = "none", sandbox_id,
  } = req.body;
  if (!sid || !prompt) return res.status(400).json({ error: "session_id and prompt required" });
  if (!["local", "e2b", "modal"].includes(sandbox))
    return res.status(400).json({ error: `sandbox '${sandbox}' not supported yet` });

  res.setHeader("content-type", "application/x-ndjson");
  const write = (obj) => res.write(JSON.stringify(obj) + "\n");
  const mode = HARNESS_MODE[harness];                 // undefined for pi (no modes)
  const thoughtLevel = thoughtLevelFor(harness, reasoning);
  // model is keyed by provider; null/empty -> let the harness use its default model.
  const sessionInit = { id: sid, agent: harness, mode };
  if (model) sessionInit.model = model;
  if (thoughtLevel) sessionInit.thoughtLevel = thoughtLevel;

  try {
    if (sandbox === "local") {
      await ensureMount(sid);
      const sdk = await SandboxAgent.connect({ baseUrl: AGENT_URL });
      const session = await sdk.resumeOrCreateSession({ ...sessionInit, cwd: `/work/${sid}` });
      const result = await streamSession(session, prompt, write);
      await flushMount(sid);
      write({ _done: true, stop_reason: result?.stopReason ?? "end_turn" });
    } else {
      // remote (e2b/modal): provision/reconnect a cloud sandbox, mount geesefs via the
      // tunnel, start the agent server, run. Both providers share this shape.
      const agentEnv = {};
      if (process.env.ANTHROPIC_API_KEY) agentEnv.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
      if (process.env.OPENAI_API_KEY) agentEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
      const opts = { sid, harness, sandboxId: sandbox_id, mode, model, thoughtLevel, agentEnv };
      let remote;
      if (sandbox === "e2b") {
        const { e2bSession } = await import("./provider-e2b.js");
        remote = await e2bSession(opts);
      } else {
        const { modalSession } = await import("./provider-modal.js");
        remote = await modalSession(opts);
      }
      write({ _sandbox_id: remote.sandboxId }); // tell FastAPI to persist it for resume
      const result = await streamSession(remote.session, prompt, write);
      await remote.flush();
      write({ _done: true, stop_reason: result?.stopReason ?? "end_turn", sandbox_id: remote.sandboxId });
    }
    res.end();
  } catch (err) {
    console.error("[/run] error", err);
    write({ _done: true, error: String(err?.stack || err) });
    res.end();
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
