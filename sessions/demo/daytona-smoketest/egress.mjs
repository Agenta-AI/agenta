import { Daytona } from "@daytonaio/sdk";
const TUNNEL = process.env.TUNNEL;
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
async function exec(sbx, cmd, t=60){const r=await sbx.process.executeCommand(cmd,undefined,undefined,t);console.log(`  ${String(r.result||"").trim().slice(0,120)}`);return r;}
const sbx = await daytona.create({ image: "debian:12.9" }, { timeout: 120 });
try {
  await exec(sbx, "apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null 2>&1; echo ready", 120);
  await exec(sbx, "curl -s -o /dev/null -w 'github.com: %{http_code} (%{time_total}s)\\n' --max-time 15 https://github.com");
  await exec(sbx, "curl -s -o /dev/null -w 'google.com: %{http_code} (%{time_total}s)\\n' --max-time 15 https://google.com");
  await exec(sbx, `curl -s -o /dev/null -w 'ngrok-tunnel: %{http_code} (%{time_total}s)\\n' --max-time 15 ${TUNNEL}/demo/ 2>&1 || echo "ngrok BLOCKED (curl err $?)"`);
  await exec(sbx, "curl -s -o /dev/null -w 'ngrok.com: %{http_code} (%{time_total}s)\\n' --max-time 15 https://ngrok.com");
} finally { await daytona.delete(sbx); }
