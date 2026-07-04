# MCP delivery across backends — current state and directions

> **Update (2026-07-04, after checking open PRs):** all three short-term items already exist as
> open PRs — S0 = **#5047** (remote-tools fail-loud gate, green, post-rename, reviewed with
> inline decision comments), S1 = **#4873** (in-sandbox stdio MCP relay shim, the A2 variant —
> implemented but pre-rename stale, paths under `services/agent/`), S2 = **#4912** (flip
> `AGENTA_AGENT_MCPS_ENABLED` default to true — implemented, also pre-rename stale). Related:
> **#4985** (client tools to Claude over the internal MCP channel; contains a duplicate of the
> S0 gate) and the E2B provider stack **#5045-#5053** (adds a remote provider the S0 gate's
> `isDaytona` predicate does not cover). The sections below describe the architecture; the PRs
> above are the state of play.

Date: 2026-07-04. Sources: code as of `gitbutler/workspace` (runner at `services/runner/`,
service at `services/oss/src/agent/`, SDK at `sdks/python/agenta/sdk/agents/`), plus the
existing design projects under `docs/design/agent-workflows/projects/`.

---

## Part 1 — What we actually have today

There are **two different things called "MCP"** in the codebase, and they have different
problems. Keeping them separate is the single most important framing (this conflation already
caused one regression, per `scratch/notes-tools-mcp-capabilities.md`).

### Channel 1: the internal "agenta-tools" MCP server (our tools → Claude)

Claude only accepts tools over MCP, so the runner synthesizes an MCP server for our resolved
gateway/code/client tools:

- `startInternalToolMcpServer` (`services/runner/src/tools/tool-mcp-http.ts:181`) runs an HTTP
  MCP endpoint **in the runner process itself**, bound to `127.0.0.1` on an ephemeral port,
  unauthenticated (justified by loopback-only reachability).
- It is advertised to Claude as a `type:"http"` server named `agenta-tools` via the ACP
  `sessionInit.mcpServers` (`engines/sandbox_agent.ts:619-638`) — no `.mcp.json` is written.
- `tools/list` serves **public specs only**; `tools/call` dispatches through the file relay
  (`runResolvedTool` with `relayDir` set), so credentials, `callRef`s, and Composio keys never
  leave runner memory.
- Per-tool permissions land in `.claude/settings.json` as `mcp__agenta-tools__<tool>` rules
  (`sdks/python/.../adapters/claude_settings.py:131-174`).

**The Daytona gap, precisely:** on Daytona, `127.0.0.1` inside the sandbox is the *sandbox's*
loopback, not the runner's, so `buildSessionMcpServers` skips the channel entirely
(`engines/sandbox_agent/mcp.ts:230-232`). Pi still works there because Pi has an **in-sandbox
writer** — its bundled extension registers tools and writes tool-call request files to the relay
dir, which the runner polls (`tools/relay.ts`). Claude has no in-sandbox writer, so **Claude on
Daytona gets zero tools, silently** — the run passes the capability gate (Claude truthfully
advertises `mcpTools`), starts a relay loop nobody feeds, and returns `ok:true`. The log line
"delivered via the file relay" is false for Claude.

The one load-bearing insight from `projects/claude-daytona-tools/research.md`: **tool execution
on Daytona is already solved and harness-agnostic** (the runner-side relay loop executes with
runner-held credentials). Only the **in-sandbox front-end** that turns Claude's tool call into a
relay request is missing. Pi has one (its extension); Claude does not.

### Channel 2: user-declared external MCP servers (`mcp_servers` config)

- Schema: `MCPServerConfig` (`sdks/python/agenta/sdk/agents/mcp/models.py:30`) — `name`,
  `transport` (`stdio`|`http`), `command/args/env` or `url`, `secrets` (vault name → env var),
  `tools` allowlist, per-server `permission`. Sibling field to `tools`, not a tool type.
- Resolution: `resolve_mcp` (SDK, ungated) injects vault secrets; the **service** gates it with
  `AGENTA_AGENT_MCPS_ENABLED` (default **off**; declared servers + flag off → loud
  `MCPDisabledError`, `services/oss/src/agent/tools/resolver.py:23-46`).
- Even with the flag on:
  - **stdio is disabled everywhere** (`run-plan.ts:243-245`) — because a stdio server would spawn
    an arbitrary user process **on the runner host**, outside the sandbox boundary. This is why
    "we can't host external MCP servers ourselves" today.
  - **http is delivered**, but only to non-Pi harnesses (`mcpTools` capability;
    `capabilities.ts:107`), behind an SSRF guard (`validateUserMcpUrl`: https-only, no
    loopback/link-local/private/metadata hosts, allowlist escape hatch
    `AGENTA_AGENT_MCPS_HOST_ALLOWLIST`). Secrets become HTTP headers on the entry the in-sandbox
    Claude adapter connects with.
  - **Pi rejects all user MCP** — pi-acp does not forward MCP. The QA plan's "MCP on Pi (F-009)"
    direction (deliver MCP through the Pi extension) exists on paper and conflicts with the
    also-on-paper "remove user MCP from the sandbox" recommendation. Undecided.

