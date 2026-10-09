# Phase 0 spike results

- Dates: 2026-10-09 to (open)
- Engineer: Claude Code session, for Ashraf
- Snapshot: not used yet (no Daytona access in the session that ran 0.9)

| Check | Result | Measured values | Notes |
| --- | --- | --- | --- |
| 0.1 Start time | not run | | Needs a Daytona API key. |
| 0.2 CDP via proxy | not run | | Needs a Daytona API key. |
| 0.3 Harness tools | not run | | Needs the local stack and test agents. |
| 0.4 Live view | not run | | Needs a staging stack and phones. |
| 0.5 Login reload | not run | | Needs the live view and Codecov and Umami accounts. |
| 0.6 Pause/resume | not run | | Needs the local stack. |
| 0.7 Isolation | not run | | Needs a Daytona API key. |
| 0.8 Replicas | not run | | Needs a staging stack with two runner replicas. |
| 0.9 Allowlist | 7/7 blocked (local Chromium) | 3 runs, same result each time | See below. Repeat inside a Daytona browser sandbox during 0.1. |
| 0.11 Proxy | pass (local Chromium) | request kinds 8/8; rebinding refused; UDP leak none (corrected flag) | See below. One flag in D26 was wrong and is fixed. Repeat in a Daytona sandbox during 0.1. |

## 0.9 Allowlist coverage

### Setup

- Chromium `Chrome/141.0.7390.37` from `/opt/pw-browsers/chromium-1194`, `--headless=new`, run locally, not in a Daytona sandbox.
- One local HTTP server. Chrome maps the test host names to it with `--host-resolver-rules`.
- CDP over the browser WebSocket: `Target.setAutoAttach` (flatten, wait for debugger) on the browser and on every attached session, and `Fetch.enable` on every attached session. Each paused request gets `Fetch.continueRequest` or `Fetch.failRequest` (`BlockedByClient`).
- Policy (the D7 rule): refuse IP literals, `localhost`, and names that resolve to private or link-local addresses, for every request type. For `Document` and `Other` requests, also require the host to be on the allowlist. Allowlist: `allowed.test`.
- The policy resolved names from a fixed table (`allowed.test` and `other.test` public, `rebind.test` private), not from real DNS.
- Pass rule per case: the policy logged a block for the URL, and the server received no request for it.

### Results

| Case | Result | Reason | Request type |
| --- | --- | --- | --- |
| Control: navigate to `allowed.test` | loaded | — | Document |
| 1. Top-level navigation to another host | blocked | `not_allowed` | Document |
| 2. Iframe on another host | blocked | `not_allowed` | Document |
| 3. Popup (`window.open`) to another host | blocked | `not_allowed` | Document |
| 4. File download from another host | blocked | `not_allowed` | Document |
| 5. IP literal `http://169.254.169.254/` | blocked | `ip_literal` | Document |
| 6. `http://localhost:9222/json` (the debug port) | blocked | `localhost` | Document |
| 7. Public name that resolves to a private address | blocked | `private_address` | Document |
| Extra: `fetch` from a dedicated worker to a private-address name | blocked | `private_address` | XHR |

Attached target types: `page`, `worker`. The cross-site iframe's request was paused on the page's session.

The first run used `Runtime.evaluate` without `userGesture`. Chrome's popup blocker then stopped `window.open` before any request, so case 3 had no decision. The three recorded runs use `userGesture: true`, so the popup opened and its request reached the policy.

### Pass

Yes: all seven cases are blocked, and the control loads.

### Not proven by this check

1. **DNS rebinding.** The policy resolved names from a fixed table. In production the policy must resolve a name itself, and Chrome resolves it again when it connects. A host that answers a public address to the policy and a private address to Chrome would pass. Interception cannot change the address Chrome connects to. Decided on 2026-10-09: an in-sandbox forward proxy (design D26), to be proven by check 0.11. See F-027 in [findings.md](findings.md).
2. **Inside a Daytona sandbox.** Repeat this check in the browser sandbox during 0.1.
3. **Request kinds not tried:** WebSocket connections, service workers, `navigator.sendBeacon`, prefetch and prerender, and redirects from an allowed host to a blocked one.

