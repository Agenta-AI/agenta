// Mount succeeded with the A-record pinned, but the write hit the SDK's exec timeout
// (408), not necessarily an egress failure. Run the mount+write detached inside the
// sandbox (nohup) so the host SDK timeout can't kill it, then poll the result file
// the sandbox writes locally. Host separately checks SeaweedFS for the object.
import { Daytona } from "@daytonaio/sdk";
const TUNNEL = process.env.TUNNEL;
const HOST = new URL(TUNNEL).host;
const SID = "daytona-ipv4write";
const GEESEFS = "https://github.com/yandex-cloud/geesefs/releases/latest/download/geesefs-linux-amd64";
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
async function exec(sbx, cmd, t = 60) {
  const r = await sbx.process.executeCommand(cmd, undefined, undefined, t);
  console.log(`$ ${cmd.slice(0, 64)}\n  exit=${r.exitCode} ${String(r.result || "").trim().slice(0, 200)}`);
  return r;
}
const ALLOW = `${HOST},*.ngrok-free.app,deb.debian.org,*.debian.org,github.com,*.github.com,objects.githubusercontent.com,*.githubusercontent.com`;
const sbx = await daytona.create({ image: "debian:12.9", domainAllowList: ALLOW }, { timeout: 240 });
console.log("sandbox:", sbx.id);
try {
  await exec(sbx, "apt-get update -qq && apt-get install -y -qq curl ca-certificates fuse >/dev/null 2>&1; echo ready", 150);
  await exec(sbx, `curl -4 -fsSL -o /usr/local/bin/geesefs ${GEESEFS} && chmod +x /usr/local/bin/geesefs && echo geesefs-ok`);
  await exec(sbx, `A=$(getent ahostsv4 ${HOST} | awk '{print $1}' | head -1); echo "$A ${HOST}" >> /etc/hosts; echo "pinned $A"`);
  // detached: mount, write, flush, record outcome to /tmp/result — never blocks the SDK call
  const script = [
    "mkdir -p /root/work",
    `AWS_ACCESS_KEY_ID=demo AWS_SECRET_ACCESS_KEY=demosecret geesefs --endpoint ${TUNNEL} --region us-east-1 --no-detect --fsync-on-close -o allow_other demo:${SID} /root/work 2>/tmp/mount.log && echo MOUNTED >>/tmp/result || echo MOUNT_FAIL >>/tmp/result`,
    "echo 'daytona ipv4 durable write' > /root/work/hello.md 2>>/tmp/result && echo WROTE >>/tmp/result || echo WRITE_FAIL >>/tmp/result",
    "sync; sleep 2; cat /root/work/hello.md >>/tmp/result 2>&1 && echo READBACK_OK >>/tmp/result || echo READBACK_FAIL >>/tmp/result",
  ].join("; ");
  await exec(sbx, `nohup bash -c '${script}' >/tmp/nohup.log 2>&1 & echo "detached pid $!"`);
  // poll the local result file (host SDK call returns instantly each time)
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const r = await exec(sbx, "cat /tmp/result 2>/dev/null; echo '---'; tail -2 /tmp/mount.log 2>/dev/null");
    if (String(r.result || "").includes("READBACK")) break;
  }
} finally { await daytona.delete(sbx); console.log("deleted"); }
