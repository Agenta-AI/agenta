# Design — Claude custom tools on Daytona

Goal: deliver custom tools (gateway/callback, client, and — when re-enabled — code) to an
**MCP-client harness (Claude)** running in a **remote Daytona sandbox**, where it gets **zero** tools
today (see [`research.md`](./research.md)). This is the real fix. The honest fail-loud error ships
separately in the client-tool-cleanup PR; once this lands, that gate stops firing on
Claude+Daytona+tools.

## The shape of the problem in one sentence

Tool **execution** on Daytona is already solved and harness-agnostic (the runner-side relay loop with
`sandboxRelayHost`); only the **in-sandbox front-end** that turns Claude's tool call into a relay
request is missing — Pi has one (its extension), Claude does not.

So every option is really a choice of *where the front-end lives* and *how Claude reaches it*.

---

## Option A — In-sandbox MCP shim feeding the existing file relay (RECOMMENDED)

Run the internal MCP server **inside** the sandbox, on the sandbox's own loopback (reachable by
in-sandbox Claude), and have its `tools/call` handler write to the relay dir the runner already polls.
This is the MCP analogue of Pi's in-sandbox extension.

### Why it is small: the shim is the existing server, relocated

`startInternalToolMcpServer(specs, relayDir, log)` (`tool-mcp-http.ts:182`) already:

- binds `HOST = "127.0.0.1"` (`:49`) — **inside the sandbox this is the sandbox loopback, which is
  exactly what we want** (no code change to the host);
- serves `tools/list` from public metadata, client tools filtered (`:97-99`);
- on `tools/call` writes a relay req and polls the res, because it calls
  `runResolvedTool(spec, args, { relayDir })` and `relayDir` is set (`:123` → `dispatch.ts`
  `relayToolCall`).

Run that **inside** the sandbox against the **sandbox** relay dir and the runner's relay loop
(`startToolRelay` + `sandboxRelayHost`, already running) reads/executes/answers exactly as it does for
Pi. The relay-file protocol is identical, so **one** relay loop serves both Pi and Claude on Daytona.

### What is new (small, mechanical, mirrors existing patterns)