<details>
<summary>Script used for 0.9 (throwaway, not part of the build)</summary>

```js
// Phase 0 check 0.9 (throwaway): can CDP request interception enforce D7 on every target?
// Local only: Chromium + one HTTP server. Host names map to 127.0.0.1 through Chrome's
// --host-resolver-rules; the policy decides with its own resolver table (FAKE_DNS), so
// "allowed.test" counts as a public address and "rebind.test" as a private one.
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PORT = 8089;
const CDP_PORT = 9222;
const ALLOWLIST = new Set(["allowed.test"]);
const FAKE_DNS = { "allowed.test": "93.184.215.14", "other.test": "93.184.215.15", "rebind.test": "10.0.0.5" };

const hits = [];
const server = http.createServer((req, res) => {
  const host = (req.headers.host || "").split(":")[0];
  hits.push(`${host}${req.url}`);
  if (req.url.startsWith("/file.bin")) {
    res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="file.bin"' });
    return res.end("data");
  }
  res.writeHead(200, { "content-type": "text/html", "access-control-allow-origin": "*" });
  res.end(`<html><body>${host}${req.url}</body></html>`);
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

function isPrivate(ip) {
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 0;
}
function decide(rawUrl, resourceType) {
  let u;
  try { u = new URL(rawUrl); } catch { return { allow: false, reason: "bad_url" }; }
  if (!["http:", "https:"].includes(u.protocol)) return { allow: true, reason: "non_http" };
  const host = u.hostname;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.startsWith("[")) return { allow: false, reason: "ip_literal" };
  if (host === "localhost" || host.endsWith(".localhost")) return { allow: false, reason: "localhost" };
  const ip = FAKE_DNS[host];
  if (!ip) return { allow: false, reason: "unresolvable" };
  if (isPrivate(ip)) return { allow: false, reason: "private_address" };
  // Documents (pages, iframes, popups) and downloads must be on the allowlist; other
  // subresources (CDN scripts, images) only pass the address checks above.
  if ((resourceType === "Document" || resourceType === "Other") && !ALLOWLIST.has(host)) return { allow: false, reason: "not_allowed" };
  return { allow: true, reason: "ok" };
}

const profile = mkdtempSync(join(tmpdir(), "spike09-"));
const downloads = mkdtempSync(join(tmpdir(), "spike09-dl-"));
const chrome = spawn(CHROME, [
  "--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "--no-proxy-server",
  `--host-resolver-rules=MAP allowed.test 127.0.0.1:${PORT}, MAP other.test 127.0.0.1:${PORT}, MAP rebind.test 127.0.0.1:${PORT}`,
  "--window-size=1280,800", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()).webSocketDebuggerUrl; }
  catch { await new Promise((r) => setTimeout(r, 200)); }
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let nextId = 1;
const pending = new Map();
const decisions = [];
const attached = [];
function send(method, params = {}, sessionId) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function setupSession(sessionId, type) {
  attached.push(type);
  await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, sessionId).catch((e) => decisions.push({ url: `(Fetch.enable failed on ${type}: ${e})` }));
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => {});
  await send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
}
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id); pending.delete(msg.id);
    return msg.error ? p.reject(msg.error.message) : p.resolve(msg.result);
  }
  if (msg.method === "Target.attachedToTarget") {
    setupSession(msg.params.sessionId, msg.params.targetInfo.type);
  } else if (msg.method === "Fetch.requestPaused") {
    const { requestId, request, resourceType } = msg.params;
    const d = decide(request.url, resourceType);
    decisions.push({ url: request.url, resourceType, ...d });
    if (d.allow) send("Fetch.continueRequest", { requestId }, msg.sessionId).catch(() => {});
    else send("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }, msg.sessionId).catch(() => {});
  }
});

await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
await new Promise((r) => setTimeout(r, 500));
const { sessionId: page } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, page);
await send("Runtime.enable", {}, page);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = (expression) => send("Runtime.evaluate", { expression, awaitPromise: true, userGesture: true }, page).catch((e) => ({ error: String(e) }));

async function home() { await send("Page.navigate", { url: `http://allowed.test:${PORT}/home` }, page); await sleep(800); }

