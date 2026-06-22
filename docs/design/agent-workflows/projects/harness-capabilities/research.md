# Harness capabilities: research

Two linked questions back this doc.

1. Does Pi support MCP, and can we turn it on by default for the `pi` and `agenta` harnesses?
   This closes finding F-009 (`../qa/findings.md:268`).
2. Where should the harness-to-capability mapping live so the config schema, `inspect`, the
   frontend, and the backend all read one source of truth? This is the layering question
   behind both F-009 (MCP silently dropped on pi/agenta) and F-007 (model picker silently
   ignored on sandbox-agent, `../qa/findings.md:205`).

All claims trace to the installed package source under `services/agent/node_modules/`, to
Pi's upstream docs, or to Agenta code, with file and line citations.

## Part 1: Pi and MCP

### TL;DR

Pi core has no built-in MCP. By design. But Pi is built to be extended, and an extension can
add MCP support by connecting to MCP servers and registering each server's tools through
`pi.registerTool()`. A published third-party extension already does exactly this:
`pi-mcp-adapter`. So the product owner is right in spirit: Pi can do MCP, through an
extension, and we already own the extension-install machinery to ship one.

The reason a `pi` run drops `mcp_servers` today is not Pi. It is the ACP bridge `pi-acp`,
which accepts `mcpServers` in the ACP session params, stores them in session state, and then
does not forward them to the Pi process. Claude and Codex forward MCP because their ACP
adapters do wire it through. Our runner gates on this exact fact.

### Pi core has no built-in MCP, by design

Pi's own README states it directly:

> No MCP. Build CLI tools with READMEs (see Skills), or build an extension that adds MCP
> support.
> (`services/agent/node_modules/@earendil-works/pi-coding-agent/README.md:493`)

The usage doc repeats it:

> It intentionally does not include built-in MCP, sub-agents, permission popups, plan mode,
> to-dos, or background bash. You can build or install those workflows as extensions or
> packages.
> (`.../pi-coding-agent/docs/usage.md:303`)

There is no `docs/mcp.md` in the package, and `grep -i mcp` across the docs returns only the
two "no MCP, build an extension" mentions above plus the README feature list line "MCP server
integration" under the extensions section (`README.md:389`). The Pi SDK
(`docs/sdk.md`) has no MCP API. So MCP is not a flag, not a config file Pi reads natively, and
not an SDK call. It is an extension concern.

### Pi extensions can add MCP via `pi.registerTool()`

The extension API exposes `pi.registerTool(definition)`
(`.../pi-coding-agent/docs/extensions.md:1269`). A registered tool has:

- `name`, `label`, `description`, and a `parameters` JSON Schema.
- an async `execute(toolCallId, params, signal, onUpdate, ctx)` that returns content blocks
  and can stream progress through `onUpdate`.
- optional `promptSnippet` / `promptGuidelines` to opt the tool into the system prompt.

Tools can be registered during extension load or at runtime, and "New tools are refreshed
immediately in the same session, so they appear in `pi.getAllTools()` and are callable by the
LLM without `/reload`" (`docs/extensions.md:1273`). That is the whole mechanism an MCP bridge
needs: connect to an MCP server, list its tools, and `registerTool` each one with an `execute`
that proxies the call to the MCP client. This is the same pattern Agenta's own Pi extension
already uses for gateway and code tools (next section).

### Agenta already ships a Pi extension that registers tools this way

`services/agent/src/extensions/agenta.ts` is the bundled Agenta Pi extension. It reads public
tool specs from the environment and registers each as a Pi tool whose `execute` relays back to
the runner:

```ts
// services/agent/src/extensions/agenta.ts:54-71
pi.registerTool({
  name: spec.name,
  label: spec.name,
  description: spec.description ?? spec.name,
  parameters: (spec.inputSchema as any) ?? EMPTY_OBJECT_SCHEMA,
  async execute(toolCallId, params, signal) {
    const text = await runResolvedTool(spec, params, { toolCallId, relayDir, signal });
    return { content: [{ type: "text", text }], details: { toolName: spec.name } };
  },
});
```

The runner already installs this bundle into Pi's agent dir on every run
(`installPiExtensionLocal`, `sandbox_agent.ts:181-193`; uploaded to Daytona by
`uploadPiExtensionToSandbox`, `sandbox_agent.ts:243-253`). It is loaded global-scope (non-trust-gated)
and is inert unless Agenta wired the run (`agenta.ts:78-84`). So the install path, the
inert-by-default contract, and the relay-execution pattern an MCP bridge needs already exist.

