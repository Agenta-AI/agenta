# Harness capabilities: proposal

Two proposals, backed by `research.md`.

1. Turn MCP on by default for the `pi` and `agenta` harnesses, through a Pi extension. This
   closes finding F-009 (`../qa/findings.md:268`).
2. Put the harness-to-capability mapping in one place so the schema, `inspect`, the frontend,
   and the backend all read the same source of truth. This closes the silent-no-op half of both
   F-009 (MCP dropped on pi/agenta) and F-007 (model picker ignored on sandbox-agent,
   `../qa/findings.md:205`), and it makes the model-config sibling proposal
   (`../model-config/proposal.md`) the first instance of a general framework.

## Part 1: MCP on Pi by default

### The decision

Pi can do MCP. Not in core (that was removed on purpose, `README.md:493`), but through a Pi
extension that registers each MCP server's tools via `pi.registerTool()`. We already install a
bundled Agenta Pi extension on every Pi run and already register gateway/code tools through it
(`services/agent/src/extensions/agenta.ts:38-75`). So enabling MCP on Pi is an extension feature
we add to machinery we own. It is the same shape as the tool-relay we already ship.

This is the right call because the alternative (pi-acp forwarding MCP) is not ours to fix:
pi-acp accepts `mcpServers` and deliberately does not forward them
(`pi-acp README:198`), pointing users at an extension instead. We control the extension; we do
not control pi-acp.

### Where the MCP bridge runs

Add an MCP client to the Agenta Pi extension (or a sibling bundled extension loaded the same
way). On extension load, when MCP servers are wired, it:

1. Reads the resolved MCP server list from the environment (the same public-only env channel the
   tool relay already uses, `agenta.ts:40-42`). The servers are resolved server-side with vault
   secrets injected into `env` before they reach the extension.
2. Connects an MCP client per server (stdio first; HTTP/remote deferred, matching the current
   ACP gate at `sandbox_agent.ts:483-484`).
3. Lists each server's tools and calls `pi.registerTool()` for each, with an `execute` that
   proxies the call to the MCP client and returns the result as content blocks. This is exactly
   the pattern `registerTools` already uses, with the proxy target being an MCP client instead of
   the runner relay.

This composes cleanly with the existing synthesized `agenta-tools` server: on the in-process and
Pi-over-ACP paths, gateway and code tools are delivered as Pi-native registered tools
(`agenta.ts`, `pi.ts:buildCustomTools`), NOT over the `agenta-tools` MCP server (that server is a
non-Pi delivery vehicle, `mcp-bridge.ts:1-12`). So on Pi there is no `agenta-tools` MCP server to
collide with: user MCP tools and Agenta tool-relay tools both become registered Pi tools, in one
flat tool list. No double delivery, no name collision beyond what already exists between user
tools and Agenta tools (which the Pi allowlist already governs, `pi.ts:278-283`).

### The delivery shape: direct tools, not a proxy tool

`pi-mcp-adapter` defaults to a single proxy `mcp` tool to save context, with an opt-in
`directTools` list. For Agenta we want the opposite default: register each MCP tool directly, so
the model sees the user's declared MCP tools as first-class tools, the same way it sees them on
Claude. Our agent configs are small and explicit (the user named the servers), so the
context-saving proxy is not worth the indirection or the behavior difference from Claude. Keep a
proxy mode as a future option if a server exposes a very large tool surface.

### Wiring it on each path

- **In-process Pi (`engines/pi.ts`):** today it ignores `request.mcpServers` entirely. Add an
  MCP-client setup that registers the servers' tools as `customTools` alongside the existing
  `buildCustomTools` output, and add the registered names to the Pi allowlist
  (`pi.ts:280-283`). Flip `PI_CAPABILITIES.mcpTools` to true once this lands.
- **Pi over sandbox-agent/ACP (`engines/sandbox_agent.ts`):** stop gating MCP on `!isPi`. For Pi, pass the
  resolved MCP servers to the extension through its env channel (next to
  `AGENTA_TOOL_PUBLIC_SPECS`), and let the extension connect and register them. Do NOT pass them
  through `sessionInit.mcpServers` for Pi (pi-acp drops those). The non-Pi branch (Claude/Codex)
  keeps using `sessionInit.mcpServers` unchanged.
