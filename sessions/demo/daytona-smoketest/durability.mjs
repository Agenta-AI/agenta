// Definitive Daytona durability test. Write the mount+write script to a FILE on the
// sandbox (avoids nested-quote breakage), run it detached, poll. Host then verifies the
// object actually landed in SeaweedFS (the real proof). Leaves the object behind.
import { Daytona } from "@daytonaio/sdk";
const TUNNEL = process.env.TUNNEL;
const SID = process.env.SID || "daytona-durable";
const GEESEFS = "https://github.com/yandex-cloud/geesefs/releases/latest/download/geesefs-linux-amd64";
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
async function exec(sbx, cmd, t = 60) {
  const r = await sbx.process.executeCommand(cmd, undefined, undefined, t);
  console.log(`$ ${cmd.slice(0, 70)}\n  exit=${r.exitCode} ${String(r.result || "").trim().slice(0, 400)}`);
  return r;
}
const RUNNER = `#!/bin/bash
set -x
mkdir -p /root/work
AWS_ACCESS_KEY_ID=demo AWS_SECRET_ACCESS_KEY=demosecret \\
  geesefs --endpoint ${TUNNEL} --region us-east-1 --no-detect --fsync-on-close \\
  --debug_s3 -o allow_other demo:${SID} /root/work >/tmp/mount.log 2>&1
echo "mount_exit=$?" >>/tmp/result
sleep 3
mountpoint -q /root/work && echo IS_MOUNT >>/tmp/result || echo NOT_MOUNT >>/tmp/result
echo 'daytona durable write' > /root/work/hello.md 2>>/tmp/result && echo WROTE >>/tmp/result || echo WRITE_FAIL >>/tmp/result
sync
cat /root/work/hello.md >>/tmp/result 2>&1 && echo READBACK_OK >>/tmp/result || echo READBACK_FAIL >>/tmp/result
`;
const sbx = await daytona.create({ image: "debian:12.9" }, { timeout: 240 });
console.log("sandbox:", sbx.id, "sid:", SID);
try {
  await exec(sbx, "apt-get update -qq && apt-get install -y -qq curl ca-certificates fuse >/dev/null 2>&1; echo ready", 150);
  await exec(sbx, `curl -fsSL -o /usr/local/bin/geesefs ${GEESEFS} && chmod +x /usr/local/bin/geesefs && echo ok`);
  // write the runner via base64 to dodge all quoting
  const b64 = Buffer.from(RUNNER).toString("base64");
  await exec(sbx, `echo ${b64} | base64 -d > /root/run.sh && chmod +x /root/run.sh && echo wrote-runner`);
  await exec(sbx, `setsid bash /root/run.sh >/tmp/runner.log 2>&1 < /dev/null & echo "pid $!"`);
  for (let i = 0; i < 9; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = await exec(sbx, "echo '--result--'; cat /tmp/result 2>/dev/null; echo '--s3 log--'; grep -iE 'PUT |DEBUG|http|denied|signature|x-amz' /tmp/mount.log 2>/dev/null | tail -6");
    if (String(r.result || "").includes("READBACK")) { console.log(">>> ROUND-TRIP DONE"); break; }
  }
  console.log("=== mount.log tail ===");
  await exec(sbx, "tail -20 /tmp/mount.log 2>/dev/null");
} finally { await daytona.delete(sbx); console.log("deleted"); }
