// Sharper test: does domainAllowList ADD a non-essential host on this tier, or is it
// ignored? Allowlist example.com (not in the essential baseline) + the tunnel + debian
// mirrors. If example.com opens -> allowlist works, tunnel just needs right entry.
// If example.com stays blocked despite being listed -> allowlist can't widen on T1/2.
import { Daytona } from "@daytonaio/sdk";
const TUNNEL = process.env.TUNNEL;
const HOST = new URL(TUNNEL).host;
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
async function exec(sbx, cmd, t = 60) {
  const r = await sbx.process.executeCommand(cmd, undefined, undefined, t);
  console.log(`  ${String(r.result || "").trim().slice(0, 160)}`);
  return r;
}
const ALLOW = `example.com,www.example.com,${HOST},*.ngrok-free.app,deb.debian.org,*.debian.org`;
console.log("domainAllowList:", ALLOW);
const sbx = await daytona.create({ image: "debian:12.9", domainAllowList: ALLOW }, { timeout: 120 });
console.log("sandbox:", sbx.id);
try {
  // resolve via getent first — separates DNS-block from TLS-block
  await exec(sbx, "apt-get update -qq && apt-get install -y -qq curl ca-certificates dnsutils >/dev/null 2>&1; echo ready", 150);
  await exec(sbx, "getent hosts example.com >/dev/null && echo 'example.com DNS=ok' || echo 'example.com DNS=BLOCKED'");
  await exec(sbx, "curl -s -o /dev/null -w 'example.com: %{http_code} (%{time_total}s)\\n' --max-time 15 https://example.com || echo 'example.com curl-fail'");
  await exec(sbx, `getent hosts ${HOST} >/dev/null && echo 'tunnel DNS=ok' || echo 'tunnel DNS=BLOCKED'`);
  await exec(sbx, `curl -s -o /dev/null -w 'tunnel: %{http_code} (%{time_total}s)\\n' --max-time 15 ${TUNNEL}/demo/ || echo 'tunnel curl-fail'`);
} finally { await daytona.delete(sbx); console.log("deleted"); }