The same is true on the in-process path: `engines/pi.ts` builds Pi `customTools` from resolved
specs and passes them to `createAgentSession` (`pi.ts:150-198`, `279-302`). It does not handle
`request.mcpServers` at all today (it only consumes `request.customTools`).

### Why pi-acp does not forward MCP for the `pi` agent

This is the actual root cause of F-009 on the Pi path. The ACP bridge `pi-acp` says so in its
README:

> MCP servers are accepted in ACP params and stored in session state, but not wired through to
> pi in this adapter. If you use [pi MCP adapter](https://github.com/nicobailon/pi-mcp-adapter)
> it will be available in the ACP client.
> (`services/agent/node_modules/.pnpm/pi-acp@0.0.29/node_modules/pi-acp/README.md:198`)

So the runner passes `mcpServers` into `sessionInit` (`sandbox_agent.ts:1014-1018`), pi-acp accepts and
stores them, and then nothing reaches Pi. The runner correctly does not even attempt this for
Pi: it gates MCP delivery on the probed `mcpTools` capability, which is false for Pi:

```ts
// services/agent/src/engines/sandbox_agent.ts:996-1006
const mcpServers =
  !isPi && capabilities.mcpTools
    ? [
        ...buildToolMcpServers(toolSpecs, request.toolCallback, relayDir),
        ...toAcpMcpServers(request.mcpServers),
      ]
    : [];
```

The comment one block up names the reason: "pi-acp does not forward MCP, Claude/Codex do"
(`sandbox_agent.ts:988-989`). The in-process Pi engine hard-codes `mcpTools: false`
(`engines/pi.ts:59`), and the in-process adapter's static `PI_CAPABILITIES` does the same.

By contrast, the Claude ACP adapter `@zed-industries/claude-agent-acp` lists "Client MCP
servers" as a supported feature in its README, so Claude forwards MCP over ACP. That is why
F-009's live test passed on Claude (`../qa/findings.md:279-283`) and only Claude.

### The published Pi MCP extension: `pi-mcp-adapter`

`pi-mcp-adapter` (github.com/nicobailon/pi-mcp-adapter) is a Pi extension that adds MCP. Key
facts from its docs:

- Installed as a Pi package: `pi install npm:pi-mcp-adapter`.
- Reads MCP server configs from standard files, in precedence order:
  `~/.config/mcp/mcp.json`, `<Pi agent dir>/mcp.json`, `.mcp.json`, `.pi/mcp.json`.
- Connects lazily (only on first tool call), and supports stdio, HTTP, and OAuth servers.
- Exposes tools through a proxy-tool pattern by default (a single `mcp` tool that searches and
  calls, to save context), with an optional `directTools` config to promote chosen tools to
  first-class Pi tools.

This proves the extension approach works and gives us a reference. It also surfaces a design
choice we must make for ourselves (proxy `mcp` tool vs direct tools), covered in the proposal.
We are unlikely to adopt `pi-mcp-adapter` as-is, because our servers are resolved server-side
with vault secrets injected into `env` and we want them delivered without writing secret-laden
`mcp.json` files into the agent dir. But it confirms the mechanism and the config-file
convention.

### Pi MCP, summarized

| Question | Answer |
| --- | --- |
| Does Pi core support MCP? | No. Removed on purpose (`README.md:493`). |
| Can an extension add MCP? | Yes, via `pi.registerTool()` (`docs/extensions.md:1269`). |
| Is there an existing extension? | Yes: `pi-mcp-adapter`, install `npm:pi-mcp-adapter`. |
| Why is it dropped for `pi` today? | pi-acp accepts `mcpServers` but does not forward them to Pi (`pi-acp README:198`). |
| Why does Claude work? | `@zed-industries/claude-agent-acp` forwards MCP over ACP. |
| Do we own the install path? | Yes: the Agenta extension is already installed every run (`sandbox_agent.ts:181-193, 243-253`). |

## Part 2: where harness capabilities should live

### The problem, restated

There is no single declaration of "harness X supports capability Y." The knowledge is
scattered, and each scatter point is a silent no-op:

- The config schema (`services/oss/src/agent/schemas.py`, `sdk/utils/types.py:1065-1129`)
  exposes `mcp_servers`, a `model` field, and `tools` for every harness, with no per-harness
  gating. (`skills` is NOT a user-editable schema field today: it is on the runner wire contract
  and forced by `AgentaAgentConfig`, but absent from `AgentConfigSchema` and `AgentConfigControl`.
  So it is an internal capability, not a form field to gate.)
- The frontend control (`AgentConfigControl.tsx`) renders every field unconditionally. It has
  zero harness-awareness: MCP servers render for Pi, the model picker has no choices at all
  (`x-parameter: grouped_choice` with no `choices`, `sdk/utils/types.py:1087-1092`).
- The runner probes capabilities at run time (`probeCapabilities`, `sandbox_agent.ts:990`) and branches
  on `capabilities.mcpTools`. This is the only place the truth is enforced, and it enforces by
  silently dropping (F-009) or silently falling back (F-007).
- The SDK adapters in `adapters/harnesses.py` hold per-harness mapping knowledge (Pi delivers
  tools natively, Claude over MCP), but they pass `mcp_servers` straight through for all three
  harnesses (`harnesses.py:70, 93, 117`); they do not declare which harness can honor them.

So the same capability fact ("supports MCP") is implied in four places and declared in none.
F-007's "which models are allowed" is the identical shape of problem: a per-harness fact with
no single home, surfaced too late (a run-time error) instead of up front.

### The pieces that already exist

There are three existing structures, each modeling a different slice of "what a harness can
do." Understanding them is the key to placing the new one.

1. **`HarnessCapabilities` (runtime-probed).** `sdks/python/agenta/sdk/agents/dtos.py:58-96`.
   A boolean capability set (`mcp_tools`, `images`, `tool_calls`, `reasoning`, `plan_mode`,
   `permissions`, `usage`, `streaming_deltas`, `session_lifecycle`, ...). It is filled by
   probing the live harness (`HarnessCapabilities.from_wire`, parsed from the sandbox-agent daemon's
   `AgentCapabilities`). Adapters are told to "branch on these flags rather than the harness
   name" (`dtos.py:59-63`). This is the dynamic, run-time truth, and it already exists. But it
   is computed only after a sandbox and daemon are up, so it cannot drive a schema or a form.

2. **`Backend.supported_harnesses` (static, declared).**
   `sdks/python/agenta/sdk/agents/interfaces.py:132-143`. A `ClassVar[FrozenSet[HarnessType]]`
   each backend hard-codes (`in_process.py:117`, `local.py:32`, `sandbox_agent.py:118`). This is the
   precedent for a static, declared capability table on the SDK side, validated at construction
   (`Harness.__init__` raises `UnsupportedHarnessError`, `interfaces.py:248-249`). It answers
   "can this engine drive this harness" up front, with no probe. It is exactly the shape the new
   table wants, one axis up: not "engine supports harness" but "harness supports capability."

3. **The harness adapters (per-harness knowledge).** `adapters/harnesses.py`. The module
   docstring is explicit: "The backend below stays pure plumbing; this layer owns the harness
   knowledge" (`harnesses.py:14`). `PiHarness`, `ClaudeHarness`, `AgentaHarness` already encode
   the differences (Pi has no MCP and no permission gating; Claude has no built-ins, delivers
   over MCP, gates permissions). This is where a per-harness static capability declaration most
   naturally attaches: the knowledge is already here, just expressed as imperative mapping code
   rather than a declarative table.

### The schema and inspect surface

The config self-describes through `AGENT_SCHEMAS` on `/inspect`
(`services/oss/src/agent/schemas.py`, wired at `app.py:156`). The `agent` element is the
`agent_config` catalog type, generated from the Pydantic `AgentConfigSchema`
(`sdk/utils/types.py:1065-1129`) and resolved by the playground against
`/workflows/catalog/types/agent_config`. The model field is a bare string with
`x-parameter: grouped_choice` and no choices; the standalone `model` catalog type, by contrast,
carries `choices: supported_llm_models` and `x-ag-type: grouped_choice`
(`sdk/utils/types.py:1045-1054`). So the schema is the surface the frontend reads, and it is
where per-field, per-harness annotations would have to land to drive show/hide/disable.

### The static-versus-probed tension

The crux. Some capabilities are knowable statically (Pi has no built-in MCP, Claude gates
permissions, the agenta harness forces skills). Some are only knowable after probing the live
harness in the live project (which models a provider key unlocks; whether the running pi-acp
version forwards MCP). The model-config sibling doc (`../model-config/proposal.md`, Part 3)
already split exactly this for the model axis:

- **Layer 1, static schema-time:** harness-neutral baseline choices on the field, sourced from
  a static list, so the playground renders a real control instead of a free-text box. Cheap, no
  probe.
- **Layer 2, dynamic run-time:** the accurate per-harness/per-project set, added to the
  `inspect` response from the runner's own knowledge (`allowedModels(session)` on sandbox-agent,
  `modelRegistry.getAvailable()` in-process). Larger surface, deferred.

