import { Daytona } from "@daytonaio/sdk";
const TUNNEL = process.env.TUNNEL;
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
async function exec(sbx, cmd, t=60){const r=await sbx.process.executeCommand(cmd,undefined,undefined,t);console.log(`$ ${cmd.slice(0,70)}\n  exit=${r.exitCode}: ${String(r.result||"").slice(0,200)}`);return r;}
const sbx = await daytona.create({ image: "debian:12.9" }, { timeout: 180 });
try {
  await exec(sbx, "apt-get update -qq && apt-get install -y -qq curl >/dev/null 2>&1; echo ok", 120);
  await exec(sbx, `curl -s -o /dev/null -w 'GET http=%{http_code} t=%{time_total}s\n' --max-time 15 ${TUNNEL}/demo/`);
  await exec(sbx, `curl -s -o /dev/null -w 'PUT http=%{http_code} t=%{time_total}s\n' --max-time 25 -X PUT --data hello ${TUNNEL}/demo/dtcurl.txt`, 40);
  await exec(sbx, `curl -s -o /dev/null -w 'PUT-1MB http=%{http_code} t=%{time_total}s\n' --max-time 40 -X PUT -H 'Content-Type: application/octet-stream' --data-binary @<(head -c 1000000 /dev/zero) ${TUNNEL}/demo/dtbig.txt`, 50);
} finally { await daytona.delete(sbx); console.log("deleted"); }