const cases = [
  ["control: navigate to allowed.test", `allowed.test/control`, async () => { await send("Page.navigate", { url: `http://allowed.test:${PORT}/control` }, page); await sleep(800); }, "allowed"],
  ["1 top-level navigation to another host", `other.test/nav`, async () => { await send("Page.navigate", { url: `http://other.test:${PORT}/nav` }, page); await sleep(800); }],
  ["2 iframe on another host", `other.test/iframe`, async () => { await home(); await evalJs(`(()=>{const f=document.createElement('iframe');f.src='http://other.test:${PORT}/iframe';document.body.appendChild(f);})()`); await sleep(1500); }],
  ["3 popup (window.open) to another host", `other.test/popup`, async () => { await home(); await evalJs(`window.open('http://other.test:${PORT}/popup')`); await sleep(2000); }],
  ["4 file download from another host", `other.test/file.bin`, async () => { await home(); await evalJs(`(()=>{const a=document.createElement('a');a.href='http://other.test:${PORT}/file.bin';a.download='';document.body.appendChild(a);a.click();})()`); await sleep(1500); }],
  ["5 IP literal 169.254.169.254", `169.254.169.254/`, async () => { await send("Page.navigate", { url: "http://169.254.169.254/" }, page); await sleep(800); }],
  ["6 localhost:9222 (debug port)", `localhost/json`, async () => { await send("Page.navigate", { url: `http://localhost:${CDP_PORT}/json` }, page); await sleep(800); }],
  ["7 public name resolving to a private address", `rebind.test/rebind`, async () => { await send("Page.navigate", { url: `http://rebind.test:${PORT}/rebind` }, page); await sleep(800); }],
  ["extra: fetch from a dedicated worker to a private-address host", `rebind.test/worker-fetch`, async () => { await home(); await evalJs(`(()=>{const b=new Blob(["fetch('http://rebind.test:${PORT}/worker-fetch').catch(()=>{})"],{type:'text/javascript'});new Worker(URL.createObjectURL(b));})()`); await sleep(2000); }],
];

const results = [];
for (const [name, marker, run, expect = "blocked"] of cases) {
  const hitsBefore = hits.length, decBefore = decisions.length;
  await run();
  const newHits = hits.slice(hitsBefore);
  const newDec = decisions.slice(decBefore);
  const [mHost, ...mPath] = marker.split("/");
  const reached = newHits.some((h) => h === marker || h.startsWith(marker));
  const blockedDecision = newDec.find((d) => d.url && d.url.includes(mHost) && d.url.includes("/" + mPath.join("/")) && d.allow === false);
  const outcome = reached ? "loaded" : blockedDecision ? "blocked" : "not reached (no decision)";
  results.push({ name, expect, outcome, reason: blockedDecision?.reason ?? "", resourceType: blockedDecision?.resourceType ?? newDec.find((d) => d.url?.includes(mHost))?.resourceType ?? "" });
}

console.log(JSON.stringify({ chrome: (await send("Browser.getVersion")).product, attachedTargetTypes: [...new Set(attached)], results, popupDecisions: decisions.filter((d) => d.url && d.url.includes("popup")) }, null, 2));
ws.close(); chrome.kill("SIGKILL"); server.close();
await new Promise((r) => setTimeout(r, 1000));
for (const d of [profile, downloads]) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
process.exit(0);
```

</details>

## 0.11 In-sandbox proxy

### Setup

- Chromium `Chrome/141.0.7390.37`, `--headless=new`, run locally, not in a Daytona sandbox.
- A test forward proxy on loopback that handles plain HTTP and `CONNECT`. It resolves each host once from a table, refuses loopback, private, and link-local addresses, and connects to the address it checked. A test shim serves every allowed "public" address from one local server.
- The `.test` names do not exist in real DNS, and Chrome got no resolver rules. A page can load only if the proxy resolved its name.
- `rebind.test` resolves to a public address on the first lookup and to `10.0.0.5` on every later lookup.
- A UDP listener on `127.0.0.1:3478` acts as a STUN server. Any packet it receives is UDP that left outside the proxy.
- Chrome flags: `--proxy-server=http://127.0.0.1:<port>`, `--proxy-bypass-list=<-loopback>`, and a WebRTC flag (see below).

