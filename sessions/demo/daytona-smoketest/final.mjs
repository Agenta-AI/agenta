import { Daytona } from "@daytonaio/sdk";
const TUNNEL = process.env.TUNNEL;
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
async function exec(sbx, cmd, t=120){const r=await sbx.process.executeCommand(cmd,undefined,undefined,t);console.log(`$ ${cmd.slice(0,75)}\n  exit=${r.exitCode}: ${String(r.result||"").slice(0,400)}`);return r;}
const sbx = await daytona.create({ image: "debian:12.9" }, { timeout: 180 });
console.log("sbx:", sbx.id);
try {
  await exec(sbx, "apt-get update -qq && apt-get install -y -qq curl fuse ca-certificates >/dev/null 2>&1; echo ok", 180);
  // sanity: curl WITH ca-certificates now
  await exec(sbx, `curl -s -o /dev/null -w 'GET http=%{http_code} t=%{time_total}s\n' --max-time 15 ${TUNNEL}/demo/`);
  await exec(sbx, `curl -s -o /dev/null -w 'PUT http=%{http_code} t=%{time_total}s\n' --max-time 25 -X PUT --data hi ${TUNNEL}/demo/dt.txt`, 40);
  await exec(sbx, `curl -fsSL -o /usr/local/bin/geesefs https://github.com/yandex-cloud/geesefs/releases/latest/download/geesefs-linux-amd64 && chmod +x /usr/local/bin/geesefs`);
  await exec(sbx, "mkdir -p /root/work");
  await exec(sbx, `AWS_ACCESS_KEY_ID=demo AWS_SECRET_ACCESS_KEY=demosecret geesefs --endpoint ${TUNNEL} --region us-east-1 --no-detect --fsync-on-close -o allow_other demo:dtfinal /root/work && echo MOUNTED`);
  await exec(sbx, "time (echo durable > /root/work/hello.md) && echo WROTE && ls -la /root/work", 120);
} finally { await daytona.delete(sbx); console.log("deleted"); }
