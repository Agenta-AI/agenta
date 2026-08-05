# Notes: tools, MCP, code tools, sandbox capabilities

Scratch findings + recommendations. Investigation date 2026-06-23. Everything below is cited
to `file:line` against the working tree. Marks: VERIFIED (read the code), STALE (memory hint
that no longer holds), DEAD (code exists but nothing reaches it).

## TL;DR verdict

- **Builtin tools**: live. Pi-only. A bare name added to the session allowlist.
- **Gateway (callback) tools**: live on every path (in-process Pi, Pi-over-ACP, Claude-over-MCP,
  local + Daytona). This is the real, exercised tool path.
- **Code tools**: live and reachable. `python3` IS in the prod image now (the old ENOENT is
  fixed). Caveat: the child env is a tight allowlist, so a code tool that imports a third-party
  package will fail (no pip/venv, no inherited env).
- **Client tools**: plumbed end to end on the runner side (throws in-sandbox, emitted as
  `interaction_request`), but full browser fulfillment is a frontend-egress concern, not
  verified here as working UI.
- **User MCP servers** (`mcp_servers` config): effectively dead on the deployed path.
  Gated OFF by `AGENTA_AGENT_ENABLE_MCP` (default false) at the service, AND gated off for Pi
  in the runner. So today it reaches nobody by default, and even with the flag on it reaches
  Claude only. Pi/agenta is the default harness, so in practice user MCP is dead.
- **Sandbox-side MCP machinery** (`mcp-server.ts` + the `agenta-tools` synthetic server in
  `mcp-bridge.ts`): only used to deliver GATEWAY/CODE tools to a non-Pi (Claude) harness that
  reports `mcpTools`. It is NOT used for user `mcp_servers`. It is reachable only on the Claude
  path. On the default Pi path it is never launched.
- **Capability advertisement**: `HarnessCapabilities` exists in the wire, is probed in the
  runner, gates tool delivery internally, and is returned on the `/run` result. But it is a
  DEAD read on the consume side: parsed into `AgentResult.capabilities` (`dtos.py:297`,
  `wire.py:87`) and then never read by the service, `/inspect`, or the frontend. `/health`
  advertises `engines`/`harnesses` but NOT capabilities.

## End-to-end trace (deployed = sandbox-agent path)

Config -> service resolution -> wire -> runner -> harness.

### 1. Config (SDK)

`AgentConfig.tools` is a list of 4 discriminated configs: `builtin` / `gateway` / `code` /
`client` (`sdks/python/agenta/sdk/agents/tools/models.py:22-77`). `AgentConfig.mcp_servers`
is a SIBLING field, not a tool type (`sdks/python/agenta/sdk/agents/mcp/models.py`).

Three orthogonal axes per tool: `type`/`kind` (executor), `needs_approval`, `render`
(`models.py:22-29` ToolConfigBase; `protocol.ts:52-76`).

"4 executors" = `builtin` (a name, not a spec) + 3 spec kinds: `callback` / `code` / `client`
(`models.py:131-153`). NOTE: the resolved `kind` for a gateway tool is **`callback`**, not
`gateway`. There is no `gateway` kind on the wire. The config `type` `gateway` -> resolved
`kind` `callback` (`resolver.py:162-167`, `models.py:131-137`).

### 2. Service resolution

`services/oss/src/agent/app.py:78-80`:
```
resolved_tools = await resolve_tools(agent_config.tools)
resolved_mcp   = await resolve_mcp_servers(agent_config.mcp_servers)
```
Both are thin re-exports of SDK platform entrypoints. The service files are now shims:
- `services/oss/src/agent/tools/resolver.py` re-exports `resolve_tools` and adds the MCP gate.
- `gateway.py`, `secrets.py`, `__init__.py` are re-export shims to
  `agenta.sdk.agents.platform.*`.

Real resolution: `sdks/python/agenta/sdk/agents/platform/resolve.py:40-65` ->
`ToolResolver.resolve` (`sdks/python/agenta/sdk/agents/tools/resolver.py:102-177`).