### Results

| Run | WebRTC flag | Loopback flag | Request kinds through proxy | Rebinding second load | Loopback | WebRTC |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` | on | 8/8 | refused (`private`) | through proxy | 1 host UDP candidate, 5 UDP packets |
| Control A | none | on | 8/8 | refused | through proxy | 1 host UDP candidate, 5 UDP packets |
| Control B | `--force-…` | **off** | 8/8 | refused | **direct to the server, around the proxy** | 5 UDP packets |
| 2 | `--webrtc-ip-handling-policy=disable_non_proxied_udp` | on | 8/8 | refused | through proxy | no candidates, 0 packets |
| Final ×3 | `--webrtc-ip-handling-policy=disable_non_proxied_udp` | on | 8/8 | refused | through proxy | no candidates, 0 packets |

Request kinds: navigation, iframe, popup, download, `fetch`, WebSocket (`ws://`, sent as `CONNECT`), `navigator.sendBeacon`, and an HTTPS `fetch` (`CONNECT`).

Rebinding: `/r1` loaded with `93.184.215.20`; `/r2` on the same name got `10.0.0.5` and was refused with `refused: private`.

### Pass

Yes, with the corrected WebRTC flag.

### What the check changed

1. `--force-webrtc-ip-handling-policy` (the flag first written in D26) has no effect in Chrome 141: it behaves exactly like no flag. `--webrtc-ip-handling-policy=disable_non_proxied_udp` stops all WebRTC UDP. D26, task 3.6b, and the runbook now name the working flag.
2. Control B shows that `--proxy-bypass-list=<-loopback>` is required: without it, Chrome sends loopback traffic directly, around the proxy.

### Not proven by this check

1. Inside a Daytona sandbox, and with real DNS in the proxy.
2. IPv6 addresses and hosts with several addresses.
3. HTTP/3 (QUIC). No request used QUIC through the proxy, but the check did not try to force it.
4. Proxy speed and resource use under real pages.

<details>
<summary>Script used for 0.11 (throwaway, not part of the build)</summary>

