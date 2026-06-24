// Daytona provider: provision a sandbox from the prebuilt snapshot (sandbox-agent +
// claude + codex + opencode + pi + geesefs all baked in — see daytona_snapshot.js),
// mount the session's bucket prefix from the ngrok tunnel, start the agent server, and
// return a connected SDK. Mirrors provider-e2b.js; differs only in the SDK calls and that
// the agent port is reached via Daytona's preview link (url + token header).
//
// Requires Tier 3+ egress (Tier 1/2 blocks the tunnel PUT). Build the snapshot once:
//   node daytona_snapshot.js
import { Daytona } from "@daytonaio/sdk";
import { SandboxAgent } from "sandbox-agent";

const NGROK_API = process.env.NGROK_API_URL || "http://ngrok:4040/api/tunnels";
const S3_KEY = process.env.SEAWEEDFS_S3_ACCESS_KEY || "demo";
const S3_SECRET = process.env.SEAWEEDFS_S3_SECRET_KEY || "demosecret";
const BUCKET = process.env.SEAWEEDFS_S3_BUCKET || "demo";
const AGENT_PORT = 2468;
const SNAPSHOT = process.env.DAYTONA_SNAPSHOT || "agenta-sandbox-agent";

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });

// The cloud sandbox reaches local SeaweedFS through the ngrok public URL.
async function tunnelUrl() {
  const r = await fetch(NGROK_API);
  if (!r.ok) throw new Error(`ngrok api ${r.status} — is the tunnel up? (compose --profile remote up -d ngrok)`);
  const d = await r.json();
  const t = (d.tunnels || []).find((x) => x.public_url?.startsWith("https"));
  if (!t) throw new Error("no https ngrok tunnel found");
  return t.public_url;
}

async function exec(sbx, cmd, timeout = 240, allowFail = false) {
  const r = await sbx.process.executeCommand(cmd, undefined, undefined, timeout);
  if (r.exitCode !== 0 && !allowFail)
    throw new Error(`daytona cmd failed (${r.exitCode}): ${cmd}\n${String(r.result || "").slice(0, 500)}`);
  return r;
}

// Bring a snapshot-based sandbox up to "ready": geesefs mounted + sandbox-agent serving.
// The agents live under /root, so the server runs as root; cwd is /root/work.
async function prepare(sbx, sid, endpoint, agentEnv) {
  const cwd = "/root/work";

  // codex auth.json (the ACP adapter authenticates from this file, not just env)
  if (agentEnv.OPENAI_API_KEY)
    await exec(sbx, `mkdir -p /root/.codex && printf '{"OPENAI_API_KEY":"%s"}' '${agentEnv.OPENAI_API_KEY}' > /root/.codex/auth.json`, 30, true);
  // pi: trust projects so non-interactive RPC sessions don't block on a trust prompt
  await exec(sbx, `mkdir -p /root/.config/pi && printf '{"defaultProjectTrust":"trusted"}' > /root/.config/pi/settings.json`, 30, true);

  // mount the bucket prefix as cwd via the tunnel. A stale FUSE endpoint reports as a
  // mountpoint but errors "Transport endpoint is not connected" — treat as unmounted.
  const m = await exec(sbx, `ls ${cwd} >/dev/null 2>&1 && mountpoint -q ${cwd} && echo yes || echo no`, 30, true);
  if (!String(m.result || "").includes("yes")) {
    await exec(sbx, `fusermount -u ${cwd} 2>/dev/null; umount -l ${cwd} 2>/dev/null; mkdir -p ${cwd}; true`, 30, true);
    await exec(
      sbx,
      `AWS_ACCESS_KEY_ID=${S3_KEY} AWS_SECRET_ACCESS_KEY=${S3_SECRET} ` +
        `geesefs --endpoint ${endpoint} --region us-east-1 --no-detect --fsync-on-close ` +
        `-o allow_other ${BUCKET}:${sid} ${cwd} && echo MOUNT_OK`,
      90,
    );
  }

  // start the sandbox-agent server with agent creds in its env, if not serving. Daytona's
  // executeCommand always BLOCKS until the process exits — a backgrounded `&` keeps the exec
  // session's stdout open and never returns. Use a process SESSION with runAsync:true (the
  // SDK's fire-and-forget) so the long-lived server detaches cleanly.
  const up = await exec(sbx, `curl -sf http://localhost:${AGENT_PORT}/v1/health >/dev/null && echo up || echo down`, 20, true);
  if (!String(up.result || "").includes("up")) {
    const envExports = Object.entries(agentEnv).map(([k, v]) => `${k}='${v}'`).join(" ");
    const ssid = "agent-server";
    await sbx.process.deleteSession(ssid).catch(() => {});
    await sbx.process.createSession(ssid);
    await sbx.process.executeSessionCommand(ssid, {
      command: `${envExports} sandbox-agent server --no-token --host 0.0.0.0 --port ${AGENT_PORT} >/tmp/sa.log 2>&1`,
      runAsync: true,
    });
    await exec(sbx, `for i in $(seq 1 40); do curl -sf http://localhost:${AGENT_PORT}/v1/health >/dev/null && echo UP && exit 0; sleep 1; done; cat /tmp/sa.log; exit 1`, 60);
  }
  return cwd;
}

// Returns { session, sandboxId, cwd, flush } for the daytona provider.
export async function daytonaSession({ sid, harness, sandboxId, mode, model, thoughtLevel, agentEnv }) {
  const endpoint = await tunnelUrl();

  let sbx = null;
  if (sandboxId) {
    try {
      sbx = await daytona.get(sandboxId);
      if (sbx.state === "stopped") await daytona.start(sbx);
    } catch {
      sbx = null; // gone — recreate below, geesefs remounts the same prefix
    }
  }
  if (!sbx) sbx = await daytona.create({ snapshot: SNAPSHOT }, { timeout: 300 });

  const cwd = await prepare(sbx, sid, endpoint, agentEnv);
  const preview = await sbx.getPreviewLink(AGENT_PORT);
  const headers = preview.token ? { "x-daytona-preview-token": preview.token } : undefined;
  const sdk = await SandboxAgent.connect({ baseUrl: preview.url, headers });
  const init = { id: sid, agent: harness, cwd, mode };
  if (model) init.model = model;
  if (thoughtLevel) init.thoughtLevel = thoughtLevel;
  const session = await sdk.resumeOrCreateSession(init);

  return {
    session,
    sandboxId: sbx.id,
    cwd,
    flush: async () => {
      try { await exec(sbx, "sync; sync", 30, true); } catch {}
    },
  };
}

export async function daytonaKill(sandboxId) {
  const sbx = await daytona.get(sandboxId);
  await sbx.delete(60);
}