Per type:
- `builtin` -> name lands in `builtin_names`, no network (`resolver.py:103-107`).
- `code` -> declared `secrets` resolved by name via the named-secret provider, injected into
  spec `env` (`resolver.py:124-154`). Script not run here.
- `client` -> pass-through to `ClientToolSpec` (`resolver.py:156-159`).
- `gateway` -> `AgentaGatewayToolResolver` posts to API `/tools/resolve`, gets a `call_ref`
  slug, wraps in `CallbackToolSpec` + one `ToolCallback` -> `/tools/call`
  (`resolver.py:161-167`; gateway impl now in `platform/gateway.py`).

MCP gate (THE key gate): `services/oss/src/agent/tools/resolver.py:22-37`. If
`AGENTA_AGENT_ENABLE_MCP` not truthy -> returns `[]`. Default off. So `resolved_mcp` is empty
by default and `mcpServers` is omitted from the wire.

### 3. Wire

`request_to_wire` -> `mcpServers` only when non-empty (`utils/wire.py:54-56`, gated by
`config.wire_mcp()`). `customTools` = resolved specs, `toolCallback` = the callback,
`tools` = builtin names. Wire contract: `protocol.ts` (TS) mirrored by `utils/wire.py`.

### 4. Runner delivery (the fork)

Engine selected by `server.ts:38-49`: default `sandbox-agent`, request `backend:"pi"` picks
the in-process engine. Deployed = `sandbox-agent` (`runSandboxAgent`).

Delivery decision in `engines/sandbox_agent/mcp.ts:50-75` (`buildSessionMcpServers`):
- If `isPi` OR `!capabilities.mcpTools` -> return `[]` (no MCP servers attached). For Pi this
  means NO MCP at all (neither agenta-tools nor user servers). Tools for Pi are delivered the
  Pi-native way via the extension, NOT through this function.
- Else (Claude, `mcpTools` true) -> attach `buildToolMcpServers(...)` (the synthetic
  `agenta-tools` server carrying gateway/code specs) + `toAcpMcpServers(userMcpServers)`.

So:
- **Pi-native delivery**: the bundled extension (`extensions/agenta.ts:38-75`) reads
  `AGENTA_TOOL_PUBLIC_SPECS` + `AGENTA_TOOL_RELAY_DIR` and calls `pi.registerTool` per spec.
  Execution goes through `runResolvedTool` (`tools/dispatch.ts:104`) -> relay file ->
  runner-side `startToolRelay` (`tools/relay.ts:121`) -> `/tools/call` (gateway) or local
  `python3`/`node` (code). The extension env carries PUBLIC metadata only; private specs/auth
  stay in runner memory (`pi-assets.ts:31-50`).
- **Claude MCP delivery**: `mcp-bridge.ts:63` builds the `agenta-tools` ACP stdio server;
  `mcp-server.ts` is the bridge process; it relays calls back via `runResolvedTool` with a
  `relayDir`. User `mcp_servers` (if the flag were on) would be ADDITIONAL ACP stdio servers
  via `toAcpMcpServers` (`mcp.ts:15-36`), but pi-acp does not forward those and they are
  gated off for Pi.

### 5. In-process engine (reference only)

`engines/pi.ts:150-198` (`buildCustomTools`) branches on kind directly: code -> local
subprocess, callback -> `/tools/call`, client -> skipped. Ignores `request.mcpServers`
ENTIRELY (`PI_CAPABILITIES.mcpTools = false`, `pi.ts:60`). Not the deployed path.

## What is live / gated / dead, with evidence

