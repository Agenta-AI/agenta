// Daytona GATE test: (1) outbound internet to the ngrok tunnel (tier check),
// (2) geesefs FUSE mount of SeaweedFS + write. If either fails, we don't ship Daytona.
import { Daytona } from "@daytonaio/sdk";

const TUNNEL = process.env.TUNNEL;
const S3_KEY = process.env.S3_KEY || "demo";
const S3_SECRET = process.env.S3_SECRET || "demosecret";
const BUCKET = "demo";
const SID = "daytona-smoketest";
const GEESEFS_URL =
  "https://github.com/yandex-cloud/geesefs/releases/latest/download/geesefs-linux-amd64";

if (!TUNNEL) throw new Error("TUNNEL env (ngrok url) required");

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });

async function exec(sbx, cmd) {
  const r = await sbx.process.executeCommand(cmd, undefined, undefined, 240);
  console.log(`$ ${cmd}\n  exit=${r.exitCode}` + (r.result ? `\n  out: ${String(r.result).slice(0, 300)}` : ""));
  return r;
}

console.log("creating daytona sandbox (image debian, with sudo)...");
const sbx = await daytona.create({ image: "debian:12.9" }, { timeout: 180 });
console.log("sandbox id:", sbx.id);
try {
  // gate 1: outbound internet to the tunnel
  await exec(sbx, "apt-get update -qq && apt-get install -y -qq curl fuse ca-certificates >/dev/null 2>&1; echo deps-done");
  const egress = await exec(sbx, `curl -s -o /dev/null -w '%{http_code}' --max-time 15 ${TUNNEL} || echo CURL_FAIL`);
  const egressOk = /403|200/.test(String(egress.result));
  console.log(`\n>>> GATE 1 (egress to tunnel): ${egressOk ? "PASS" : "FAIL"} (${String(egress.result).trim()})\n`);

  // gate 2: geesefs FUSE mount + write
  await exec(sbx, `curl -fsSL -o /usr/local/bin/geesefs ${GEESEFS_URL} && chmod +x /usr/local/bin/geesefs && geesefs --version`);
  await exec(sbx, "ls -l /dev/fuse 2>&1 || (echo no-fuse-dev; chmod 666 /dev/fuse 2>&1)");
  await exec(sbx, "mkdir -p /root/work");
  const mount = await exec(
    sbx,
    `AWS_ACCESS_KEY_ID=${S3_KEY} AWS_SECRET_ACCESS_KEY=${S3_SECRET} ` +
      `geesefs --endpoint ${TUNNEL} --region us-east-1 --no-detect -o allow_other ${BUCKET}:${SID} /root/work && echo MOUNT_OK`
  );
  const mountOk = String(mount.result).includes("MOUNT_OK");
  if (mountOk) {
    // write + flush quickly (geesefs mv can be slow; keep it under the exec timeout)
    await exec(sbx, "echo 'hello from daytona geesefs' > /root/work/daytona-probe.txt && sync");
    await exec(sbx, "stat /root/work/daytona-probe.txt; mv /root/work/daytona-probe.txt /root/work/daytona-renamed.txt && sync; ls -la /root/work && echo WRITE_MV_OK");
  }
  console.log(`\n>>> GATE 2 (geesefs FUSE mount+write+mv): ${mountOk ? "PASS" : "FAIL"}\n`);
  console.log(`=== DAYTONA VERDICT: ${egressOk && mountOk ? "VIABLE — ship it" : "BLOCKED — do not ship"} ===`);
} finally {
  await daytona.delete(sbx);
  console.log("sandbox deleted");
}
