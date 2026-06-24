// The tunnel resolved to IPv6 and curl died at connect in ~26ms — classic broken-IPv6
// dual-stack, NOT an egress block (nc to tunnel:443 was OPEN). Force IPv4 and a real
// geesefs write. If this works, Daytona is unblocked: the fix is -4 / IPv4-only DNS.
import { Daytona } from "@daytonaio/sdk";
const TUNNEL = process.env.TUNNEL;
const HOST = new URL(TUNNEL).host;
const SID = "daytona-ipv4";
const GEESEFS = "https://github.com/yandex-cloud/geesefs/releases/latest/download/geesefs-linux-amd64";
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
async function exec(sbx, cmd, t = 90) {
  const r = await sbx.process.executeCommand(cmd, undefined, undefined, t);
  console.log(`$ ${cmd.slice(0, 72)}\n  exit=${r.exitCode} ${String(r.result || "").trim().slice(0, 220)}`);
  return r;
}
const ALLOW = `${HOST},*.ngrok-free.app,deb.debian.org,*.debian.org,github.com,*.github.com,objects.githubusercontent.com,*.githubusercontent.com`;
const sbx = await daytona.create({ image: "debian:12.9", domainAllowList: ALLOW }, { timeout: 180 });
console.log("sandbox:", sbx.id);
try {
  await exec(sbx, "apt-get update -qq && apt-get install -y -qq curl ca-certificates fuse >/dev/null 2>&1; echo ready", 150);
  // (1) curl -4 vs default — prove IPv6 was the killer
  await exec(sbx, `curl -4 -s -o /dev/null -w 'tunnel -4: %{http_code} (%{time_total}s)\\n' --max-time 15 ${TUNNEL}/demo/ || echo 'tunnel -4 fail'`);
  // (2) geesefs needs the linux binary from github releases (redirects to githubusercontent)
  await exec(sbx, `curl -4 -fsSL -o /usr/local/bin/geesefs ${GEESEFS} && chmod +x /usr/local/bin/geesefs && echo geesefs-ok`);
  await exec(sbx, "mkdir -p /root/work");
  // (3) mount with IPv4-forced endpoint. geesefs has no -4; we pin via /etc/hosts to the A record.
  await exec(sbx, `A=$(getent ahostsv4 ${HOST} | awk '{print $1}' | head -1); echo "A-record: $A"; [ -n "$A" ] && echo "$A ${HOST}" >> /etc/hosts && echo pinned || echo NO_A_RECORD`);
  await exec(sbx,
    `AWS_ACCESS_KEY_ID=demo AWS_SECRET_ACCESS_KEY=demosecret geesefs --endpoint ${TUNNEL} ` +
    `--region us-east-1 --no-detect --fsync-on-close -o allow_other demo:${SID} /root/work && echo MOUNTED`, 90);
  // (4) the real test: write + read back
  await exec(sbx, "echo 'daytona ipv4 durable write' > /root/work/hello.md && cat /root/work/hello.md && echo WROTE", 90);
  console.log("\n>>> if WROTE printed, check SeaweedFS for demo/daytona-ipv4/hello.md");
} finally { await daytona.delete(sbx); console.log("deleted"); }
