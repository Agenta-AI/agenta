// Is the block at L4 (TCP connect) or higher (TLS/cert)? DNS resolves for allowlisted
// hosts but curl=000. Test raw TCP connect with nc to tunnel:443 vs an essential host:443.
import { Daytona } from "@daytonaio/sdk";
const TUNNEL = process.env.TUNNEL;
const HOST = new URL(TUNNEL).host;
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
async function exec(sbx, cmd, t = 60) {
  const r = await sbx.process.executeCommand(cmd, undefined, undefined, t);
  console.log(`$ ${cmd.slice(0, 70)}\n  ${String(r.result || "").trim().slice(0, 200)}`);
  return r;
}
const ALLOW = `${HOST},*.ngrok-free.app,deb.debian.org,*.debian.org,github.com,*.github.com`;
console.log("domainAllowList:", ALLOW);
const sbx = await daytona.create({ image: "debian:12.9", domainAllowList: ALLOW }, { timeout: 120 });
console.log("sandbox:", sbx.id);
try {
  await exec(sbx, "apt-get update -qq && apt-get install -y -qq netcat-openbsd dnsutils curl ca-certificates >/dev/null 2>&1; echo ready", 150);
  // resolved IPs
  await exec(sbx, `echo -n 'tunnel IP: '; getent hosts ${HOST} | awk '{print $1}' | head -1`);
  await exec(sbx, "echo -n 'github IP: '; getent hosts github.com | awk '{print $1}' | head -1");
  // raw TCP connect (5s) — does the L4 path open at all?
  await exec(sbx, `nc -z -w5 ${HOST} 443 && echo 'tunnel:443 TCP=OPEN' || echo 'tunnel:443 TCP=BLOCKED'`);
  await exec(sbx, "nc -z -w5 github.com 443 && echo 'github:443 TCP=OPEN' || echo 'github:443 TCP=BLOCKED'");
  await exec(sbx, "nc -z -w5 deb.debian.org 80 && echo 'debian:80 TCP=OPEN' || echo 'debian:80 TCP=BLOCKED'");
} finally { await daytona.delete(sbx); console.log("deleted"); }