```js
// Phase 0 check 0.11 (throwaway): does Chrome send every connection through an in-sandbox proxy
// that resolves once, refuses private addresses, and connects to the address it checked (D26)?
// Local only. The ".test" names do not exist in real DNS; the proxy resolves them from a table
// and maps the "public" answers to a local server (a test shim standing in for the internet).
// Usage: node check-0.11.mjs [--no-webrtc-flag] [--no-loopback-flag]
import { spawn } from "node:child_process";
import http from "node:http";
import net from "node:net";
import dgram from "node:dgram";
import crypto from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const HTTP_PORT = 8091, PROXY_PORT = 8092, STUN_PORT = 3478, CDP_PORT = 9223;
const webrtcFlag = !process.argv.includes("--no-webrtc-flag");
const loopbackFlag = !process.argv.includes("--no-loopback-flag");

// --- upstream "internet": one HTTP server that also accepts WebSocket upgrades ---------------
const upstreamHits = [];
const upstream = http.createServer((req, res) => {
  upstreamHits.push(`${(req.headers.host || "").split(":")[0]}${req.url}`);
  if (req.url.startsWith("/file.bin")) {
    res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="file.bin"' });
    return res.end("data");
  }
  res.writeHead(200, { "content-type": "text/html", "access-control-allow-origin": "*" });
  res.end(`<html><body>${req.headers.host}${req.url}</body></html>`);
});
upstream.on("upgrade", (req, socket) => {
  upstreamHits.push(`${(req.headers.host || "").split(":")[0]}${req.url} (websocket)`);
  const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
});
await new Promise((r) => upstream.listen(HTTP_PORT, "127.0.0.1", r));

// --- UDP listener standing in for a STUN server: any packet here is UDP outside the proxy ----
let udpPackets = 0;
const udp = dgram.createSocket("udp4");
udp.on("message", () => { udpPackets++; });
await new Promise((r) => udp.bind(STUN_PORT, "127.0.0.1", r));

// --- the proxy under test ---------------------------------------------------------------------
let rebindLookups = 0;
function resolveOnce(host) {
  if (net.isIP(host)) return host;
  if (host === "localhost") return "127.0.0.1";
  if (host === "rebind.test") return rebindLookups++ === 0 ? "93.184.215.20" : "10.0.0.5";
  return { "allowed.test": "93.184.215.14", "ws.test": "93.184.215.16", "tls.test": "93.184.215.17" }[host] ?? null;
}
function isBlocked(ip) {
  if (!ip) return "unresolvable";
  const [a, b] = ip.split(".").map(Number);
  if (a === 127 || a === 0) return "loopback";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
  if (a === 169 && b === 254) return "link_local";
  return null;
}
// Test shim: every allowed "public" answer is served by the local upstream server.
const connectTarget = (ip) => ({ host: "127.0.0.1", port: HTTP_PORT, checked: ip });

const proxyLog = [];
const proxy = http.createServer((req, res) => {
  const u = new URL(req.url);
  const ip = resolveOnce(u.hostname);
  const blocked = isBlocked(ip);
  proxyLog.push({ kind: "http", host: u.hostname, path: u.pathname, ip, blocked });
  if (blocked) { res.writeHead(403); return res.end(`refused: ${blocked}`); }
  const t = connectTarget(ip);
  const up = http.request({ host: t.host, port: t.port, method: req.method, path: u.pathname + u.search, headers: req.headers }, (ur) => {
    res.writeHead(ur.statusCode, ur.headers); ur.pipe(res);
  });
  up.on("error", () => { res.writeHead(502); res.end(); });
  req.pipe(up);
});
proxy.on("connect", (req, client, head) => {
  const [host] = req.url.split(":");
  const ip = resolveOnce(host);
  const blocked = isBlocked(ip);
  proxyLog.push({ kind: "connect", host, port: req.url.split(":")[1], ip, blocked });
  if (blocked) { client.end("HTTP/1.1 403 Forbidden\r\n\r\n"); return; }
  const t = connectTarget(ip);
  const up = net.connect(t.port, t.host, () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); up.write(head); up.pipe(client); client.pipe(up); });
  up.on("error", () => client.destroy());
  client.on("error", () => up.destroy());
});
await new Promise((r) => proxy.listen(PROXY_PORT, "127.0.0.1", r));

// --- Chrome --------------------------------------------------------------------------------------
const profile = mkdtempSync(join(tmpdir(), "spike11-"));
const downloads = mkdtempSync(join(tmpdir(), "spike11-dl-"));
const args = [
  "--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  `--proxy-server=http://127.0.0.1:${PROXY_PORT}`, "--window-size=1280,800", "about:blank",
];
if (loopbackFlag) args.push("--proxy-bypass-list=<-loopback>");
const webrtcArg = (process.argv.find((a) => a.startsWith("--webrtc-arg=")) || "").slice("--webrtc-arg=".length);
if (webrtcFlag) args.push(webrtcArg || "--webrtc-ip-handling-policy=disable_non_proxied_udp");
const chrome = spawn(CHROME, args, { stdio: ["ignore", "ignore", "pipe"] });

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()).webSocketDebuggerUrl; }
  catch { await new Promise((r) => setTimeout(r, 200)); }
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(msg.error.message) : p.resolve(msg.result); }
});
const send = (method, params = {}, sessionId) => { const id = nextId++; ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: page } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, page);
await send("Runtime.enable", {}, page);
const evalJs = (expression) => send("Runtime.evaluate", { expression, awaitPromise: true, userGesture: true, returnByValue: true }, page).then((r) => r.result?.value).catch((e) => `error: ${e}`);
const nav = async (url) => { await send("Page.navigate", { url }, page); await sleep(800); };
const home = () => nav("http://allowed.test/home");

