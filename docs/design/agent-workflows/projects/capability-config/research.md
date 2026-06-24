# Research: current state and insertion points

Self-contained map of how the runtime governs an agent today and where the three layers attach.
All claims trace to code or installed package source. The deep web/exec/read/write current-state
cut lives in `../../scratch/capability-map.md`; this doc adds the enforcement mechanics and the
exact insertion points for the backend, the runner, and the frontend. Line numbers are accurate
as of 2026-06-23 and a few are approximate (flagged); reconfirm at implementation time.

## 1. Enforcement mechanics (the load-bearing library facts)

**Claude config reaches the harness through `.claude/settings.json`.** The Claude ACP adapter
builds the underlying SDK query with `settingSources: ["user", "project", "local"]`
(`@zed-industries/claude-agent-acp` `acp-agent.js:954`), so the SDK reads
`<cwd>/.claude/settings.json` and honors its `permissions.allow` / `deny` / `ask` rules. The
adapter reads `permissions.defaultMode` for the initial permission mode (`acp-agent.js:935`).
The `_meta.claudeCode.options` channel (disallowedTools, permissionMode) is unusable, because
sandbox-agent strips `_meta` from the session request
(`sessionInit?: Omit<NewSessionRequest, "_meta">`, `sandbox-agent/dist/index.d.ts:2778`). So the
settings file is the one clean delivery path. For the mode alone there is a runtime control,
`session.setMode(modeId)` (`index.d.ts:3064`; modes `default`/`acceptEdits`/`plan`/
`bypassPermissions`, `acp-agent.js:1046-1078`). The runner owns the cwd (a temp dir), so it can
write the file before `createSession`.

**Pi has no permission gate over ACP, and its built-in tool restriction is backend-dependent.**
Its permission probe reports `permissions: false`. The built-in tool lever (S0b finding, verified
in code) is real but only reachable on one backend:

- The Pi SDK natively supports restriction: `createAgentSession({ tools, excludeTools, noTools })`
  and the CLI flags `--tools` / `--no-builtin-tools` / `--exclude-tools`
  (`@earendil-works/pi-coding-agent@0.79.4` `dist/core/sdk.d.ts`, `dist/cli/args.js:79-96`).
- The **in-process** Pi engine already uses it: `pi.ts:311-314` passes `tools: toolAllowlist`
  (built from `request.tools`) into `createAgentSession()`. So Pi Layer 1 **works on the
  in-process / local backend**.
- The **sandbox-agent ACP** path does not. `pi-acp@0.0.29` hardcodes the spawn as
  `pi --mode rpc --no-themes` (`pi-acp/dist/index.js:134-142`) and its `newSession` accepts only
  `cwd` + `mcpServers` (`index.js:1701`) — no `tools`/`excludeTools`/`noTools` forwarded. And
  `sandbox_agent.ts:208-212` passes only `{ agent, cwd, sessionInit: { cwd, mcpServers } }`,
  dropping `request.tools` (`run-plan.ts:101`).

So Pi's Layer 1 is supported in-process and **unsupported over sandbox-agent ACP** until pi-acp
forwards the flags. Design consequence: honor `builtin_names` on the in-process backend, and
**fail loud** when an author requests Pi built-in restriction on a sandbox-agent backend
(`buildRunPlan` validation in `sandbox_agent.ts`, ~:108-115), rather than silently granting the
full set. Future lever: patch/fork pi-acp to add `--tools`/`--exclude-tools` to the spawn args
(or upstream it), which would lift the restriction to the ACP path too.

**The permission responder seam already exists.** When the harness raises an ACP permission
request, `attachPermissionResponder` emits an `interaction_request` event and asks a `Responder`
(`engines/sandbox_agent/permissions.ts:16-45`). Today `PolicyResponder` answers headlessly from
`permission_policy` (`responder.ts:44-62`). The request carries the tool call, so a per-tool
responder can branch on the tool name.

**Resolved tools run in the runner, not the sandbox.** Gateway and code tools execute runner-side
through the relay (`tools/relay.ts`), regardless of backend. This is the basis for enforcing
Layer 3 at the relay, and it is also the security caveat in section 5.

## 2. Backend, SDK, and runner insertion points

From a code sweep on 2026-06-23. Reconfirm line numbers when implementing.

**Config DTOs** (`sdks/python/agenta/sdk/agents/dtos.py`):
- `AgentConfig` (~309-369) holds `instructions`, `model`, `tools`, `mcp_servers`, `skills`,
  `harness_options`. Add optional `sandbox_permission` here.
- `RunSelection` (~372-395) already holds `harness`, `sandbox`, `permission_policy`.
- `SessionConfig` (~571-620) is the wire bag. Per-tool permissions ride on each `ToolSpec`, not
  a separate map here; MCP permissions ride on each `mcp_servers` entry.