That two-layer split is the model the capabilities framework should generalize. "Supports MCP"
and "allowed models" are the same kind of fact at different granularities (a boolean vs an
enum), and both want a static declaration first and a run-time refinement second.

### The four candidate homes

1. **A static per-harness capability table in the SDK.** A declarative map
   `HarnessType -> capability profile`, sibling to `Backend.supported_harnesses`, most naturally
   attached to the `Harness` adapters that already own per-harness knowledge. The schema builder
   reads it to annotate fields; `inspect` exposes it; the backend reads it to validate or warn.
   Pro: one declaration, available before any run, drives schema and form. Con: it duplicates the
   probed booleans for the run-time axis, so the two must be reconciled.

2. **The runtime-probed `HarnessCapabilities` only.** Keep the single source as the probe. Pro:
   already exists, always accurate. Con: only available after a sandbox and daemon spin up, so it
   cannot drive a schema, an `inspect` response a designer reads before running, or a form. It
   is the enforcement truth, not a discovery surface.

3. **Schema annotations on the config (per-field `x-ag-*` capability hints).** Encode "this field
   applies to harnesses [pi, agenta]" directly on the schema field. Pro: the frontend reads the
   schema it already consumes, no new endpoint. Con: the schema is generated once and is not
   harness-parameterized today; the per-harness data still has to come from somewhere (a table),
   so this is a rendering of the table, not the table itself.

