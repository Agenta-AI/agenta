// Modal provider path. Modal has no Node SDK, so we shell out to modal_bridge.py
// (uses the modal Python SDK) to provision/reconnect a sandbox, mount geesefs from the
// tunnel, start sandbox-agent on :2468 exposed via Modal's own encrypted tunnel, and
// print {sandbox_id, base_url, cwd}. The Node side then connect()s to that base_url.
//
// Auth: MODAL_TOKEN_ID/MODAL_TOKEN_SECRET in env (passed through to the python process).
import { spawn } from "node:child_process";
import { SandboxAgent } from "sandbox-agent";

const NGROK_API = process.env.NGROK_API_URL || "http://ngrok:4040/api/tunnels";
const S3_KEY = process.env.SEAWEEDFS_S3_ACCESS_KEY || "demo";
const S3_SECRET = process.env.SEAWEEDFS_S3_SECRET_KEY || "demosecret";
const BUCKET = process.env.SEAWEEDFS_S3_BUCKET || "demo";
const PYTHON = process.env.MODAL_PYTHON || "python3";
const BRIDGE = new URL("./modal_bridge.py", import.meta.url).pathname;

async function tunnelUrl() {
  const r = await fetch(NGROK_API);
  if (!r.ok) throw new Error(`ngrok api ${r.status} — is the tunnel up? (compose --profile remote up -d ngrok)`);
  const d = await r.json();
  const t = (d.tunnels || []).find((x) => x.public_url?.startsWith("https"));
  if (!t) throw new Error("no https ngrok tunnel found");
  return t.public_url;
}

// Run the python bridge; resolve with the JSON object on its LAST stdout line.
function runBridge(argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(PYTHON, [BRIDGE, ...argv], {
      env: { ...process.env },
    });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => { err += d; process.stderr.write(`[modal] ${d}`); });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error(`modal_bridge ${argv[0]} exit ${code}: ${err.slice(-600)}`));
      const lines = out.trim().split("\n").filter(Boolean);
      try {
        resolve(JSON.parse(lines[lines.length - 1]));
      } catch (e) {
        reject(new Error(`modal_bridge bad output: ${out.slice(-400)}`));
      }
    });
  });
}

// Returns { session, sandboxId, cwd, flush } for the modal provider.
export async function modalSession({ sid, harness, sandboxId, mode, model, thoughtLevel, agentEnv }) {
  const endpoint = await tunnelUrl();
  const argv = [
    "up", "--sid", sid, "--endpoint", endpoint,
    "--s3-key", S3_KEY, "--s3-secret", S3_SECRET, "--bucket", BUCKET,
  ];
  if (sandboxId) argv.push("--sandbox-id", sandboxId);
  if (agentEnv.ANTHROPIC_API_KEY) argv.push("--anthropic", agentEnv.ANTHROPIC_API_KEY);
  if (agentEnv.OPENAI_API_KEY) argv.push("--openai", agentEnv.OPENAI_API_KEY);

  const { sandbox_id, base_url, cwd } = await runBridge(argv);
  const sdk = await SandboxAgent.connect({ baseUrl: base_url });
  const init = { id: sid, agent: harness, cwd, mode };
  if (model) init.model = model;
  if (thoughtLevel) init.thoughtLevel = thoughtLevel;
  const session = await sdk.resumeOrCreateSession(init);

  return {
    session,
    sandboxId: sandbox_id,
    cwd,
    // geesefs --fsync-on-close already lands each write; nothing extra to flush host-side.
    flush: async () => {},
  };
}

export async function modalKill(sandboxId) {
  await runBridge(["kill", "--sandbox-id", sandboxId]);
}