Net: user MCP reaches nobody by default; with the flag on it reaches Claude-like harnesses only,
http-only. Note one subtlety: because the **in-sandbox** ACP adapter makes the connection, remote
http user MCP should work on Daytona as-is (subject to the sandbox egress policy) — the
Daytona gap is specific to Channel 1's loopback URL.

### The communication channels that exist between runner and Daytona sandbox

(from `engines/sandbox_agent/provider.ts`, `daytona.ts`, `tools/relay.ts`)

| Direction | Channel | Notes |
| --- | --- | --- |
| runner → sandbox | Daytona **signed preview URL** to the sandbox-agent daemon (port 3000) | ACP sessions, FS read/write, process exec. Auth = signed URL + proxy cookie. |
| sandbox → runner | **None direct.** Only the runner-polled **file relay** | In-sandbox code writes `<id>.req.json`; runner polls, executes server-side, writes `<id>.res.json`. |
| sandbox → internet | Subject to `networkBlockAll`/`networkAllowList` (Layer-2 policy) | Used by geesefs (via ngrok tunnel) and by any http MCP connection. |

There is no port-forwarding of runner ports into the sandbox and no public runner URL. That is
deliberate: the invariant across the whole tool stack is **credentials never enter the sandbox;
execution stays where the credentials are** (the runner).

---

## Part 2 — Framing: every option is "where does the MCP server run?"

An MCP server in our system has two properties:

- **Trust class:** *ours* (the synthesized agenta-tools server — trusted code, credentialed
  execution) vs *the user's* (arbitrary third-party code or a remote SaaS endpoint).
- **Location:** (a) inside the runner process, (b) inside the sandbox, (c) a remote URL on the
  internet, (d) a platform-hosted service.

Today's matrix and its holes:

| | Local backend | Daytona |
| --- | --- | --- |
| Our tools → Pi | ✅ extension (in-process) | ✅ extension + file relay |
| Our tools → Claude | ✅ runner-loopback MCP (location a) | ❌ **silent zero tools** |
| User http MCP → Claude | ✅ behind flag (location c) | ✅ behind flag (untested) |
| User stdio MCP → anyone | ❌ disabled (would run on runner host) | ❌ disabled |
| Any user MCP → Pi | ❌ pi-acp doesn't forward MCP | ❌ |

The long-term question is which *locations* we commit to supporting, because each location is a
different security and ops contract.

---

## Part 3 — Directions

### Short term

**S1 — Land `claude-daytona-tools` Option A1: the in-sandbox MCP shim (our tools).**
Already fully designed (`../claude-daytona-tools/design.md`), estimated 2-3 days, low risk. Run
the existing dependency-free `tool-mcp-http.ts` server **inside** the sandbox on the sandbox's
own loopback (fixed port), feeding the existing file relay; advertise
`http://127.0.0.1:<port>/mcp` to Claude. It is the exact MCP analogue of Pi's extension: public
specs in, relay requests out, credentials stay runner-side. A2 (a stdio variant Claude spawns
in-sandbox) is the documented fallback if port/readiness management is fiddly. This closes the
headline gap ("our tools on Daytona") and generalizes to Codex or any future MCP-client harness
for free, because the shim speaks MCP, not anything Claude-specific.

**S0 — Until S1 lands, fail loud.** The interim "MCP-client harness + Daytona + tools → explicit
error" gate was designed in the client-tool-cleanup thread but does not appear to be on this
branch. Whatever else we decide, a silent zero-tools `ok:true` run is the worst outcome; the gate
is a ~20-line guard in `run-plan.ts`.