- **Daytona:** the extension is already uploaded to the sandbox (`uploadPiExtensionToSandbox`,
  `sandbox_agent.ts:243-253`); the MCP server env rides the same `daytonaEnvVars` channel the tool relay
  uses. stdio MCP servers must be launchable inside the sandbox (their `command` must exist
  there), which is a provisioning concern to note, not a blocker for the common case.

### Secret handling

The MCP server `env` carries resolved vault secrets. Keep the same discipline the tool relay
already keeps: do not write secret-laden `mcp.json` files into the agent dir (unlike
`pi-mcp-adapter`, which reads `mcp.json` from disk). Pass the resolved server configs through the
extension's env at daemon birth, the way trace context and tool specs already flow
(`buildPiExtensionEnv`, `sandbox_agent.ts:156-178`). The extension holds them in memory for the run.

### Result

`mcp_servers` works on `pi` and `agenta`, delivered as registered Pi tools, with no dependence on
pi-acp forwarding. F-009's residual ("pi/agenta accept the field and ignore it") closes: they
honor it. The capability table (Part 2) then declares `pi`/`agenta`/`claude` all support MCP, and
the frontend stops needing to hide the field.

### Tests

- Unit (extension): given an MCP server env entry, the extension registers the server's tools as
  Pi tools whose `execute` proxies to the MCP client. No secret is written to disk.
- Integration (fake MCP server, the QA `mcp_qa_server.mjs` already exists,
  `../qa/scripts/mcp_qa_server.mjs`): a `pi` run with a stdio `mcp_servers` entry invokes the
  tool and returns its record, mirroring the Claude run that already passes
  (`../qa/findings.md:279-283`).
- Replay (agent-replay-test skill): pin one green `pi` + MCP `/run` as a regression.

## Part 2: the harness-capabilities layer

### Recommendation

Make a **static, declarative per-harness capability table the single source of truth**, living
in a pure SDK module `sdks/python/agenta/sdk/agents/capabilities.py`, adjacent to the `Harness`
adapters that own per-harness knowledge, and referenced by them. (Codex flagged that the table
must not live INSIDE `adapters/harnesses.py`, because schema generation would then import
imperative adapter code; a pure sibling module keeps the truth next to the adapters without that
coupling.) It mirrors the existing `Backend.supported_harnesses` precedent
(`interfaces.py:132-143`), one axis up. Everything else reads from it:

- The schema builder reads it to annotate the config fields (so option C, schema annotations,
  becomes a *rendering* of the table, not a second source).
- `/inspect` exposes it so the frontend and any caller discover it.
- The backend reads it to **reject** an unsupported, non-empty config field before the runner
  starts, instead of silently dropping it (subsuming option D, and fail-loud not warn).
- The runtime-probed `HarnessCapabilities` (`dtos.py:58-96`) stays as the late-binding
  enforcement layer (Layer 2). The static table is the declared SUPERSET; the probe narrows it
  for the live project (e.g. which models a vault key actually unlocks).

This makes the model-config sibling proposal's Part 3 the n=1 case: "allowed models" is one
capability entry (an enum, static baseline + runtime refinement); "supports MCP" is another (a
boolean). Same framework, same two layers.

### Why static, and why here

- **Static is what the schema and form need.** A schema and a form must render before any run.
  The probe (`HarnessCapabilities`) is only available after a sandbox and daemon are up
  (`dtos.py:59`), so it cannot drive discovery. Only a static declaration can. This is the core
  reason option B (probe-only) fails and option A is needed.
- **The home already exists in spirit.** `Backend.supported_harnesses` is the exact pattern one
  axis down ("engine supports harness"). The capability table is "harness supports capability."
  Co-locating it with the `Harness` adapters keeps all per-harness knowledge in one module, which
  the module already claims to own (`harnesses.py:14`).
- **It collapses four scatter points into one.** Today the MCP fact is implied in the schema, the
  FE, the runner gate, and the adapter mapping, and declared nowhere. One table, four readers.

### The capability descriptor shape

Each capability entry is a small envelope with optional typed payloads, so the boolean case
(MCP) and the enum case (models) share one shape without forcing a single fully-abstract type
(Codex judged a bare boolean too small and a universal descriptor too abstract):

```
field_capability:
  applies: bool                       # is the field meaningful for this harness (drives show/hide)
  reason: optional[str]               # human note, shown in the field description / warning
  delivery: optional[str]             # how it reaches the harness (e.g. MCP: "native_register" | "acp")
  allowed_values: optional[list]      # static baseline set (the model enum case)
  dynamic_values_source: optional[str] # which probe fills the live set (Layer 2)
```

