// FUSE-in-E2B gate test: prove geesefs can mount SeaweedFS (via the ngrok tunnel)
// inside an E2B sandbox and that writes land in the bucket. If this fails, we don't
// ship E2B (durable cwd is mandatory).
//
// Usage (from the demo dir):
//   docker compose --profile remote up -d ngrok
//   TUNNEL=$(curl -s localhost:4040/api/tunnels | jq -r '.tunnels[0].public_url')
//   docker run --rm --network persistent-sessions-demo_default \
//     -e E2B_API_KEY -e TUNNEL -e S3_KEY=demo -e S3_SECRET=demosecret \
//     -v "$PWD/e2b-smoketest:/app" -w /app node:22-bookworm-slim \
//     sh -c "npm i --silent @e2b/code-interpreter && node smoke.mjs"

import { Sandbox } from "@e2b/code-interpreter";

const TUNNEL = process.env.TUNNEL;            // https://xxxx.ngrok-free.app
const S3_KEY = process.env.S3_KEY || "demo";
const S3_SECRET = process.env.S3_SECRET || "demosecret";
const BUCKET = "demo";
const SID = "smoketest";

if (!TUNNEL) throw new Error("TUNNEL env (ngrok public url) required");
const GEESEFS_URL =
  "https://github.com/yandex-cloud/geesefs/releases/latest/download/geesefs-linux-amd64";

async function sh(sbx, cmd, opts = {}) {
  const r = await sbx.commands.run(cmd, { timeoutMs: 180000, ...opts });
  console.log(`$ ${cmd}\n  exit=${r.exitCode}${r.stderr ? "\n  stderr: " + r.stderr.slice(0, 400) : ""}`);
  return r;
}

const sbx = await Sandbox.create({ timeoutMs: 300000 });
console.log("E2B sandbox:", sbx.sandboxId);
try {
  // 1) FUSE available? (the load-bearing question)
  await sh(sbx, "ls -l /dev/fuse || echo NO_FUSE_DEVICE");
  await sh(sbx, "sudo apt-get update -qq && sudo apt-get install -y -qq fuse || echo APT_FAIL");

  // 2) geesefs binary
  await sh(sbx, `curl -fsSL -o /tmp/geesefs ${GEESEFS_URL} && chmod +x /tmp/geesefs && /tmp/geesefs --version`);

  // 3) mount the bucket prefix from the tunnel and write a file.
  // Mount as root but hand ownership to the running user (uid/gid) so non-root writes work.
  const who = await sh(sbx, "id -u; id -g");
  const [uid, gid] = who.stdout.trim().split("\n");
  await sh(sbx, "mkdir -p /home/user/work");
  const mount = await sh(
    sbx,
    `AWS_ACCESS_KEY_ID=${S3_KEY} AWS_SECRET_ACCESS_KEY=${S3_SECRET} ` +
      `sudo -E /tmp/geesefs --endpoint ${TUNNEL} --region us-east-1 --no-detect ` +
      `--uid ${uid} --gid ${gid} --dir-mode 0777 --file-mode 0666 ` +
      `-o allow_other ${BUCKET}:${SID} /home/user/work && echo MOUNT_OK`
  );
  await sh(sbx, "mountpoint /home/user/work && echo IS_MOUNTPOINT || echo NOT_MOUNTPOINT");
  await sh(sbx, "echo 'hello from e2b geesefs' > /home/user/work/e2b-probe.txt && sync && ls -la /home/user/work && echo WRITE_OK");

  const ok = mount.stdout.includes("MOUNT_OK");
  console.log(`\n=== RESULT: geesefs mount in E2B ${ok ? "SUCCEEDED" : "FAILED"} ===`);
  console.log("Now check SeaweedFS for demo/smoketest/e2b-probe.txt to confirm the write landed.");
} finally {
  await sbx.kill();
  console.log("sandbox killed");
}
