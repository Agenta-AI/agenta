// E2B provider path: provision a remote sandbox, install sandbox-agent + geesefs,
// mount the session's bucket prefix from the ngrok tunnel, and return a connected SDK.
//
// Unlike local (a long-lived server we connect() to), each e2b session has its own
// cloud sandbox. We persist its sandboxId (via FastAPI) and reconnect on resume.
import { Sandbox } from "@e2b/code-interpreter";
import { SandboxAgent } from "sandbox-agent";

const NGROK_API = process.env.NGROK_API_URL || "http://ngrok:4040/api/tunnels";
const S3_KEY = process.env.SEAWEEDFS_S3_ACCESS_KEY || "demo";
const S3_SECRET = process.env.SEAWEEDFS_S3_SECRET_KEY || "demosecret";
const BUCKET = process.env.SEAWEEDFS_S3_BUCKET || "demo";
const AGENT_PORT = 2468;
// Prebuilt template: sandbox-agent + claude + codex + geesefs all baked in.
const E2B_TEMPLATE = process.env.E2B_TEMPLATE || "agenta-sandbox-agent";

// The cloud sandbox reaches local SeaweedFS through the ngrok public URL.
async function tunnelUrl() {
  const r = await fetch(NGROK_API);
  if (!r.ok) throw new Error(`ngrok api ${r.status} — is the tunnel up? (compose --profile remote up -d ngrok)`);
  const d = await r.json();
  const t = (d.tunnels || []).find((x) => x.public_url?.startsWith("https"));
  if (!t) throw new Error("no https ngrok tunnel found");
  return t.public_url;
}

async function run(sbx, cmd, opts = {}) {
  const r = await sbx.commands.run(cmd, { timeoutMs: 240000, ...opts });
  if (r.exitCode !== 0 && !opts.allowFail)
    throw new Error(`e2b cmd failed (${r.exitCode}): ${cmd}\n${r.stderr?.slice(0, 500)}`);
  return r;
}

// Bring a template-based sandbox up to "ready": geesefs mounted + sandbox-agent serving.
// Everything (sandbox-agent, claude, codex, geesefs) is already baked into the template,
// so this only mounts the cwd and starts the server. The agents live under /root, so the
// server runs as root; cwd is /root/work.
async function prepare(sbx, sid, endpoint, agentEnv) {
  const cwd = "/root/work";

  // codex auth.json under root (where the server runs)
  if (agentEnv.OPENAI_API_KEY)
    await run(sbx, `sudo sh -c 'mkdir -p /root/.codex && printf '"'"'{"OPENAI_API_KEY":"%s"}'"'"' "${agentEnv.OPENAI_API_KEY}" > /root/.codex/auth.json'`, { allowFail: true });

  // pi: trust projects so non-interactive RPC sessions don't block on a trust prompt
  await run(sbx, `sudo sh -c 'mkdir -p /root/.config/pi && printf '"'"'{"defaultProjectTrust":"trusted"}'"'"' > /root/.config/pi/settings.json'`, { allowFail: true });

  // mount the bucket prefix as cwd via the tunnel (root-owned; server is root)
  const mounted = await run(sbx, `sudo mountpoint -q ${cwd} && echo yes || echo no`);
  if (mounted.stdout.includes("no")) {
    await run(sbx, `sudo mkdir -p ${cwd}`);
    await run(
      sbx,
      `sudo AWS_ACCESS_KEY_ID=${S3_KEY} AWS_SECRET_ACCESS_KEY=${S3_SECRET} ` +
        `/usr/local/bin/geesefs --endpoint ${endpoint} --region us-east-1 --no-detect ` +
        `-o allow_other ${BUCKET}:${sid} ${cwd}`
    );
  }

  // start the sandbox-agent server as root with agent creds in its env.
  // background:true returns immediately without an exit code — do NOT run()-check it.
  const envExports = Object.entries(agentEnv).map(([k, v]) => `${k}='${v}'`).join(" ");
  sbx.commands
    .run(`sudo sh -c "${envExports} exec sandbox-agent server --no-token --host 0.0.0.0 --port ${AGENT_PORT} >/tmp/sa.log 2>&1"`,
      { background: true, timeoutMs: 0 })
    .catch(() => {}); // long-lived; ignore its eventual settle
  // poll health
  await run(sbx, `for i in $(seq 1 40); do curl -sf http://localhost:${AGENT_PORT}/v1/health >/dev/null && echo UP && exit 0; sleep 1; done; sudo cat /tmp/sa.log; exit 1`);
  return cwd;
}

// Returns { sdk, session, sandboxId, cwd, flush, } for the e2b provider.
export async function e2bSession({ sid, harness, sandboxId, mode, model, thoughtLevel, agentEnv }) {
  const endpoint = await tunnelUrl();

  let sbx;
  if (sandboxId) {
    try {
      sbx = await Sandbox.connect(sandboxId, { timeoutMs: 300000 });
    } catch {
      sbx = null; // expired — recreate below, geesefs remounts the same prefix
    }
  }
  if (!sbx) sbx = await Sandbox.create(E2B_TEMPLATE, { timeoutMs: 600000 });

  const cwd = await prepare(sbx, sid, endpoint, agentEnv);
  const baseUrl = `https://${sbx.getHost(AGENT_PORT)}`;
  const sdk = await SandboxAgent.connect({ baseUrl });
  const init = { id: sid, agent: harness, cwd, mode };
  if (model) init.model = model;
  if (thoughtLevel) init.thoughtLevel = thoughtLevel;
  const session = await sdk.resumeOrCreateSession(init);

  return {
    session,
    sandboxId: sbx.sandboxId,
    cwd,
    flush: async () => {
      try { await sbx.commands.run("sync; sync", { timeoutMs: 30000 }); } catch {}
    },
  };
}

export async function e2bKill(sandboxId) {
  await Sandbox.kill(sandboxId);
}