**S2 — Un-gate remote http user MCP when a customer needs it (external SaaS MCP).**
The machinery is built, SSRF-guarded, and fail-loud; it is one env flag
(`AGENTA_AGENT_MCPS_ENABLED=true`). This immediately covers the growing class of *hosted* MCP
servers (Linear, Notion, Context7, Composio's own MCP endpoints...) without us hosting anything.
Caveats to accept consciously: (1) secret headers ride into the sandbox with the server entry —
it is the user's own credential for their own server, but it does cross the boundary; (2)
requires sandbox egress, so it interacts with the Layer-2 network policy; (3) needs one live QA
pass on Daytona (untested cell).

### Long term — three architectures, not mutually exclusive

**L1 — "Sandbox-side front-end" as the standing pattern (extend S1 to user stdio MCP).**
The sandbox is precisely the isolation boundary we already trust to run arbitrary agent-authored
code. The reason user stdio MCP is disabled — arbitrary process on the *runner host* — does not
apply *inside* the sandbox. So: run user stdio MCP servers in the sandbox (install the package at
session prep or bake common ones into the snapshot), let the in-sandbox harness spawn/connect to
them natively, and inject their `secrets` env into the sandboxed process only.

- Pros: solves "npx some-mcp-server"-class servers (the bulk of the ecosystem) with no new
  hosting infra; isolation story is the one we already have; works identically for local (the
  local backend also runs a sandbox-agent daemon) and Daytona.
- Cons: user secrets enter the sandbox (a real, deliberate weakening of the invariant — though
  provider API keys already do exactly this via `envVars`); package install cost per run
  (mitigate: snapshot bake / warm pools); the server's network access is bounded by the sandbox
  egress policy, which becomes a user-visible interaction.
- This is also the natural home for **"MCP on Pi"**: the Pi extension connects to the same
  in-sandbox servers and `registerTool`s them, resolving the F-009-vs-removal conflict with one
  mechanism instead of two.

**L2 — A platform MCP gateway (one authenticated URL that works from anywhere).**
Today "where the harness runs" dictates "how tools are delivered" (runner loopback vs relay vs
shim). A platform-hosted MCP endpoint inverts that: the platform serves
`https://<agenta>/mcp/runs/<run_id>` with a per-run bearer token; any harness on any backend
(local, Daytona, a future k8s/Firecracker backend, even a customer's own machine running our
CLI) connects to the same URL. Behind it, the gateway executes our gateway/code tools with
platform-held credentials and can **proxy approved external http MCP servers** (aggregation),
giving one chokepoint for authn, per-tool authz, HITL approvals, rate limits, auditing, and
tracing of every tool call.

- This is *not* the rejected Option B from `claude-daytona-tools/design.md`. That option was
  "tunnel the runner's intentionally-unauthenticated loopback endpoint," which inverts trust onto
  a privileged port. L2 is a first-class authenticated service designed for exposure: per-run
  minted tokens, run-scoped tool sets, and the SSRF guard stays intact because the URL is a
  legitimate public host.
- Pros: collapses the per-backend special cases into one channel; the industry is converging
  here (hosted MCP gateways); makes tool calls first-class platform events (billing, approvals,
  observability) rather than runner-internal ones.
- Cons: real new surface (token minting/rotation/revocation, a public endpoint that executes
  credentialed actions); latency for chatty tools; requires sandbox egress to the platform;
  self-hosted deployments need the API reachable from sandboxes (true for Daytona-cloud +
  self-hosted-API combos only if the API is public).

**L3 — Managed hosting of user MCP servers (run their server as a platform workload).**
The "we host it for you" end state: each user-declared stdio MCP runs as a platform-managed
container/microsandbox with its own lifecycle, exposed to runs through the L2 gateway. This is
what "support any MCP server, we can't host them ourselves today" ultimately means, but it is a
product decision (a mini-PaaS: images, versions, scaling, secrets, billing) more than an
architecture one. Only worth it with demonstrated demand; L1 covers most of the same servers at
per-run granularity much cheaper.

### How they compose (recommended path)

1. **Now:** S0 fail-loud, then **S1** (in-sandbox shim). Our tools work for Claude/Codex on every
   backend. This is the only urgent item and it is already designed.
2. **When external MCP demand appears:** **S2** (un-gate http) for hosted servers, and **L1**
   (in-sandbox stdio) as the first real feature increment for the rest of the ecosystem. Both
   keep execution/isolation contracts we already have.
3. **When multi-backend + governance pressure appears** (more backends, approvals/audit on tool
   calls, enterprise external-MCP allowlisting): build **L2** and migrate Channel 1 onto it; the
   in-sandbox shim then becomes a fallback for egress-less sandboxes rather than the primary
   path. L3 only on explicit product pull.

The through-line: keep the **seam** stable — "(public tool specs, transport endpoint) → MCP
server" in front, "execution happens where the credentials live" behind — and let the *location*
of the front-end (runner loopback, in-sandbox shim, platform gateway) vary per backend without
forking the relay/execution protocol.

---

## Open questions for the owner

1. Is S1 (the already-designed in-sandbox shim) approved to implement? It is independent of all
   long-term choices.
2. How real is external-MCP demand right now — enough to un-gate http (S2) and schedule L1, or
   still "our tools only"?
3. For L1: is "user secrets may enter the sandbox env (like provider keys already do)" an
   acceptable, documented weakening of the no-credential-in-sandbox invariant?
4. Does the L2 gateway feel like the right eventual convergence (worth shaping new work so it
   doesn't fight it — e.g., keeping the public-spec contract transport-agnostic), or do we
   commit to sandbox-side delivery as the permanent model?