Per field:

- `mcp_servers`: `applies` + `delivery` (Pi: `native_register` via the extension; Claude: `acp`).
- `model`: `allowed_values` (static baseline, the model-config Part 3 layer-1 grouped choices) +
  `dynamic_values_source` (the runner's per-project available set, layer 2).
- `permission_policy`: `applies` (true for Claude, false for Pi, which does not gate tool use).
- `tools`: `applies` (true everywhere; the delivery differs, native vs MCP, but that is an
  internal mapping concern, not a user-facing gate).

This is the smallest shape that unifies F-009 and F-007 and leaves room for the model enum.

### Reconciling static and probed: intersection, with directional drift handling

The static table is the design-time contract (what MAY be configured); the probe is observed
availability for the live run. Reconcile by intersection, and make the two directions different
(Codex's sharpening):

- **Probe reports LESS than static, and the user requested that capability:** fail loud. The user
  asked for something the live run cannot honor; do not silently drop it.
- **Probe reports MORE than static:** treat it as drift. Log it, and gate any widening of the
  product surface behind a test, rather than silently honoring a capability the schema never
  advertised.

A test pins the contract: for each harness, the probed `HarnessCapabilities` is a subset of the
static table's declared capabilities. So static declares the universe, the probe restricts it,
and the two cannot drift into a silent contradiction.

### Crossing into the TS runner: a generated manifest or a golden contract

The capability table lives in the Python SDK, but the runner (a separate package that
hand-mirrors wire contracts, see `services/agent/CLAUDE.md`) also encodes capability facts (the
`!isPi && capabilities.mcpTools` gate, `PI_CAPABILITIES`). Do not let the two hand-drift. Either
export the table as a JSON manifest the runner reads, or pin a golden contract test across both
sides (the repo already does this for the `/run` wire via shared golden fixtures). This is the
same discipline the wire contract already follows.

### Schema strategy: harness-neutral schema, capabilities as a sibling document

Keep the generated `agent_config` schema harness-NEUTRAL (it is generated once and cached as a
catalog type, `types.py:1132-1148`; making it harness-parameterized would fight that cache and the
stored-config model). Instead, emit the per-harness capability table as a SEPARATE document in
the `/inspect` response (a `harness_capabilities` map keyed by `HarnessType`). The frontend
already holds the live `harness` value in the `AgentConfigControl` config object
(`AgentConfigControl.tsx:77`), so it cross-references the capabilities map and gates fields
client-side: hide `mcp_servers` where `applies` is false, disable or relabel `model`, hide
`permission_policy` for Pi. The backend reads the same table to reject. This avoids re-generating
or caching N schemas while giving the FE everything it needs, and it matches the model-config
proposal's "one `model` string field with harness-aware contents"
(`../model-config/proposal.md:239`).

### Codex guidance

Codex (xhigh) reviewed this layering and endorsed the static-table-as-source-of-truth
direction, with five corrections that this proposal now adopts.

1. **Home: a pure module, not the adapter file.** Codex agreed the SDK is the right layer and
   the `Harness` adapters are the right neighbor, but warned against making
   `adapters/harnesses.py` the import target for schema and frontend discovery, because that
   makes schema generation import imperative adapter code. Put the table in a pure module,
   `sdks/python/agenta/sdk/agents/capabilities.py`, adjacent to the adapters, and have
   `PiHarness`/`ClaudeHarness`/`AgentaHarness` reference it. Confirmed not to belong on
   `HarnessType` (the enum is identity and wire, not product policy) and not on `Backend`
   (that axis is engine-to-harness, already `supported_harnesses`).

2. **Fail loud, not warn.** Codex called "warn" too weak for user-specified values that will be
   ignored. For `mcp_servers` on pi/agenta (if Part 1 has not landed) and for a
   requested-but-unsettable `model`, the backend should reject before the runner starts, unless
   an explicit compatibility escape hatch is set (consistent with the model-config proposal's
   `AGENTA_AGENT_MODEL_STRICT`). The earliest silent-failure point is the SDK adapters passing
   `mcp_servers` through for every harness (`harnesses.py:70, 93, 117`), then `request_to_wire`
   serializing `mcpServers` whenever present (`utils/wire.py:54`). Close it there.

3. **`skills` is not a user-editable field today.** Codex verified `skills` appears only on the
   runner wire contract and is forced by `AgentaAgentConfig`; it is not in `AgentConfigSchema`
   or `AgentConfigControl`. So the capability table covers `mcp_servers`, `tools`, `model`, and
   `permission_policy` as user-facing fields, and may record `skills`/forced capabilities as
   internal entries, but there is no `skills` form field to gate yet. Earlier drafts that
   implied a `skills` field to hide were wrong.

4. **Intersection semantics for static vs probed.** Codex endorsed the superset/narrowing model
   and sharpened it: static is the design-time contract (what MAY be configured), the probe is
   observed availability for that run. Enforce by intersection. If the probe reports LESS than
   static and the user requested that capability, fail loud. If the probe reports MORE than
   static, treat it as drift: log it and gate widening the product surface behind a test, do not
   silently honor it. This is the subset-contract test, made directional.

5. **The descriptor: a field-capability envelope with typed payloads.** Codex judged a plain
   boolean too small and a single fully-universal descriptor too abstract. The right shape is a
   common envelope with optional typed payloads: `applies` (drives show/hide), `reason` (the
   human note), optional `delivery` (e.g. how MCP reaches the harness: native-register vs ACP),
   optional `allowed_values` / `dynamic_values_source` (the model enum, static baseline plus the
   probe source). MCP uses `applies` + `delivery`; model uses `allowed_values` +
   `dynamic_values_source`; permission policy uses `applies`. So the descriptor below is revised
   to this envelope.

Codex also confirmed the schema-strategy call: keep the schema harness-neutral, do not generate
one schema per harness (it fights the catalog cache and the stored-config model), and hand the
frontend a capabilities map to cross-reference against the live `harness` value. This matches the
model-config proposal's "one `model` string field with harness-aware contents"
(`../model-config/proposal.md:239`).

### What this fixes, by finding

- **F-009 (MCP on pi/agenta):** Part 1 makes pi/agenta honor `mcp_servers`; the table then
  declares MCP `applies` on all three harnesses (with `delivery` differing), so the FE stops
  hiding the field and the backend stops rejecting. If Part 1 is deferred, the table declares MCP
  not applicable on pi/agenta, the FE hides the field, and the backend rejects a non-empty
  `mcp_servers` on those harnesses, which is the honest interim (fail loud, not silent drop).
- **F-007 (model on sandbox-agent):** the model capability's static `allowed_values` give the FE a real
  picker (model-config Part 3 layer 1); the backend fails loud on an unsettable model
  (model-config Parts 1-2); the probe fills the accurate per-project set via
  `dynamic_values_source` (layer 2). All three are entries/refinements in this one framework.

## Recommended implementation order

This is the order I recommend; Part 1 and Part 2 are independent and can land in parallel.

1. **Part 2 slice 1: the static table + backend reject (fail loud).** Add the static per-harness
   capability table in `capabilities.py` and make the SDK adapter path read it to REJECT an
   unsupported, non-empty config field on the selected harness before the runner starts: a
   non-empty `mcp_servers` on pi/agenta (until Part 1 lands), and a requested-but-unsettable
   `model` (with `AGENTA_AGENT_MODEL_STRICT` as the escape hatch, per the model-config proposal).
   This is the smallest change that removes the silent failures, the worst property of F-009 and
   F-007, without touching the schema, the FE, or the runner gate. Codex confirmed this is the
   right first slice: cover only the known-harmful cases, fail loud, and do not wait for the
   schema or FE work to stop the silent drops. Highest value per line.
2. **Part 1: MCP on Pi.** Add the MCP bridge to the Pi extension and wire it on all three paths
   (in-process, sandbox-agent local, Daytona). Flip `mcpTools` to true for Pi. This converts F-009 from
   "hide the field" to "the field works," and updates the table entry from unsupported to
   supported.
3. **Part 2 slice 2: schema/inspect + FE gating.** Emit the capability table in `/inspect` and
   make `AgentConfigControl` cross-reference it to show/hide/disable fields per selected harness.
   Land model-config Part 3 layer 1 (static model choices) as the first enum entry here.
4. **Part 2 slice 3: fold the probe in as Layer 2.** Add the subset-contract test, and let the
   probe narrow the table's declared values for the live run (the accurate per-project model set,
   model-config Part 3 layer 2).

Slice 1 alone closes the silent-failure complaint in both findings. Parts 1 and 3 make the
capabilities honest and discoverable. Slice 4 makes them accurate per project.