4. **A backend-only validation/warn layer.** Keep declaring nothing; just stop silently dropping.
   Pro: smallest change, closes the silent-failure half of both findings immediately. Con: does
   not make capabilities discoverable, so the frontend still cannot show/hide and the next caller
   still guesses.

### How the model-config piece fits

The sibling proposal's Part 3 is one instance of the general framework: model choices are one
capability, surfaced static-then-dynamic. The capabilities framework should be the container
that Part 3's `model` choices, F-009's `mcp_servers` applicability, `tools` applicability, and
the permission policy all drop into, each as one entry keyed by harness, each
with a static declaration and an optional run-time refinement. The proposal must not contradict
the model-config doc; it should subsume it as the n=1 case.

## Sources

Installed packages (authoritative for running behavior):

- `services/agent/node_modules/@earendil-works/pi-coding-agent` v0.79.4: `README.md`,
  `docs/usage.md`, `docs/extensions.md`, `docs/settings.md`, `docs/packages.md`, `docs/sdk.md`.
- `services/agent/node_modules/.pnpm/pi-acp@0.0.29/node_modules/pi-acp/README.md`.
- `services/agent/node_modules/.pnpm/@zed-industries+claude-agent-acp@0.23.1/.../README.md`.

Agenta code:

- `services/agent/src/engines/sandbox_agent.ts` (MCP gate `:988-1012`, session init `:1014-1018`,
  extension install `:181-193, 243-253`).
- `services/agent/src/engines/pi.ts` (static `PI_CAPABILITIES` `:50-63`, custom tools
  `:150-198`).
- `services/agent/src/extensions/agenta.ts` (`registerTool` relay `:38-75`).
- `sdks/python/agenta/sdk/agents/dtos.py` (`HarnessCapabilities` `:58-96`).
- `sdks/python/agenta/sdk/agents/interfaces.py` (`Backend.supported_harnesses` `:132-143`).
- `sdks/python/agenta/sdk/agents/adapters/harnesses.py` (per-harness mapping).
- `sdks/python/agenta/sdk/utils/types.py` (`AgentConfigSchema` `:1065-1129`, `model` catalog
  type `:1045-1054`).
- `services/oss/src/agent/schemas.py`, `services/oss/src/agent/app.py:156`.
- `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentConfigControl.tsx`.

External:

- `https://pi.dev/` and `https://github.com/earendil-works/pi`.
- `https://github.com/nicobailon/pi-mcp-adapter`.

Sibling design docs:

- `../model-config/proposal.md`, `../model-config/research.md` (F-007 model axis).
- `../qa/findings.md` (F-007 `:205`, F-009 `:268`).

Layering review:

- Codex (xhigh, read-only) reviewed the four candidate homes and the static-vs-probed
  reconciliation. Its verdict is folded into `proposal.md` ("Codex guidance").