const kinds = [
  ["navigation", "allowed.test", "/nav", () => nav("http://allowed.test/nav")],
  ["iframe", "allowed.test", "/iframe", async () => { await home(); await evalJs(`(()=>{const f=document.createElement('iframe');f.src='http://allowed.test/iframe';document.body.appendChild(f);})()`); await sleep(1200); }],
  ["popup", "allowed.test", "/popup", async () => { await home(); await evalJs(`window.open('http://allowed.test/popup')`); await sleep(1500); }],
  ["download", "allowed.test", "/file.bin", async () => { await home(); await evalJs(`(()=>{const a=document.createElement('a');a.href='http://allowed.test/file.bin';a.download='';document.body.appendChild(a);a.click();})()`); await sleep(1200); }],
  ["fetch", "allowed.test", "/fetch", async () => { await home(); await evalJs(`fetch('http://allowed.test/fetch').then(r=>r.status).catch(e=>String(e))`); await sleep(500); }],
  ["websocket", "ws.test", "", async () => { await home(); await evalJs(`new Promise(res=>{const s=new WebSocket('ws://ws.test/socket');s.onopen=()=>res('open');s.onerror=()=>res('error');setTimeout(()=>res('timeout'),2000);})`); await sleep(300); }],
  ["sendBeacon", "allowed.test", "/beacon", async () => { await home(); await evalJs(`navigator.sendBeacon('http://allowed.test/beacon','x')`); await sleep(1200); }],
  ["https fetch (CONNECT)", "tls.test", "", async () => { await home(); await evalJs(`fetch('https://tls.test/secure').then(r=>r.status).catch(e=>String(e))`); await sleep(800); }],
];

const kindResults = [];
for (const [kind, host, path, run] of kinds) {
  const before = proxyLog.length;
  await run();
  const seen = proxyLog.slice(before).some((e) => e.host === host && (e.kind === "connect" || e.path === path));
  kindResults.push({ kind, seenByProxy: seen });
}

// Rebinding: same name, first lookup public, second private.
const before = proxyLog.length;
await nav("http://rebind.test/r1");
const r1 = await evalJs("document.body ? document.body.innerText : ''");
await nav("http://rebind.test/r2");
const r2 = await evalJs("document.body ? document.body.innerText : ''");
const rebind = { first: proxyLog.slice(before).find((e) => e.path === "/r1"), second: proxyLog.slice(before).find((e) => e.path === "/r2"), r1Body: r1, r2Body: r2 };

// Loopback: does Chrome send 127.0.0.1 through the proxy?
const lb = proxyLog.length;
await nav(`http://127.0.0.1:${HTTP_PORT}/loopback`);
const loopbackSeenByProxy = proxyLog.slice(lb).some((e) => e.path === "/loopback");
const loopbackReachedServerDirectly = upstreamHits.some((h) => h.endsWith("/loopback"));

// WebRTC: gather ICE with a STUN server on a local UDP port.
await home();
const ice = await evalJs(`new Promise(async res=>{const pc=new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${STUN_PORT}'}]});const c=[];pc.onicecandidate=e=>{if(e.candidate)c.push(e.candidate.type+' '+e.candidate.protocol);else res(c)};pc.createDataChannel('x');await pc.setLocalDescription(await pc.createOffer());setTimeout(()=>res(c),4000);})`);
await sleep(500);

console.log(JSON.stringify({
  chrome: (await send("Browser.getVersion")).product,
  flags: { webrtcFlag, loopbackFlag, webrtcArg: webrtcFlag ? (webrtcArg || "--webrtc-ip-handling-policy=disable_non_proxied_udp") : null },
  kindResults,
  rebind,
  loopback: { seenByProxy: loopbackSeenByProxy, reachedServerDirectly: loopbackReachedServerDirectly },
  webrtc: { candidates: ice, udpPacketsToStun: udpPackets },
}, null, 2));
ws.close(); chrome.kill("SIGKILL"); proxy.close(); upstream.close(); udp.close();
await sleep(1000);
for (const d of [profile, downloads]) { try { rmSync(d, { recursive: true, force: true }); } catch {} }
process.exit(0);
```

</details>
