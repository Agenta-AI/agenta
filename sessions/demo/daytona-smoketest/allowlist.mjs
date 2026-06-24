// Does passing domainAllowList at create time open egress to the tunnel on our tier?
// The network-limits doc says Tier 1/2 "cannot be overridden at the sandbox level" but
// every prior probe omitted domainAllowList entirely — so we never actually tried it.
import { Daytona } from "@daytonaio/sdk";
const TUNNEL = process.env.TUNNEL;                       // https://<host>.ngrok-free.app
const HOST = new URL(TUNNEL).host;                       // <host>.ngrok-free.app
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
async function exec(sbx, cmd, t = 60) {
  const r = await sbx.process.executeCommand(cmd, undefined, undefined, t);
  console.log(`  ${String(r.result || "").trim().slice(0, 140)}`);
  return r;
}
// allowlist the tunnel + debian mirrors (so we can apt-install curl) + google as control
const ALLOW = `${HOST},*.ngrok-free.app,*.debian.org,deb.debian.org,google.com`;
console.log("creating sandbox with domainAllowList:", ALLOW);
const sbx = await daytona.create(
  { image: "debian:12.9", domainAllowList: ALLOW },
  { timeout: 120 },
);
console.log("sandbox:", sbx.id);
try {
  await exec(sbx, "apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null 2>&1; echo ready", 120);
  await exec(sbx, "curl -s -o /dev/null -w 'github.com: %{http_code} (%{time_total}s)\\n' --max-time 15 https://github.com");
  await exec(sbx, "curl -s -o /dev/null -w 'google.com: %{http_code} (%{time_total}s)\\n' --max-time 15 https://google.com");
  await exec(sbx, `curl -s -o /dev/null -w 'tunnel: %{http_code} (%{time_total}s)\\n' --max-time 15 ${TUNNEL}/demo/ 2>&1 || echo "tunnel BLOCKED (curl err $?)"`);
} finally { await daytona.delete(sbx); console.log("deleted"); }
