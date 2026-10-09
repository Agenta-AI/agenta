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

1. **DNS rebinding.** The policy resolved names from a fixed table. In production the policy must resolve a name itself, and Chrome resolves it again when it connects. A host that answers a public address to the policy and a private address to Chrome would pass. Interception cannot change the address Chrome connects to. This needs a design answer before Phase 3; see F-027 in [findings.md](findings.md).
2. **Inside a Daytona sandbox.** Repeat this check in the browser sandbox during 0.1.
3. **Request kinds not tried:** WebSocket connections, service workers, `navigator.sendBeacon`, prefetch and prerender, and redirects from an allowed host to a blocked one.

<details>
<summary>Script used (throwaway, not part of the build)</summary>

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