1. **A shim entrypoint + bundle.** A ~30-line entry that reads `AGENTA_AGENT_TOOLS_PUBLIC_SPECS`,
   `AGENTA_AGENT_TOOLS_RELAY_DIR` (the *same* env vars Pi's extension reads), and a new
   `AGENTA_AGENT_TOOL_MCP_PORT`, then calls `startInternalToolMcpServer(publicSpecs, relayDir)` on
   that fixed port. Bundled self-contained with esbuild, mirroring `build:extension`/`EXTENSION_BUNDLE`
   (`pi-assets.ts`). The server has **no third-party deps** (`node:http`/`node:fs`/`node:crypto`), so
   the bundle is tiny and node-version-tolerant; the `-full` Daytona base already ships node.
   - The shim is handed **public specs only** (`publicToolSpecs`, `public-spec.ts`). With `relayDir`
     set, the dispatch never reads a private field, so no `callRef`/`code`/`env`/auth ever enters the
     sandbox — same credential posture as today.
2. **`startInternalToolMcpServer` gains an optional `{ host, port }`.** Today it hardcodes port `0`
   (`:264`); the shim needs a fixed, known port so the runner can advertise the URL without a
   read-back. `host` stays `127.0.0.1`. Local behavior is unchanged (omit → port 0).
3. **Upload + start helpers in `daytona.ts`**, mirroring `uploadPiExtensionToSandbox` +
   `installPiInSandbox`:
   - `uploadToolMcpShimToSandbox(sandbox, dir)` — `writeFsFile` the bundle (a few hundred KB).
   - `startToolMcpShimInSandbox(sandbox, { specsJson, relayDir, port })` — `sandbox.runProcess` a
     detached `sh -c 'node shim.js >/tmp/shim.log 2>&1 &'` with the three env vars, then poll a
     readiness signal (a `GET /` returning 405, or a `ready` file the shim touches) before returning.
   - Fold both into a `prepareDaytonaToolMcpShim(...)` that returns the **sandbox-loopback URL**, run
     in the engine's `if (plan.isDaytona)` block next to `prepareDaytonaPiAssets`
     (`engines/sandbox_agent.ts:336`).
4. **Flip the Daytona skip into an advertise.** `buildSessionMcpServers` (`mcp.ts:489`) currently
   returns `{ servers: [], … }` for the internal channel when `isDaytona` (`:515`). Instead, when
   `isDaytona` **and** the harness is non-Pi **and** there are executable specs, emit a
   `McpServerHttp` entry `{ type:"http", name:"agenta-tools", url:"http://127.0.0.1:<port>/mcp",
   headers: [] }` (the entry shape is unchanged, `mcp.ts:306`; only the URL host differs). The process
   *start* stays in the engine (where the sandbox handle lives); `buildSessionMcpServers` just needs
   the port (config) to build the URL — keep it a pure URL-builder, no I/O.
5. **Client-tool parking through the shim.** The relay loop already parks client tools
   (`relay.ts:741-761`). On Daytona the shim writes the req, the loop sees `kind:"client"` → park →
   writes **no** res, so the shim's poll would block. This is the **same** "park must emit no result,
   abort the in-flight call" problem the **client-tool-cleanup** project is solving for local Claude;
   the in-sandbox shim inherits that fix verbatim (it is the same `tool-mcp-http` handler). **Sequence
   this project after, or alongside, that park redesign** so client-tool park on Daytona composes
   instead of timing out. Gateway/callback tools have no such dependency and can land first.

### Lifecycle and edge cases

- **Readiness race.** Claude may request `tools/list` at session init. Start the shim and confirm it
  is listening (readiness poll) **before** `createSession` (`engines/sandbox_agent.ts:422`). A2 below
  sidesteps this entirely.
- **Fixed port.** The sandbox is single-run, so a fixed high port (e.g. `8771`, clear of the daemon/
  preview) cannot collide. A file-based port read-back is the robust fallback if a clash ever appears.
- **Teardown.** The sandbox is `ephemeral` and deleted in the engine `finally`
  (`sandbox_agent.ts:699`), which reaps the shim; an optional best-effort `pkill` is cheap insurance.
- **Network policy.** The shim is loopback-only and needs no egress, so it works under `network: off`.
  Execution stays runner-side, so the existing strict-network refusal (`run-plan.ts:956`) is unchanged.

### Two transports of the same idea (separate the intent from the mechanism)

The intent — *an in-sandbox MCP front-end over the file relay* — has two viable transports:

- **A1 — HTTP on the sandbox loopback (primary).** Smallest diff: relocate `tool-mcp-http.ts` as-is,
  add the fixed-port param, advertise `type:"http"`. Cost: manage a port + a readiness poll.
- **A2 — stdio MCP that Claude spawns in-sandbox (fallback).** Advertise an internal `McpServerStdio`
  entry whose `command` is `node shim.js` (the same handler over stdio framing). The Claude Agent SDK
  spawns it inside the sandbox and speaks the MCP handshake synchronously, so there is **no port and no
  readiness race**, and lifecycle is tied to Claude's session. Cost: it re-touches the
  deliberately-disabled stdio path — but the disable is about stdio **on the runner host**
  (`mcp.ts:431`, `run-plan.ts:943`); a *synthesized, internal* stdio server *inside the sandbox* is a
  different category and is safe. It must be plumbed so it does not relax the **user** stdio gate.

Recommendation: build **A1** first (least new surface, closest to shipped code); keep **A2** as the
fallback if port/readiness management proves fiddly.

**Effort: ~2-3 focused days incl. live QA. Risk: low. Reuse: very high** (relay loop, dispatch,
file protocol, MCP server, public-spec contract, upload/start patterns, snapshot recipe — all reused).

---

## Option B — Expose the runner's MCP server to the sandbox over the network (NOT recommended)

Make the runner's existing loopback MCP server reachable from the sandbox — e.g. tunnel it via the
ngrok `remote` profile already used for mounts (`mount.ts:251` `discoverTunnelEndpoint`), or a Daytona
reverse/preview route — and advertise that URL to Claude.

Why this is the wrong trade:

- **It inverts the trust direction onto a privileged, unauthenticated endpoint.** The endpoint is
  unauthenticated *by design* because it is loopback-only (`tool-mcp-http.ts:48`,
  `mcp-bridge.ts:1000`). Exposing it means anyone who reaches the tunnel can drive `tools/call`, and
  the runner will execute credentialed gateway/callback actions with the run's auth. To make this
  safe you must **add** a per-run bearer the runner mints, threads into the MCP `headers`, validates,
  and rotates — net-new auth surface and lifecycle.
- **It fights the SSRF guard.** `validateUserMcpUrl`/`isInternalHost` (`mcp.ts:341-379`) exist to stop
  exactly "a sandbox-reachable URL the runner attaches a credential to, pointed at an internal host."
  You would either exempt the internal channel from the guard or make the runner publicly reachable on
  a tool-execution port — the precise exfiltration shape the guard prevents.
- **It couples tool delivery to tunnel infra** (the `remote` compose profile / ngrok) that exists for
  durable mounts, plus per-run ephemeral port registration.

It reuses the MCP server as-is but wraps it in auth + tunnel + guard-exemption machinery.
**Effort: medium-high. Risk: high (new inbound privileged surface). Recommendation: avoid.**

---

## Option C — other options considered

- **C1 — Daytona-native tool channel.** There is no out-of-band host↔sandbox tool primitive; the SDK
  offers only FS + `runProcess` + the ACP edge (`research.md`). **The file relay already is the
  Daytona-native channel.** C1 collapses into A.
- **C2 — Run the agent service / a tool-resolver inside the sandbox and resolve there.** Would require
  shipping the resolver, the Composio key, and connection auth into the sandbox — violating the
  no-credential-in-sandbox constraint. Rejected.
- **C3 — Pre-resolve/inline tool results.** Gateway/callback tools are dynamic, credentialed, and
  side-effecting; client tools need a browser round-trip. Not expressible as static inlining. Rejected.
- **C4 — Snapshot-bake the shim and auto-start it from the daemon.** This is an *operational variant*
  of A (bake vs per-run upload), not a different architecture — folded into A's packaging section.

---

## Ranking

| Option | Effort | Risk | Reuse | New attack surface | Verdict |
| --- | --- | --- | --- | --- | --- |
| **A1** in-sandbox HTTP-loopback shim | ~2-3 d | **Low** | **Very high** | None (sandbox loopback only) | **Recommended** |
| **A2** in-sandbox stdio shim | ~2-3 d | Low-med (stdio-disable optics) | High | None | Fallback to A1 |
| **B** expose runner MCP over network | Med-high | **High** | Medium (+ auth/tunnel/guard) | Inbound privileged port | Avoid |
| C1/C2/C3 | — | — | — | — | Not viable / collapse into A |

## Recommendation

Build **Option A1**: an in-sandbox HTTP MCP shim, on the sandbox loopback, that writes to the existing
file relay. It is the smallest correct change — it relocates an already-shipped, dependency-free server
into the sandbox and reuses the entire execution path untouched — and it adds **no new network
surface**, since the endpoint stays loopback-only and no credential ever enters the sandbox. Keep
**A2** (stdio) as the fallback if port/readiness management is annoying. Land **gateway/callback tools
first** (no parking dependency); land **client-tool delivery after/with the client-tool-cleanup park
redesign**, which the shim inherits for free.

---

## Interface / seam design (design-interfaces lens)

The reusable seam is **the in-sandbox tool front-end**: `(public tool specs, relay dir) → an MCP
server`. There are already two implementations (Pi's extension, the runner-local HTTP server); the
shim is a third *of the same seam*, differing only in **where it runs** and **which port**. Naming the
seam keeps the three honest and prevents the relay protocol from forking.

Classifying every field the design touches by **role**, not by feature:

- **input** (what to serve): the **public tool specs** — `name`, `description`, `inputSchema`, `kind`,
  `render` (`public-spec.ts` `PublicToolSpec`). Carried as `AGENTA_AGENT_TOOLS_PUBLIC_SPECS` — the
  **exact** var the Pi extension already reads. One source of truth for the public-spec contract; do
  not introduce a parallel var.
- **routing** (where requests go): the relay dir — `AGENTA_AGENT_TOOLS_RELAY_DIR`, reused verbatim.
- **config** (how the shim binds): the listen port — new `AGENTA_AGENT_TOOL_MCP_PORT` (sandbox-only),
  default a fixed high port. Belongs under the shim it configures, not in the wire request.
- **credentials**: **none cross the boundary** — by design. The shim has no `credentials` field
  because execution is server-side. This is the role-separation payoff: the sandbox front-end gets
  `input` + `routing` + `config` only; `credentials` stay with the executor (the runner relay loop).
- The **advertised MCP entry** (`McpServerHttp` `{type,name,url,headers}`, `mcp.ts:306`) is unchanged.
  `url` is the in-sandbox shim's address (the endpoint sits under the thing being contacted, per
  design-interfaces rule 4); `headers: []` (no credential on the wire, rule 3/8). On Daytona the only
  delta is the `url` host = sandbox loopback.
- The **relay-file protocol** (`{toolName,toolCallId,args}` / `{ok,text?,error?}`, `relay.ts:578-587`)
  is the stable contract between *any* in-sandbox writer and the runner loop. **Invariant: the shim
  must emit byte-identical req files to the Pi extension**, so one relay loop serves both. Pin this
  with a golden.
- **`buildSessionMcpServers` inputs are unchanged** — it already takes `isDaytona`, `toolSpecs`,
  `relayDir`; it gains only the port (config) to build the Daytona URL. Keep it a pure URL-builder; the
  process start is a sandbox side-effect that belongs in the engine alongside `prepareDaytonaPiAssets`.
- **Separate intent from mechanism** (rule 10): the design names the intent (*in-sandbox MCP front-end
  over the relay*) and lets the mechanism (A1 HTTP-loopback vs A2 stdio) be swappable behind it.

This keeps the new code consistent with the existing role boundaries: public metadata flows out to the
sandbox, credentials never do, and execution stays where the credentials are.

---

## Test + live-QA plan

Unit (no LLM):

- Shim entry boots from env; `tools/list` returns the public specs with `client` filtered
  (`tool-mcp-http.ts:97`); `tools/call` writes a well-formed `<id>.req.json` and returns the text from
  the matching `<id>.res.json`. Reuse the existing `tool-mcp-http` tests; parameterize the port.
- `startInternalToolMcpServer` with a fixed `{host,port}` binds and serves; with no port it still uses
  ephemeral `0` (local path unchanged).

Integration (no LLM):

- Start the shim against a temp relay dir; run a real `startToolRelay(localRelayHost(), …)` that
  answers a callback (httpx-mocked `/tools/call`); assert the round-trip text. This exercises the full
  front-end → relay → executor → response chain in-process.

Contract / golden:

- Golden-pin the `.req.json` the shim writes and assert it is byte-identical to the Pi extension's req
  (same `{toolName,toolCallId,args}`), so the shared relay loop cannot silently diverge per harness.

Live QA (the matrix cell that is false-green today — `agent-workflows-qa` skill):

- **Claude + Daytona + gateway tool** (github via the `pi-agents` project, which holds live Composio
  connections and uses its own API key): assert the tool **actually executes** and the result lands in
  the answer — not a silent zero-tools run. This is the headline acceptance.
- **Claude + Daytona + client tool** (`request_connection`): parks correctly across the turn boundary
  (composes with the client-tool-cleanup park redesign).
- **Negatives:** Claude + Daytona with **no** tools still answers (shim not started); **Pi + Daytona**
  unaffected (still uses its extension); **Claude + local** unaffected (still the runner-loopback MCP).
- **Replay:** capture one green Claude+Daytona+gateway `/run` and pin it via the `agent-replay-test`
  skill so the path regression-tests forever without a live LLM.
- **Sandbox hygiene (memory):** confirm Daytona credits first, use a cheap model, and never leave a
  sandbox open — verify the ephemeral auto-stop reaps it (`provider.ts` `daytonaAutoStopMinutes`).

## Packaging / snapshot implications

- **Default — per-run upload.** `writeFsFile` the shim bundle into the sandbox per run, mirroring
  `uploadPiExtensionToSandbox`. Lowest friction; the bundle is tiny and dependency-free; node is
  present in the `-full` base.
- **Optimization — snapshot bake.** Add the shim bundle to `sandbox-images/daytona/build_snapshot.py`
  (the same place `pi` and `geesefs` are baked) and gate the per-run upload behind an env flag
  (mirror `AGENTA_AGENT_SANDBOX_PI_INSTALLED=false`). Saves the per-run upload once the path is hot.
  Carries no licensing change — the shim is Agenta code, not a third-party harness.

## Open questions for the owner

1. **Transport:** approve **A1 (HTTP-loopback)** as primary with **A2 (stdio)** as the documented
   fallback? (Recommendation: yes.)
2. **Sequencing:** land **gateway/callback** delivery first (no park dependency), then **client-tool**
   delivery folded in with the client-tool-cleanup park redesign — agreed?
3. **Packaging:** start with **per-run upload**, add the **snapshot bake** as a follow-up optimization
   — agreed?
4. **Port:** fixed high port (simplest) vs file-based read-back (robust)? (Recommendation: fixed; the
   sandbox is single-run.)