- `PiAgentConfig` / `ClaudeAgentConfig` / `AgentaAgentConfig` (~468-564) and their `wire_tools()`
  are where tool/permission serialization happens.
- `ToolSpec` (`tools/models.py:95-157`) already has `needs_approval` and `render`; add the
  permission (always-allow/ask/deny) and the `read_only` flag, and serialize both in
  `to_wire()`. Each `mcp_servers` entry gains a matching permission field.

**Schema generation:**
- `AgentConfigSchema` (`sdk/utils/types.py` ~1065-1138) is the `agent_config` catalog type the
  playground renders. Add `sandbox_permission`, and a per-tool permission shape on `tools`.
- `services/oss/src/agent/schemas.py` holds `_DEFAULT_AGENT_CONFIG` and the `x-ag-type-ref`
  reference; add the default for the new field.

**Concrete `sandbox_permission` schema (decision 11).** The first-slice shape, kept minimal and
extensible:

```python
class NetworkEgress(BaseModel):
    mode: Literal["on", "off", "allowlist"] = "on"
    allowlist: list[str] = []  # CIDR ranges; honored when mode == "allowlist"

class SandboxPermission(BaseModel):
    network: NetworkEgress = NetworkEgress()
    filesystem: Optional[Literal["on", "readonly", "off"]] = None  # declared, NOT enforced today
    enforcement: Literal["strict", "best_effort"] = "strict"       # strict = fail loud; best_effort = local opt-out
```

Daytona maps `network.mode == "off"` → `networkBlockAll: true`, and `"allowlist"` →
`networkAllowList: <cidr[]>`. `filesystem` is carried and surfaced but enforces nothing until a
backend gains an fs jail. `enforcement: "strict"` makes a backend that cannot deliver a requested
network guarantee (local sidecar, local SDK) fail loud; `"best_effort"` is the per-axis opt-out
for local development. Named presets (e.g. "locked down") are FE sugar deferred to S4, not a wire
concept.

**Ports for Layer 2 — the policy crosses the Python→TS wire.** Daytona is provisioned in the TS
runner (`buildSandboxProvider`), not in the Python `Backend.create_sandbox`, so the policy must
travel on the run request, not only as a Python call argument. The full path (Codex-confirmed):

- Python authoring → wire: add `sandbox_permission` to `AgentConfig`
  (`sdks/python/agenta/sdk/agents/dtos.py`), carry it on `SessionConfig`, and serialize it in
  `request_to_wire` (`sdk/agents/utils/wire.py`) so it lands in the `/run` request.
- TS runner: surface it on `AgentRunRequest` (`services/agent/src/protocol.ts`), thread it through
  `buildRunPlan` (`engines/sandbox_agent/run-plan.ts`) into `buildSandboxProvider`, and set it on
  the Daytona `create` object (`engines/sandbox_agent/provider.ts` ~14-43, which sets
  `snapshot`/`target`/`envVars`/`ephemeral` only today) as `networkBlockAll` / `networkAllowList`.
- The golden wire fixtures (`.../golden/run_request.*.json`) and both contract tests
  (`test_wire_contract.py`, `tests/unit/wire-contract.test.ts`) move together with the new field.
- The Python `Backend.create_sandbox` (`interfaces.py` ~155, parameterless) still gains the typed
  policy for the local/in-process backend path, and `Environment` (~177-232) derives it from
  `session_config`. For shared sandboxes (`sandbox_per_session=False`), reject a post-create
  policy change or cache by policy. But the wire path above is the one that reaches Daytona.

**Runner enforcement:**
- `run-plan.ts` (~67-145) builds the cwd; write `.claude/settings.json` here or just before
  `sandbox.createSession` in `sandbox_agent.ts` (~195).
- `responder.ts` `PolicyResponder` and `permissions.ts` `attachPermissionResponder`: thread the
  per-tool map into the responder.
- `relay.ts` `executeRelayedTool` (~92-113): enforce deny/ask/allow for resolved tools.
- `mcp.ts:26`: the per-server `tools` allowlist is parsed but unenforced; replace it with
  settings.json `mcp__<server>` / `mcp__<server>__<tool>` rules.

## 3. Frontend insertion points

From a code sweep on 2026-06-23. The form is generic-schema-driven, which is the good news:
fields that the schema declares render through the existing pipeline.