| Thing | State | Evidence |
| --- | --- | --- |
| Builtin tools (Pi) | LIVE | `resolver.py:103-107`; allowlist `pi.ts:280-283` |
| Gateway/callback tools | LIVE all paths | `callback.ts:32`; relay `relay.ts:103-112`; Pi ext `agenta.ts:60-71` |
| Code tools | LIVE; `python3` in image | `code.ts:115`; `Dockerfile:27` installs `python3` |
| Client tools | PLUMBED (runner); FE unverified | throws `dispatch.ts:112-115`; filtered `mcp-server.ts:63`, `public-spec.ts:17` |
| User `mcp_servers` | GATED OFF (default) + Pi-dead | service gate `resolver.py:22-37`; runner gate `mcp.ts:61` |
| `agenta-tools` synthetic MCP server | LIVE only on Claude path | `mcp-bridge.ts:63`, `mcp-server.ts`; never built for Pi `mcp.ts:61` |
| `HarnessCapabilities` probe | LIVE in runner, gates delivery | `capabilities.ts:42-52`, used `sandbox_agent.ts:183-193` |
| `result.capabilities` consume | DEAD | parsed `wire.py:87`/`dtos.py:297`, read by nobody downstream |
| `needs_approval` | Claude-only honored | responder `responder.ts`; Pi no-op |
| `render` | runner copies hint; FE projection partial | `protocol.ts:133-136`, copied onto events |

## STALE memory hints, corrected

- "missing python3 in the agent image (python code tools ENOENT)" -> STALE/FIXED. The prod
  Dockerfile installs `python3` (`services/agent/docker/Dockerfile:26-28`) with a comment that
  names exactly this failure mode. Code tools with `runtime: python` work in the prod image.
  (Caveat below: only the interpreter, no third-party packages.)
- "stale Pi extension bundle (custom tools silently undelivered on rivet)" -> partially
  current as a CLASS of risk. The extension is a baked esbuild bundle
  (`pi-assets.ts:24-25`, `Dockerfile:48`). If the image is built without `build:extension`,
  or `SANDBOX_AGENT_EXTENSION_BUNDLE` points at a stale file, tools silently do not register
  (`installPiExtensionLocal` logs and returns, `pi-assets.ts:53-65`). The prod Dockerfile does
  run `build:extension`, so the prod image is fine; the risk is dev/compose images that
  override CMD or skip the build step. This is a build-hygiene risk, not a code bug.
- "MCP gated behind AGENTA_AGENT_ENABLE_MCP, claude-only" -> VERIFIED, still true.

## Real, current gaps and oddities (the "does not make sense" list)

1. **User MCP is dead by default and Pi-impossible.** `AGENTA_AGENT_ENABLE_MCP` defaults off.
   Even on, `buildSessionMcpServers` drops user MCP for Pi (`mcp.ts:61`), and Pi is the default
   harness. So the entire `mcp_servers` config field is a silent no-op for the common case. The
   field is accepted, serialized only when the flag is on, then dropped at the runner. This is
   the silent-drop F-009 the harness-capabilities project is about.

2. **Two MCP machineries that do different things share the word "MCP".** (a) The synthetic
   `agenta-tools` server (`mcp-bridge.ts` + `mcp-server.ts`) is an internal TOOL DELIVERY
   vehicle for Claude - it has nothing to do with user-declared MCP. (b) `toAcpMcpServers`
   delivers user `mcp_servers`. Both live under "MCP" and both are off on the default path.
   This conflation is most of the confusion.

3. **`HarnessCapabilities` is half a feature.** The runner probes it and gates on it, which is
   good, but the probe almost always falls back to the STATIC per-harness guess
   (`capabilities.ts:24-39`) because `sandbox.getAgent(...).capabilities` is usually absent. And
   the result it returns is read by nobody. So we pay for a probe whose only real effect is the
   internal `mcpTools` branch, which a static `harness === "pi"` check would do identically.

4. **Code tools cannot import packages.** `buildChildEnv` (`code.ts:99-108`) gives the child
   only PATH/HOME/locale/temp + the tool's own secrets. The image has `python3` and `node` but
   no `pip install`/`npm install` of arbitrary deps at tool time, and no `NODE_PATH` to the
   runner's `node_modules`. So a code tool is limited to the stdlib. Fine for glue, surprising
   for anything real. Worth documenting as a constraint, not necessarily removing.

## Removal proposal: take user-MCP out of the sandbox

