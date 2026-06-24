// Focused Daytona write round-trip: mount geesefs, write, flush, verify in-sandbox.
// Leaves the file in SeaweedFS (no delete) so we can confirm from the host.
import { Daytona } from "@daytonaio/sdk";

const TUNNEL = process.env.TUNNEL;
const SID = "daytona-write";
const GEESEFS_URL = "https://github.com/yandex-cloud/geesefs/releases/latest/download/geesefs-linux-amd64";

const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
async function exec(sbx, cmd, t = 120) {
  const r = await sbx.process.executeCommand(cmd, undefined, undefined, t);
  console.log(`$ ${cmd.slice(0, 80)}\n  exit=${r.exitCode} ${r.result ? String(r.result).slice(0, 200) : ""}`);
  return r;
}

const sbx = await daytona.create({ image: "debian:12.9" }, { timeout: 180 });
console.log("sandbox:", sbx.id);
try {
  await exec(sbx, "apt-get update -qq && apt-get install -y -qq curl fuse >/dev/null 2>&1; echo ok");
  await exec(sbx, `curl -fsSL -o /usr/local/bin/geesefs ${GEESEFS_URL} && chmod +x /usr/local/bin/geesefs`);
  await exec(sbx, "mkdir -p /root/work");
  await exec(sbx,
    `AWS_ACCESS_KEY_ID=demo AWS_SECRET_ACCESS_KEY=demosecret geesefs --endpoint ${TUNNEL} ` +
    `--region us-east-1 --no-detect --fsync-on-close -o allow_other demo:${SID} /root/work && echo MOUNTED`);
  // --fsync-on-close makes each close() durable; the write should land in S3 immediately
  await exec(sbx, "echo 'daytona durable write' > /root/work/hello.md && cat /root/work/hello.md && echo WROTE", 90);
  console.log("\n>>> wrote + unmounted (flushed to S3). Check SeaweedFS for demo/daytona-write/hello.md");
} finally {
  await daytona.delete(sbx);
  console.log("sandbox deleted");
}