**The agent config form** (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/`):
- `AgentConfigControl.tsx` (the composite, ~186-323) renders instructions, model, tools,
  mcp_servers, harness, sandbox, permission_policy. It reads the live `harness` off the config
  object. New sections render here.
- `SchemaPropertyRenderer.tsx` (~80-217) routes a schema field to a control by type
  (`enum` → EnumSelectControl, `grouped_choice` → GroupedChoiceControl, `agent_config` →
  AgentConfigControl). A custom `x-ag-type` dispatches to a custom control.
- `McpServerItemControl.tsx` and `ToolItemControl.tsx` are the per-item controls.

**Already present and reusable:**
- CORRECTION (S3a, verified 2026-06-23): the FE does **not** round-trip
  `tool.agenta_metadata.permission_mode` today — there are zero `permission_mode` references in
  `web/`. The earlier "head start" claim was a future-state assumption. `ToolItemControl` /
  `AgentConfigControl` round-trip a free-form `agenta_metadata` bag with no permission. So S4 must
  **build** the per-tool permission control, not just wire it. Good news: the SDK `permission`
  field accepts `permission_mode` / `permissionMode` via `AliasChoices`, so if S4 writes
  `agenta_metadata.permission_mode` with the `allow|ask|deny` vocabulary, it deserializes into
  `permission` with no mapping and no breaking change.
- The HITL "ask" surface DOES have a head start (confirmed in S2 review): the agent chat uses
  ai-sdk `useChat` and already exposes `addToolApprovalResponse`
  (`web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx:86`), and `ToolPart.tsx:153` already
  renders approve/deny buttons. The missing piece for S5 is the runtime parked/resumed path:
  mapping the runner's `interaction_request` onto the ai-sdk approval part and resuming the call.

**Schema and persistence flow:** the schema arrives through the workflow molecule
(`agenta-entities/src/workflow/state/molecule.ts`, `parametersSchema`), and config edits persist
through `updateConfiguration` → `updateWorkflowDraftAtom`. New fields under `data.parameters.*`
persist automatically once the schema declares them and `AgentConfigControl` calls `setField`.

**Per-harness gating is not built.** Today every field renders unconditionally. Gating reads the
live `harness` value and a harness-capabilities map (the `/inspect` capabilities document from
`../harness-capabilities/`) and hides inapplicable fields.

## 4. Composio read/write metadata

Composio returns MCP behavioral hint tags per action (`readOnlyHint`, `destructiveHint`,
`updateHint`, `idempotentHint`, ...). The catalog parser strips them as noise
(`api/oss/src/core/tools/providers/composio/catalog.py:278,362`), and `ToolCatalogAction` /
`ToolCatalogActionDetails` (`api/oss/src/core/tools/dtos.py:41-54`) carry no mutation field. So
the read-vs-write signal exists at the source and we discard it. Phase 0 keeps it: derive
`read_only` from `readOnlyHint` (and treat `destructiveHint`/`updateHint` as mutating), carry it
on the catalog action and the resolved tool, and default Layer 3 permissions from it.

## 5. Security caveat: the runner-host execution surface

This is the sharpest correctness risk and the design must not hide it. `executeRelayedTool`
(`tools/relay.ts` ~:92-113) runs **both** resolved `code` tools (`runCodeTool`, ~:101) and
gateway/callback tools (`callAgentaTool` over HTTP, ~:106) in the runner process, not in the
sandbox. So Daytona's `networkBlockAll` confines the harness's own `bash`/`WebFetch` (which run
in the VM) but does **not** confine a resolved `code` tool *or* a gateway/callback tool, both of
which run on the runner host with the runner's network. A network-blocked Daytona agent can still
egress through either. Two ways out, gating the `network: off` guarantee in Phase 1 (S1g):

- **(a) target:** move resolved-tool execution into the sandbox, so the sandbox plane is truly
  authoritative for every tool.
- **(b) interim guard:** keep the relay runner-side, but when `network: off` or `exec: off`,
  reject or remove `code` tools, **gateway/callback tools**, and stdio MCP servers (MCP servers
  are arbitrary commands), and confine the runner host separately. The guard must cover
  gateway/callback, not only `code` and MCP — that was the gap Codex caught.

## 6. Uncertainties to resolve during implementation

1. How the Layer 2 policy threads into `buildSandboxProvider` (no config param today).
2. Mutation detection for `read_only` enforcement on arbitrary resolved-tool code (explicit flag
   vs input inspection). The honest first cut is to treat `read_only` as an advisory default for
   the permission, not a hard runtime block on resolved tools.
3. `LocalBackend.create_sandbox` signature parity with the new policy parameter.
4. The exact `.claude/settings.json` contents validated against Claude Code's settings schema,
   and the `mcp__<server>__<tool>` naming validated on a live run.
5. Resolved: per-tool permissions live on the tool spec, and MCP permissions live on the MCP
   server spec. (The FE does NOT round-trip `permission_mode` yet — see the S3a correction in
   section 3; S4 builds that control.)
   Keep the wire field name consistent across SDK, wire, and FE.