User said: "the way we implement it does not make sense; remove it at least from the sandbox."
Reading: remove the user-declared MCP plumbing from the sandbox-agent runner (NOT the
gateway/code tool delivery, which happens to also use an MCP server for Claude). Below is a
precise, code-free plan (other sessions own the code; this is a plan).

### What is safe to remove (sandbox/runner side)

The user-MCP path is small and isolated:

- `services/agent/src/engines/sandbox_agent/mcp.ts`: `toAcpMcpServers` (the user-MCP -> ACP
  stdio converter) and its call inside `buildSessionMcpServers` (the `...toAcpMcpServers(...)`
  spread, `mcp.ts:73`). Keep `buildToolMcpServers` (that is the Claude tool-delivery vehicle).
- The `userMcpServers` parameter threaded into `buildSessionMcpServers`
  (`sandbox_agent.ts:189`, `mcp.ts:43,60,62`).
- `McpServerConfig` on the wire (`protocol.ts:89-97`) and `mcpServers` on `AgentRunRequest`
  (`protocol.ts:227`) - ONLY if we also drop the field service-side; otherwise leave the wire
  field but stop consuming it.

### What depends on it / what breaks

- Nothing in the deployed path breaks, because it is already gated off
  (`AGENTA_AGENT_ENABLE_MCP` default false). Removing it changes behavior only for someone who
  set the flag AND used Claude AND declared `mcp_servers`. That is a near-empty set.
- The golden wire-contract fixtures pin `mcpServers` (`services/agent/CLAUDE.md` wire rules).
  Removing the field means updating `protocol.ts` + `utils/wire.py` + both golden fixtures +
  both contract tests, deliberately, together. This is the only real cost.
- `toAcpMcpServers` is re-exported (`sandbox_agent.ts:75`) and has unit tests; those go too.

### Recommended shape (simplest honest end state)

Two clean options. Prefer **A** if we want to keep the door open, **B** if we want it gone.

**Option A - keep the field, stop pretending it works on the default path; make the drop loud.**
Leave `mcp_servers` in config and on the wire, but:
- Delete `toAcpMcpServers` user-MCP delivery from the runner (it only ever reached Claude, off
  by default). 
- Make the SERVICE reject a non-empty `mcp_servers` for a harness that cannot honor it (fail
  loud, per the harness-capabilities proposal slice 1), instead of silently dropping at the
  runner. This is the smallest change that removes the silent no-op.
- Result: the sandbox no longer carries user-MCP code; the boundary tells the user "this
  harness does not support MCP" up front.

**Option B - remove user MCP entirely (config + wire + runner).**
- Drop `AgentConfig.mcp_servers`, the `MCPResolver`, `resolve_mcp_servers`,
  `AGENTA_AGENT_ENABLE_MCP`, the `mcpServers` wire field, `toAcpMcpServers`, and the
  `agenta.sdk.agents.mcp` package's user-server half.
- Keep `buildToolMcpServers`/`mcp-server.ts` (Claude tool delivery) untouched - it is not user
  MCP.
- Update the golden wire fixtures + contract tests in the same change.
- Result: the only "MCP" left in the tree is the internal Claude tool-delivery server, which
  could even be renamed away from "MCP" (e.g. `tool-bridge`) to kill the conflation.

### What NOT to remove

- `mcp-server.ts` / `mcp-bridge.ts` `buildToolMcpServers` / the relay: these deliver GATEWAY
  and CODE tools to Claude. Removing them breaks tools on the Claude harness. They are
  mislabeled (they are a tool bridge that happens to speak MCP), not dead.
- The Pi extension tool path: that is the main tool delivery for the default harness.

### My recommendation

Option A now (cheap, removes the silent failure, shrinks the sandbox), Option B later if the
product decides user-MCP is not a near-term feature. If Part 1 of the harness-capabilities
proposal (MCP on Pi via the extension) is actually wanted, that is the OPPOSITE of removal and
the two should not both be in flight - decide first.

## Capability advertisement proposal

### Current state (verified)

- `/health` returns `{ status, runner, protocol, engines, harnesses }`
  (`version.ts:27-35`). No capabilities. `HARNESSES = ["pi","claude","agenta"]` is a flat list.
- `HarnessCapabilities` is probed per RUN inside the runner (`capabilities.ts`), used only to
  gate tool delivery (`sandbox_agent.ts:183`), and returned on the result. The probe is mostly
  the static fallback because the daemon rarely fills `info.capabilities`.
- The consume side is dead: `AgentResult.capabilities` is parsed and dropped. No `/inspect`
  surface, no FE gate, no service gate.
- There is a substantial design already: `projects/harness-capabilities/proposal.md` argues for
  a static per-harness capability table in `sdks/python/agenta/sdk/agents/capabilities.py`, with
  the runtime probe as a narrowing Layer 2, surfaced via `/inspect` as a `harness_capabilities`
  map, and a fail-loud backend reject. `capability-map.md` documents the actual web/exec/read/
  write matrix per harness x sandbox.

### What the runner SHOULD advertise (and how)

Two grains, both worth having:

1. **Static, run-independent, on `/health`** (the version-skew sibling). Extend `runnerInfo()`
   so `harnesses` is not a flat list but a map: per harness, the static capability set the
   runner believes it can drive (`mcpTools`, `permissions`, `images`, `planMode`, plus a
   `toolDelivery` tag: `pi_native` | `acp_mcp`). This is the "what MAY run" contract a schema
   and a form can read before any run. It is the runner half of the harness-capabilities
   static table; pin it against the SDK table with a golden contract test (same discipline as
   the wire contract).

2. **Dynamic, per-run, on the `/run` result** (already exists as `capabilities`). Keep it, but
   make it CONSUMED: the service should (a) compare probed vs static and log drift, (b)
   optionally fold a small subset into the `/invoke` response or a span attribute so the
   product can see what actually ran. Today this field is wasted.

### How the service consumes it

- At schema/`inspect` time: read the static map (from the SDK table, mirrored from `/health`)
  and emit a `harness_capabilities` document so the FE can show/hide `mcp_servers`,
  `permission_policy`, and gate `model`. This is proposal Part 2 slice 2.
- At invoke time (fail loud): before starting the runner, reject a non-empty config field the
  selected harness cannot honor (`mcp_servers` on pi/agenta; an unsettable `model`). This is
  proposal Part 2 slice 1 and the single highest-value change - it converts the silent drop
  into an honest error. It does not need the runner change to land; the SDK static table is
  enough.
- At result time: intersection check. If the probe reports LESS than the static table for a
  capability the user asked for, fail or warn loudly; if MORE, log drift.

### Minimal first step

Land the SDK static capability table + the backend fail-loud reject (proposal slice 1). It
needs no runner change, kills the worst silent failures (user MCP on Pi, model on sandbox-agent),
and gives the FE something to read. The `/health` capability map and the consume-the-probe work
are good follow-ups but not the bottleneck.

## Open questions (for the user)

1. Is user-declared `mcp_servers` a real near-term product feature, or scratch? If scratch,
   Option B (remove entirely) is cleanest. If real, the right move is the harness-capabilities
   Part 1 (MCP on Pi via extension), which is the opposite of removal. These conflict - pick one.
2. Should the internal Claude tool-delivery server keep the name "MCP"? Renaming it (e.g.
   `tool-bridge`) would end the conflation that makes all of this confusing. It speaks MCP on
   the wire to the harness, but it is an Agenta tool relay, not a user MCP server.
3. Do we want `result.capabilities` consumed at all, or should it be removed too? It is dead
   today. Either wire it into `/inspect`/the FE (per the proposal) or drop it from the result.
4. Code tools are stdlib-only (no package install). Is that the intended contract, or do we
   want a provisioning story (a base image with common libs, or a per-tool deps manifest)?
5. The capability probe is mostly the static fallback. Is it worth keeping the probe at all
   before the daemon actually fills `info.capabilities`, or should we ship the static table now
   and add the probe when there is real data to probe?
</content>
</invoke>
