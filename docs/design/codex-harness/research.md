# Research: the code on main that the Codex harness builds on

This is the factual map of the current code, at main commit `7b971d8c10`. Every claim
carries a file path (paths are repo-relative; line numbers are anchors into that commit).
The glossary in [README.md](README.md) defines the recurring terms; this file restates a
term's meaning the first time it matters for a claim.

A note on sources: the runner's `node_modules` is not vendored in git. Claims about the
pinned sandbox-agent daemon come from the installed copy of the same pinned version
(`sandbox-agent@0.4.2` plus the repo's patch) in the main checkout's
`services/runner/node_modules`, inspected read-only. Those claims are marked as such.

## 1. How a run flows today, end to end

A user's agent config selects a harness (the coding-agent program Agenta runs: Pi or
Claude Code today). The run flows through four layers:

1. **The agent service** (`services/oss/src/agent/app.py`) parses the request into an
   `AgentTemplate` and calls the SDK's agent runtime.
2. **The Python SDK** (`sdks/python/agenta/sdk/agents/`) turns the neutral template into
   a harness-specific config and serializes one `/run` request
   (`sdks/python/agenta/sdk/agents/utils/wire.py:82`, `request_to_wire`).
3. **The runner** (`services/runner/`, a Node sidecar) receives `/run`, builds a run
   plan, prepares a sandbox and workspace, and drives one turn.
4. **The sandbox-agent daemon** (the pinned `sandbox-agent` npm package plus its Rust
   CLI binary) spawns the harness behind an ACP bridge (ACP is the Agent Client
   Protocol, the JSON-RPC protocol between the daemon and a harness; Claude sits behind
   Zed's `claude-agent-acp` bridge, Pi behind `pi-acp`) and streams `session/update`
   events back.

The wire contract between layers 2 and 3 is `services/runner/src/protocol.ts`, hand
mirrored in `sdks/python/agenta/sdk/agents/utils/wire.py` and pinned by golden fixtures
in `sdks/python/oss/tests/pytest/unit/agents/golden/` that both sides assert
(`test_wire_contract.py` and `services/runner/tests/unit/wire-contract.test.ts`). The
TypeScript test has a compile-time key guard, so a drifted `protocol.ts` fails `tsc`.
Adding a harness that adds or removes wire fields means updating the golden, both type
files, and both contract tests together (`services/runner/CLAUDE.md`).

## 2. The harness abstraction in the Python SDK

All paths in this section are under `sdks/python/agenta/sdk/agents/`.

### 2.1 Harness identity

- `HarnessType` (`dtos.py:45`) is the enum of runtime selectors: `pi_core`, `claude`,
  `pi_agenta`. The value is the wire string the runner reads. `coerce` accepts loose
  strings from the playground.
- `HARNESS_IDENTITIES` (`dtos.py:92`) gives each harness a versioned slug
  (`agenta:harness:<value>:v0`) and a display name. This single list feeds the
  `harnesses` catalog the frontend dropdown renders
  (`api/oss/src/resources/workflows/catalog.py:252`, `GET /catalog/harnesses/`), so a
  new entry here surfaces in the UI with no bespoke frontend work.
- `SandboxAgentBackend.supported_harnesses` (`adapters/sandbox_agent.py:126`) is the
  backend-side allowlist; a new harness must be added there or `make_harness` refuses
  it.

### 2.2 The harness adapters

`adapters/harnesses.py` holds one adapter class per harness plus the
`make_harness(harness_type, environment)` factory (`adapters/harnesses.py:163`) and the
`_HARNESSES` registry (`adapters/harnesses.py:156`). Each adapter's single job is
`_to_harness_config`: project the neutral `SessionConfig` onto that harness's own
config class.

`ClaudeHarness` (`adapters/harnesses.py:88`) is the template Codex mirrors:

- It drops Pi built-in tool names with a warning (built-ins are a Pi concept; shipping
  a name the harness cannot honor would be a silent lie).
- It threads instructions, model, resolved connection, tool specs, tool callback, MCP
  servers, skills, sandbox permission, the runner permission default, and the harness's
  own `harness_permissions` slice onto a `ClaudeAgentTemplate`.
- It contains no Claude-specific parsing; that lives in the config class and
  `claude_settings.py`.

### 2.3 The harness config classes and their wire methods

`HarnessAgentTemplate` (`dtos.py:681`) is the base config a backend plumbs verbatim.
The wire methods each contribute one slice of the `/run` payload, and each is omitted
when empty so an unchanged config yields a byte-identical payload (the codebase calls
this the golden wire contract):

- `wire_permissions` (`dtos.py:745`) emits the runner permission plan:
  `{"permissions": {"default": <mode>, "rules": [...]}}`. The default comes from
  `runner.permissions.default` in the template (`allow` / `ask` / `deny` /
  `allow_reads`, `dtos.py:111`); the rules come from
  `permission_rules.wire_author_permission_rules`.
- `wire_tools` (`dtos.py:753`) is abstract; each config shapes its own tool fields.
  `ClaudeAgentTemplate.wire_tools` (`dtos.py:919`) emits `tools: []` (no Pi
  built-ins), `customTools` (the resolved specs, delivered over MCP), `toolCallback`,
  and spreads `wire_permissions`.
- `wire_harness_files` (`dtos.py:786`) emits the generic `harnessFiles` array:
  `{path, content}` entries the runner writes blind into the session working directory
  before the session starts. This is the seam where per-harness config-file rendering
  happens in Python; the runner has no harness knowledge. The base implementation
  returns `{}`; `ClaudeAgentTemplate.wire_harness_files` (`dtos.py:929`) overrides it
  to render `.claude/settings.json` via `claude_settings.build_claude_settings_files`.
- `wire_mcp`, `wire_skills`, `wire_sandbox_permission`, `wire_model_ref`,
  `wire_resolved_connection`, `wire_prompt` follow the same omit-when-empty pattern
  (`dtos.py:757` onward).

`AgentTemplate.harness_permissions` (`dtos.py:608`) is the selected harness's
first-class permission slice, parsed from `harness.permissions` in the authored
template (`dtos.py:1196`, `_parse_harness_slice`); `harness_extras` is the escape-hatch
bag (Pi's `system` / `append_system` live there). Only the selected harness's slice is
carried; there is no keyed-by-harness bag anymore.

The execution selector objects (`harness` / `sandbox` / `runner`) are a CLOSED key set:
an unknown key inside them is a loud HTTP 400 (`dtos.py:1117`,
`_SELECTOR_ALLOWED_KEYS`, and `AgentTemplateShapeError` at `dtos.py:124`). Adding a
Codex-specific selector key would have to extend that set deliberately.

### 2.4 The permission-rule derivation for Claude (the pattern Codex must mirror)

`adapters/claude_settings.py` renders the Claude permission settings file. Its module
docstring (`claude_settings.py:1`) is the canonical statement of the pattern. The file
merges four rule sources into one `.claude/settings.json`, in three named layers:

- **Layer 1, the author's options**: the harness's first-class `permissions` slice
  (`harness.permissions` in the template): a `default_mode` plus per-tool `allow` /
  `deny` / `ask` pattern strings in Claude's own rule syntax (for example
  `Bash(rm:*)`). Parsed by `permission_rules.parse_author_permissions`
  (`permission_rules.py:25`); valid modes are Claude's own four
  (`default` / `acceptEdits` / `plan` / `bypassPermissions`,
  `permission_rules.py:8`). The deliberate philosophy: authors write harness-native
  permission options, not an Agenta-invented vocabulary.
- **Layer 2, rules derived from the sandbox boundary**: `sandbox_permission` (the
  declared sandbox security policy, `dtos.py:158`) is reinforced as harness tool
  rules (`claude_settings.py:75`): restricted network denies `WebFetch` / `WebSearch`;
  read-only or off filesystem denies `Write` / `Edit`. A safety floor, not the primary
  enforcement (the sandbox provider is).
- **Layer 3, rules derived from tool-level permissions**, two sub-sources:
  - per-MCP-server `permission` becomes a whole-server `mcp__<server>` rule
    (`claude_settings.py:102`);
  - each resolved executable tool's `permission` becomes a per-tool
    `mcp__agenta-tools__<tool>` rule (`claude_settings.py:134`). This one is
    load-bearing (finding F-046 in the docstring): Claude Code's own permission gate
    fires BEFORE the runner's relay ever sees a tool call, so without a rendered
    `allow` rule an allow-tool would always park for approval. `client` tools
    (browser-fulfilled) render allow-unless-denied because the runner's pause seam is
    their authoritative ask.

`build_claude_settings_files` (`claude_settings.py:205`) merges author rules first,
then derived rules, dedupes, and emits the smallest valid file, or `[]` when there is
nothing to write. `SETTINGS_PATH` is `.claude/settings.json` relative to the session
cwd (`claude_settings.py:49`). The internal MCP server name `agenta-tools`
(`claude_settings.py:60`, `INTERNAL_TOOL_MCP_SERVER`) is a cross-language coupling with
the runner (`services/runner/src/engines/sandbox_agent/mcp.ts:70`).

Why a file in the cwd and not ACP metadata: the Claude ACP adapter builds its SDK query
with `settingSources: ["user", "project", "local"]`, so it reads
`<cwd>/.claude/settings.json`; the sandbox-agent daemon strips ACP `_meta`, so the cwd
file is the only clean config path (`claude_settings.py:4`).

`permission_rules.wire_author_permission_rules` (`permission_rules.py:39`) is the
second consumer of the same authored slice: it projects the non-MCP author patterns
into the runner permission plan (`permissions.rules` on the wire), skipping `mcp__`
patterns to avoid double-counting tools already covered by MCP-server or tool-spec
permissions.

### 2.5 The capability table, model catalog, and provider-env maps

`capabilities.py` is the per-harness connection-capability table:

- `HARNESS_CONNECTION_CAPABILITIES` (`capabilities.py:214`) has one record per
  harness: `providers` (families it can reach), `deployments` (`direct` / `custom` /
  `bedrock` / `vertex_ai`), `connection_modes` (`agenta` / `self_managed`),
  `model_selection` (`provider/id` for Pi, `alias` for Claude), `models` (the
  selectable ids per family), `model_catalog`, and optional `mcp`.
- The Claude record (`capabilities.py:235`) is the closest shape to a future Codex
  record: single provider family, alias model selection, and an `mcp` block.
  `HarnessMCPCapabilities` (`capabilities.py:177`) declares user-MCP-server support
  (HTTP connection, `none` or `header_secret_refs` credentials); only Claude carries
  it, which is what lets the UI offer user MCP servers on Claude.
- `model_catalog` wiring: `_model_catalog(harness)` (`capabilities.py:131`) loads
  curated per-model entries from `model_catalog.py`, which reads JSON data files under
  `data/` (`model_catalog.py:11`): `pi_models.generated.json` plus a curated overlay
  for Pi, `claude_models.curated.json` for Claude. `model_catalog_entries`
  (`model_catalog.py:147`) returns `[]` for an unknown harness, so a Codex harness
  needs both a data file and a branch there (plus the `sync-model-catalog` skill that
  owns the data).
- `PI_SUBSCRIPTION_MODELS` (`capabilities.py:72`) is where Codex already appears
  today, as a MODEL PROVIDER inside Pi, not as a harness: the `openai-codex` provider
  (OpenAI's ChatGPT/Codex subscription) with explicit ids (`gpt-5.6-sol` through
  `gpt-5.3-codex-spark`). Pi authenticates it through its own OAuth login file
  (`~/.pi/agent/auth.json`), never a vault key, which is why the provider's env group
  in the runner is empty (section 3.5).
- `PROVIDER_ENV_VARS` (`capabilities.py:114`) is the canonical provider-to-env-var
  map; `platform/secrets.py` and `connections/resolver.py` import it so the three
  cannot drift. The runner's `PROVIDER_ENV_VAR_GROUPS` mirrors it by hand (a
  documented cross-language coupling, `services/runner/src/engines/sandbox_agent/daemon.ts:128`).
- Enforcement: `harness_allows_provider` / `_mode` / `_deployment` / `_pair`
  (`capabilities.py:284` onward) are consumed server-side in
  `handler.py:128` through `handler.py:150`, so a direct API caller is rejected with
  the same rules the UI filter uses. An unknown harness is CLOSED (no capability).
  `HARNESS_CUSTOM_DEPLOYMENT_PROVIDERS` (`capabilities.py:328`) restricts the `custom`
  deployment cross-product (Pi custom is openai-only, Claude custom is
  anthropic-only).

## 3. The runner

All paths in this section are under `services/runner/src/` unless stated. The runner is
the Node sidecar that serves `/run`; the engine lives in `engines/sandbox_agent/` with
`engines/sandbox_agent.ts` as a re-export facade.

### 3.1 The flow of one run

`runSandboxAgent` (`engines/sandbox_agent/engine.ts:33`) is the cold path:
`acquireEnvironment`, then `runTurn`, then `env.destroy()`. The keep-alive dispatch in
`server.ts` reuses the same two halves across turn boundaries. `shouldPark`
(`engine.ts:16`) decides whether a completed turn's environment may be pooled.

- `run-plan.ts` (`buildRunPlan`, `run-plan.ts:265`) turns the request into a pure
  `RunPlan`: harness-to-agent mapping, cwd and relay dirs, tool specs, permission
  bookkeeping, and every fail-loud gate (section 3.2).
- `environment-setup.ts` (`prepareEnvironmentSetup`, `environment-setup.ts:56`) signs
  the durable mounts, builds the plan, builds the daemon environment (section 3.5),
  prepares local Pi assets, and assembles the mutable `SessionEnvironment` record.
- `environment.ts` (`acquireEnvironment`, `environment.ts:254`) starts the sandbox via
  `SandboxAgent.start`, uploads Daytona assets, mounts durable storage, prepares the
  workspace (section 3.4), probes capabilities, builds the session MCP server list
  (section 3.6), opens the ACP session (`createSession` or the patched
  `resumeSession`), applies the model (`model.ts`, exact match first, then suffix
  match), and attaches session-lifetime `onEvent` / `onPermissionRequest` listeners
  that demux into `env.currentTurn`.
- `run-turn.ts` (`runTurn`, `run-turn.ts:80`) runs one turn: fresh tracing run, the
  per-turn pause controller and approval responder, the tool relay, then races the
  prompt against the pause signal and the run-limit deadlines.

### 3.2 Harness mapping and the fail-loud gates in the run plan

The harness identity maps to the ACP agent id the daemon knows
(`run-plan.ts:302`): `pi_core` and `pi_agenta` map to `pi`; anything else passes
through unchanged, so `claude` maps to `claude` and a future `codex` would already
reach the daemon as `codex`. A debug assertion pins the Pi mapping
(`run-plan.ts:308`); the old PR relaxed it to `harness.startsWith("pi_")`, which is the
shape a third harness needs.

Gates that fire before any resource is created (each is a named-constant message, the
repo's fail-loud convention):

- Disabled sandbox provider (`run-plan.ts:287`).
- Daytona plus subscription auth: `credentialMode === "runtime_provided"` on Daytona is
  rejected (`run-plan.ts:333`, `DAYTONA_SUBSCRIPTION_UNSUPPORTED_MESSAGE` at
  `run-plan.ts:80`). Subscription state lives only in the runner container and never
  ships to a third-party sandbox.
- Local subscription without a mount: a local `runtime_provided` run requires the
  harness's config-dir env var to be set (`run-plan.ts:341`), and the var is chosen by
  harness: `CLAUDE_CONFIG_DIR` when the ACP agent is `claude`, else
  `PI_CODING_AGENT_DIR` (`run-plan.ts:343`). This binary choice is one of the concrete
  places a Codex harness must add a branch (a `codex` run today would demand
  `PI_CODING_AGENT_DIR`, which is wrong).
- Unenforceable boundaries: declared `filesystem` policy always errors; restricted
  `network` errors on the local sandbox (`run-plan.ts:370`, `run-plan.ts:379`).
- Code tools are refused (`run-plan.ts:389`); user MCP servers on Pi are refused
  (`run-plan.ts:397`); the `agenta-tools` name is reserved (`run-plan.ts:407`);
  non-Pi tools on a non-Daytona remote sandbox are refused (`run-plan.ts:417`).

`legacyHarnessApiKeyVar` (`run-plan.ts:350`) names the api-key env var the harness
reads by default: `ANTHROPIC_API_KEY` for claude, `OPENAI_API_KEY` for everything
else. Codex reads `OPENAI_API_KEY`, so the existing fallback already fits.

The plan carries `harnessFiles` verbatim (`run-plan.ts:165`); nothing in the runner
parses them.

### 3.3 Where local harness assets are prepared

`environment-setup.ts` is the local asset-prep site:

- Pi: `prepareLocalPiAssets` (`pi-assets.ts:608`, called at
  `environment-setup.ts:251`) builds a throwaway per-run Pi agent dir (settings,
  extension bundle, models.json, system prompts) unless the run is subscription-backed,
  in which case Pi runs out of the operator's mounted login directly.
- Claude: no local asset step exists. Its settings ride `harnessFiles` into the cwd,
  its credential rides `secrets` as env, and its connection extras ride
  `applyClaudeConnectionEnv` (`runtime-policy.ts:52`): `ANTHROPIC_BASE_URL`, the
  Bedrock/Vertex flags, and `ENABLE_TOOL_SEARCH=false` (a Claude SDK workaround so
  `agenta-tools` schemas are loaded before the first call).
- A local Claude subscription run deliberately makes no per-run copy of the login:
  Claude refreshes its OAuth token mid-run and writes it back, so the mount must be the
  live read-write directory (`environment-setup.ts:278`, comment block).
- Daytona: `prepareDaytonaPiAssets` (`daytona.ts`, called at `environment.ts:699`)
  uploads the Pi login, extension, and models.json into the remote sandbox; for a
  non-Pi harness with tools, `uploadToolMcpAssets` (`environment.ts:713`) uploads the
  in-sandbox stdio MCP shim instead.

A Codex asset step (writing `auth.json` from the resolved key, per section 6) would sit
beside `prepareLocalPiAssets` in `environment-setup.ts`, with its cleanup in
`environment.destroy` (`environment.ts:292`).

### 3.4 Workspace preparation and who writes the harness files

`prepareWorkspace` (`workspace.ts:49`) materializes the cwd on both local and Daytona:

- The instructions file name is harness-aware (`workspace.ts:57`): `CLAUDE.md` for the
  claude agent (the Claude SDK memory loader reads only `CLAUDE.md`), `AGENTS.md` for
  every other harness. Codex reads `AGENTS.md` natively (TO VERIFY IN SPIKE), so the
  existing default likely fits without a branch.
- Every `harnessFiles` entry is written blind under the cwd (`workspace.ts:88` for
  Daytona, `workspace.ts:128` for local). This is the answer to "who writes
  `.claude/settings.json`": the Python adapter renders it, the runner's
  `prepareWorkspace` writes it.
- Skills: Pi consumes an immutable snapshot; every non-Pi harness gets project-local
  `.<acpAgent>/skills/<name>` copies (`workspace.ts:56`), so a codex run with skills
  would today produce `.codex/skills/`; whether Codex reads that is unknown (TO VERIFY
  IN SPIKE).

### 3.5 The daemon environment and least-privilege credential scoping

`daemon.ts` builds the environment the local daemon is born with and resolves the
daemon binary:

- `resolveDaemonBinary` (`daemon.ts:26`) finds the platform CLI binary shipped by the
  `@sandbox-agent/cli-*` packages, preferring `SANDBOX_AGENT_BIN`.
- `KNOWN_PROVIDER_ENV_VARS` (`daemon.ts:76`) is the CLEAR set: every provider api key,
  every Anthropic auth/OAuth var, and the AWS/GCP/Azure cloud groups. On a managed run
  (`credentialMode === "env"`) `buildDaemonEnv` copies NONE of them; the caller then
  applies only the resolved `plan.secrets` (`environment-setup.ts:170`). This is the
  clear-then-apply discipline (Security rule 5 of the provider-model-auth design). The
  set has no `CODEX_API_KEY` entry today.
- `PROVIDER_ENV_VAR_GROUPS` (`daemon.ts:132`) is the least-privilege INHERIT map for
  non-managed runs: a run that declared provider X inherits only X's vars
  (`inheritableProviderEnvVars`, `daemon.ts:188`). The `openai-codex` group is
  deliberately empty (`daemon.ts:151`): Pi's ChatGPT/Codex subscription authenticates
  from its OAuth file, not env. `DEPLOYMENT_ENV_VAR_GROUPS` (`daemon.ts:160`) adds the
  cloud group per deployment. An unknown provider falls back to the whole known set.
- Config-dir env vars are inherited on every run because they are paths, not
  credentials: `PI_CODING_AGENT_DIR` and `CLAUDE_CONFIG_DIR` (`daemon.ts:263`). There
  is no `CODEX_HOME` line; a Codex harness needs one.
- Sandbox-provider infra creds are force-blanked on every run
  (`KNOWN_SANDBOX_ENV_VARS`, `daemon.ts:116`), because the daemon's local provider
  spawns with `{...process.env, ...options.env}`.

### 3.6 Tool delivery: the agenta-tools channel

Backend-resolved tools reach a non-Pi harness through the runner's internal MCP server,
named `agenta-tools` on every transport (`engines/sandbox_agent/mcp.ts:70`):

- Local: `buildToolMcpServers` (`tools/mcp-bridge.ts:78`) starts a loopback HTTP MCP
  server on the runner host advertising the run's resolved specs, with a per-server
  bearer token; the session's MCP list carries a `type: "http"` entry pointing at it.
  Tool calls relay back into the runner (`tools/relay.ts` executes them server-side
  with the private specs and callback auth held in runner memory;
  `relay-guard.ts` re-checks permissions so a forged relay file cannot execute a
  denied tool).
- Daytona: the loopback URL is unreachable from inside the sandbox, so the channel is
  an uploaded in-sandbox stdio shim instead (`buildInternalToolMcpEntry`,
  `mcp.ts:108`; assets uploaded by `tool-mcp-assets.ts`). The shim writes relay
  request files the runner-side loop executes.
- `buildSessionMcpServers` (`mcp.ts:290`) assembles the session list: the internal
  channel (Layer 1) plus the user's own declared HTTP MCP servers (Layer 2,
  `toAcpMcpServers` with an SSRF guard, `mcp.ts:159`). Pi gets `[]` (its tools ride
  the bundled extension). The two layers gate independently by design.
- Capability gating: `probeCapabilities` reads the daemon's `AgentInfo.capabilities`;
  when the probe is empty the static fallback treats every non-`pi` agent as
  MCP-capable (`capabilities.ts:100`, comment: "pi-acp does not forward MCP,
  Claude/Codex do"). `assertRequiredCapabilities` fails loud when a run carries tools
  the harness cannot receive.

Claude addresses these tools as `mcp__agenta-tools__<name>`, which is what the rendered
Layer 3 rules match (section 2.4).

### 3.7 The approvals architecture

The pieces, in the order a permission request flows:

- The daemon forwards a harness's ACP `session/request_permission` reverse-RPC; the
  session-lifetime listener routes it into the active turn
  (`environment.ts:1084`, `session-events.ts`).
- `attachPermissionResponder` (`acp-interactions.ts:108`) classifies the request.
  Detection order: on a Pi run (marked by the presence of `piToolSpecsByName`), a gate
  riding Pi's `ctx.ui.confirm` dialog is parsed from its envelope and fails closed on
  any mismatch; otherwise the base path builds a `GateDescriptor` from the ACP tool
  call plus the run's real resolved specs (`buildGateDescriptor`,
  `acp-interactions.ts:515`, stripping the `mcp__agenta-tools__` prefix to find the
  spec). Client tools get their own pause; everything else goes to the responder's
  policy (`responder.ts`, fed by the wire `permissions` plan and stored decisions).
- A verdict of `pendingApproval` pauses the turn: `pauseUserApproval`
  (`acp-interactions.ts:152`) emits one `interaction_request` event, records a durable
  interaction row, and fires `onPause`. A pause sends NO reply to the harness
  (replying `reject` would clobber the approval prompt, the F-024 bug).
- `ParkedApprovalGateType` (`acp-interactions.ts:25`) is a CLOSED two-value union:
  `"claude-acp-permission" | "pi-acp-permission"`. The base (non-Pi) path hardcodes
  `"claude-acp-permission"` (`acp-interactions.ts:432`), and the keep-alive dispatch
  in `server.ts:668` resumes only those two values. A Codex gate today would be
  labeled a Claude gate; the design must either add a `codex` value or generalize the
  base label. This union, the classification, and the resume check are the three
  coupled sites.
- `PendingApprovalPauseController` (`pause.ts:11`) is the per-turn pause latch: first
  pause wins, it runs the destroy callback (which in park mode skips session
  teardown), suppresses later frames for paused tool-call ids, and exposes `signal`
  that the prompt race in `runTurn` awaits (`run-turn.ts:482`).
- Park and resume: `ParkedApproval` (`runtime-contracts.ts:113`) records the gate
  type, ACP permission id, tool-call id, args, interaction token, and the still-pending
  `prompt()` promise. `ResumeApprovalInput` (`runtime-contracts.ts:131`) is the
  resume shape; `runTurn` answers the parked gate on the live session via
  `session.respondPermission` and continues the original prompt
  (`run-turn.ts:437`). Only a single-gate pause parks
  (`env.approvalGateCount`, `runtime-contracts.ts:231`).
- Client tools (browser-fulfilled) ride the same `agenta-tools` channel but pause at
  the MCP `tools/call` instead (`client-tools.ts`, `tools/client-tool-relay.ts`); they
  are never parked across turns.

### 3.8 The subscription mount contract

Subscription auth (the harness signs itself in from the operator's own login state,
`credentialMode === "runtime_provided"`) is local-only by policy:

- Daytona rejection: `run-plan.ts:333` (section 3.2).
- The mount contract: the operator sets the harness's config-dir env var on the runner
  container to a read-write mount of the login (`CLAUDE_CONFIG_DIR` for Claude,
  `PI_CODING_AGENT_DIR` for Pi; `run-plan.ts:341`), the daemon env inherits it
  (`daemon.ts:263`), and the harness reads AND refreshes its OAuth state in place
  (`environment-setup.ts:278`). `plan.sourcePiAgentDir` defaults to `~/.pi/agent`
  (`run-plan.ts:536`).
- The compose files carry these vars for the dev/gh stacks
  (`hosting/docker-compose/oss/docker-compose.dev.yml` and siblings;
  `hosting/kubernetes/helm/templates/runner-deployment.yaml`).

## 4. What the pinned sandbox-agent daemon supports for Codex today

Source: the installed `sandbox-agent@0.4.2` package and its
`@sandbox-agent/cli-linux-x64@0.4.2` binary in the main checkout's
`services/runner/node_modules` (same pin as this worktree's
`services/runner/package.json:36`), plus the repo patch
`services/runner/patches/sandbox-agent@0.4.2.patch`. The binary was inspected via
strings only; behavioral claims from it are structural, not tested.

- **The JS SDK knows codex as a first-class agent.** `DEFAULT_AGENTS = ["claude",
  "codex"]` in the SDK's provider chunk, and its `autoAuthenticate` answers ACP auth
  methods with ids `codex-api-key`, `openai-api-key`, or `anthropic-api-key`.
- **The daemon binary can spawn five agents**: `claude`, `codex`, `amp`, `pi`,
  `cursor` (display names "Claude Code", "Codex CLI", ...). Its embedded adapter
  registry (`adapters.json` baked into the binary) maps `codex` to the npm package
  `@zed-industries/codex-acp`, pinned version `0.1.0` (claude maps to
  `@zed-industries/claude-agent-acp` 0.20.0, pi to `pi-acp` 0.0.23).
- **Adapter resolution order** (log strings in the binary): builtin, then a PATH
  binary hint, then npm install from the ACP registry
  (`cdn.agentclientprotocol.com/registry/v1/latest/registry.json`), then a fallback
  launcher. The runner today satisfies claude and pi from PATH: it prepends its own
  `node_modules/.bin` (which contains `claude-agent-acp` and `pi-acp`) to the daemon's
  PATH (`daemon.ts:257`). There is NO `codex-acp` binary in the runner's
  `node_modules/.bin`, so a codex session would fall to the runtime npm-install path
  unless the runner vendors the bridge the same way (TO VERIFY IN SPIKE, question 1).
- **Codex CLI auto-install**: the binary downloads the codex CLI from
  `github.com/openai/codex/releases/.../codex-<target>` on demand
  (`agent_manager.install_codex` strings), with a `sandbox-agent install-agent <id>`
  CLI for pre-baking. Runtime network access from the runner image is therefore a
  deployment question (TO VERIFY IN SPIKE, question 1).
- **Credential detection**: the daemon's credentials probe reads `.codex/auth.json`
  and looks for an `OPENAI_API_KEY` field or a `tokens.access_token` field (OAuth),
  and separately knows the env vars `CODEX_API_KEY` and `OPENAI_API_KEY`. This
  matches the old PR's auth-file finding (section 6).
- **An embedded codex model catalog** lists `gpt-5.x-codex` ids (for example
  `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `-fast` / `-high` / `-xhigh` variants) with
  `"defaultModel": "gpt-5.3-codex"`. The ids visible in the 0.4.2 binary are older
  than Pi's current `openai-codex` list (`capabilities.py:72`), so the real list must
  be probed live (TO VERIFY IN SPIKE, question 8).
- **The repo patch** (`patches/sandbox-agent@0.4.2.patch`) is harness-agnostic plumbing
  the runner relies on: `session/load` support behind the agent's `loadSession`
  capability (with a `claudeCode.options.resume` `_meta` hint that is Claude-specific),
  pause-instead-of-destroy on reconnect failure, process-group kill and detached spawn
  for the local daemon. Whether `codex-acp` advertises `loadSession` decides whether
  session continuity works for Codex (TO VERIFY IN SPIKE, question 7).

## 5. How subscription authentication works today and where Codex plugs in

Two harnesses authenticate from a personal subscription today, both through the same
mechanism (section 3.8): the operator logs the harness in once, mounts the login into
the runner container read-write, and points the harness's config-dir env var at it.

- Claude: login state in `~/.claude` (`.credentials.json` with a `claudeAiOauth`
  block); env var `CLAUDE_CONFIG_DIR`. Recipe and rationale:
  `docs/design/agent-workflows/projects/subscription-sidecar/README.md` (the
  "subscription sidecar" is a second runner container started with these mounts for
  dev/test; note that document predates the `services/agent` to `services/runner`
  rename and the read-write mount requirement).
- Pi with the `openai-codex` provider: login state in `~/.pi/agent/auth.json`
  (created by `pi` then `/login` with a ChatGPT account); env var
  `PI_CODING_AGENT_DIR`. The reachable models are `PI_SUBSCRIPTION_MODELS`
  (`capabilities.py:72`); the runner normalizes a bare id onto Pi's
  `openai-codex/<id>` model (`model.ts:93`). This is Codex-the-subscription through
  Pi-the-harness; it shares nothing on disk with the Codex CLI's own login.

A Codex-harness self-managed path would plug into the same five seams:

1. A config-dir env var for the mount (Codex's own is `CODEX_HOME`, default
   `~/.codex`; TO VERIFY IN SPIKE, question 4) added to the `run-plan.ts:343` branch
   and inherited in `buildDaemonEnv` beside `CLAUDE_CONFIG_DIR` (`daemon.ts:263`).
2. The login file itself: `~/.codex/auth.json`, which the daemon's credential probe
   already reads (section 4).
3. The `capabilities.py` record advertising `self_managed` for the codex harness (the
   `connection_modes` axis, section 2.5), so the app layer stops rejecting the run
   before it reaches the runner.
4. The Daytona rejection, which needs no change: `run-plan.ts:333` keys on
   `credentialMode`, not on the harness.
5. The provider env group: a `codex`-harness run resolves provider `openai`, whose
   inherit group is `["OPENAI_API_KEY"]` (`daemon.ts:133`); an OAuth-only run needs no
   env at all, mirroring the empty `openai-codex` group.

## 6. Salvage notes from the stale PR stack

The stack: #5042 (harness-agnostic remote asset-prep seam), #5043 (Codex harness on
the local sandbox), #5049 (Codex on Daytona), #5050 (Codex on E2B), all by junaway,
July 2, based on the dead `big-agents` trunk. Read via `gh pr diff`, read-only. The
code targets a pre-split runner (a monolithic `engines/sandbox_agent.ts`) and a
pre-migration wire contract, so nothing rebases; the list below is what to re-type
against main and what to discard.

### Directly reusable on main (from #5043)

- **The auth-file insight**, the stack's most valuable finding, stated in its docs and
  implemented in `writeCodexAuthFile`: the codex CLI reads `~/.codex/auth.json` as a
  FILE; env injection alone is insufficient. Managed runs must write
  `{"OPENAI_API_KEY": "<key>"}` into it before the daemon starts (dir `0700`, file
  `0600`), the field name is always `OPENAI_API_KEY` regardless of the source var, and
  the run's teardown may delete the file only when that run created it (never a
  pre-existing self-managed login). Self-managed runs verify the file exists and warn
  when absent. A dir-override env var (`AGENTA_AGENT_CODEX_DIR` in the PR) kept a
  managed run from clobbering a personal login in a shared home.
- **The SDK skeleton**: `HarnessType.CODEX = "codex"`, the `HARNESS_IDENTITIES` entry
  (`agenta:harness:codex:v0`, name "Codex"), `CodexHarness` mirroring `ClaudeHarness`
  (drop built-ins with a warning, tools over MCP), `CodexAgentTemplate` mirroring
  `ClaudeAgentTemplate`, registration in `_HARNESSES` and the `adapters/__init__` and
  `agents/__init__` exports. All of it re-types cleanly minus the permission field
  (below).
- **The runner mapping change**: `codex` passes through to ACP agent `codex` (main's
  mapping already does this); the Pi identity assertion relaxed to
  `harness.startsWith("pi_") === (acpAgent === "pi")`.
- **Test shapes**: a `run_request.codex.json` golden plus symmetric assertions in
  `test_wire_contract.py` and `wire-contract.test.ts`; `make_harness("codex")`
  adapter tests; `buildRunPlan` tests asserting `acpAgent === "codex"`,
  `legacyHarnessApiKeyVar === "OPENAI_API_KEY"`, `isPi === false`; auth-file writer
  tests covering modes `0600`/`0700`, the created-vs-preexisting return, the
  `CODEX_API_KEY` fallback source, and the self-managed missing-file warning.
- **The capability-table entry shape**: providers `["openai"]`, deployments
  `["direct"]`, both connection modes. (The PR's `model_selection: "id"` was a new
  third value; whether Codex selection is bare-id or alias-like is a design call.)
- **The adapter doc skeleton** (`documentation/adapters/codex.md` in the PR): correct
  structure, stale specifics.

### Obsolete or wrong on main

- **The `permissionPolicy` wire field.** The PR added `permission_policy: "auto" |
  "deny" | ...` on `CodexAgentTemplate` and a `permissionPolicy` key on the wire.
  Main has no such field: permissions ride the structured `permissions: {default,
  rules}` plan (`protocol.ts:476`) plus harness-rendered `harnessFiles`. A Codex
  permission story on main means a `codex_settings.py` sibling of
  `claude_settings.py` rendering Codex's own config, not a scalar policy field.
- **The monolith wiring.** The PR patches `engines/sandbox_agent.ts` directly
  (`prepareLocalCodexAssets` called inside `runSandboxAgent`, cleanup in its
  `finally`) and puts the codex helpers in `pi-assets.ts`. Main split the engine:
  the asset step belongs in `environment-setup.ts`, the cleanup in
  `environment.destroy` (`environment.ts:292`), and a module-level `CODEX_DIR`
  constant read at import time conflicts with per-run env handling (the PR's own tests
  needed `vi.resetModules` to cope).
- **Stale model ids**: `gpt-4.5`, `gpt-4o`, `o3`, `o4-mini` are gone;
  the current subscription list lives at `capabilities.py:72` and the true harness
  list must come from a live probe.
- **Missing against main's current bar**: no `model_catalog` data file, no
  `HarnessMCPCapabilities` decision for user MCP servers, no `permissions` object in
  the golden (main's Claude golden carries it), no approvals/park work, no
  subscription mount branch, and the PR's `harness_allows_provider` comment claims
  absent entries are permissive when main is closed.
- **#5042's remote-assets seam** (`prepareRemoteHarnessAssets`,
  `writeCodexAuthToSandbox`): the idea (a harness-agnostic remote credential-prep
  seam) is sound, but the code targets the monolith and predates
  `uploadToolMcpAssets` and the current Daytona asset flow; re-derive it, do not port
  it. **#5049/#5050**: Daytona must be re-planned against the current
  `prepareDaytonaPiAssets` / shim flow, and E2B has no sandbox provider on main at
  all (also declared a non-goal in `context.md`).
- Path churn throughout: the stack says `services/agent/`; main says
  `services/runner/`.

## 7. Codex CLI and codex-acp facts relevant to the design

Split by evidence class. "Verified" means read from the pinned daemon binary or this
repo; everything else is background knowledge and carries TO VERIFY IN SPIKE.

Verified here:

- The ACP bridge is `@zed-industries/codex-acp`; the pinned daemon installs version
  `0.1.0` from the ACP registry (section 4).
- The daemon treats `.codex/auth.json` with either an `OPENAI_API_KEY` field or a
  `tokens.access_token` field as a valid codex credential, and knows `CODEX_API_KEY` /
  `OPENAI_API_KEY` as codex env vars (section 4).
- The daemon's codex catalog defaults to `gpt-5.3-codex` at pin time (section 4).
- The codex CLI installs from GitHub releases (`openai/codex`) (section 4).

Background knowledge, TO VERIFY IN SPIKE:

- **`CODEX_HOME`**: the env var that relocates Codex's state directory, default
  `~/.codex`. Both `config.toml` (run config) and `auth.json` (login) live in it,
  along with logs and session rollouts. Whether config and login can be split across
  two directories matters for the mount layout (question 4).
- **`config.toml` keys**: `model`; `approval_policy` with values `untrusted`,
  `on-failure`, `on-request`, `never`; `sandbox_mode` with values `read-only`,
  `workspace-write`, `danger-full-access`; a `[sandbox_workspace_write]` table with
  `network_access`; `[mcp_servers.<name>]` tables with `command` / `args` / `env` for
  stdio servers, and in newer releases HTTP transport fields for remote servers;
  `[projects."<path>"]` trust markers; named `[profiles.<name>]`. Exact key names and
  which Codex version the pinned bridge drives are unverified (questions 3, 5, 6).
- **`auth.json` contents by login mode**: an API-key login (`codex login --api-key`)
  yields `{"OPENAI_API_KEY": "sk-..."}`; a ChatGPT OAuth login (`codex login`, browser
  flow) yields a `tokens` object (`id_token`, `access_token`, `refresh_token`,
  `account_id`) plus `last_refresh`, with `OPENAI_API_KEY` null or absent. Codex
  refreshes the OAuth token and rewrites the file in place, which would make the
  read-write mount requirement identical to Claude's (questions 2, 4).
- **Approvals over ACP**: Codex raises exec/patch approval requests; `codex-acp` is
  expected to surface them as ACP `session/request_permission`. The shape of the
  request (title, tool-call id, `availableReplies`) decides how the runner's base-path
  classification and the park record fit (question 6).
- **AGENTS.md**: Codex reads `AGENTS.md` from the project root natively, plus a global
  `$CODEX_HOME/AGENTS.md` (question 10).

## 8. Open questions for the spike

Numbered so the spike findings can reference them.

1. **Bridge and CLI provisioning.** Does a `createSession({agent: "codex"})` against
   the pinned daemon auto-install the codex CLI and `codex-acp` at runtime (needs
   network to GitHub and npm from inside the runner container), and does a PATH-vendored
   `codex-acp` binary in the runner's `node_modules/.bin` short-circuit the install the
   way `claude-agent-acp` and `pi-acp` do? Which codex-acp and codex CLI versions
   actually run?
2. **Auth via env vs file.** With only `OPENAI_API_KEY` in the daemon env and no
   `auth.json`, does a codex run authenticate (via the bridge's `codex-api-key` ACP
   auth method), or is the auth file strictly required as the old PR found? Does a
   ChatGPT-OAuth `auth.json` (tokens object, no API key) authenticate identically, and
   does Codex rewrite it mid-run (token refresh)?
3. **MCP delivery.** Does the daemon pass the session's `mcpServers` list (the
   `type: "http"` `agenta-tools` entry with its bearer header) through `codex-acp` to
   Codex? Which MCP transports does the driven Codex version accept (stdio only, or
   HTTP)? Do `tools/list` and `tools/call` round-trip, and do tool events stream as
   `tool_call` / `tool_call_update` frames the tracer maps?
4. **Config and login separation.** Does `CODEX_HOME` relocate both `config.toml` and
   `auth.json` together? Can the runner give each run its own `config.toml` (per-run
   `CODEX_HOME` with a copied or symlinked login, or a cwd-level config, or `-c`
   overrides through the bridge) without breaking a subscription login's in-place
   token refresh? This decides the mount layout for Checkpoint 1.
5. **Per-run config respected.** When the runner writes a `config.toml` (via
   `harnessFiles` into the cwd, or into `CODEX_HOME`), does the codex spawned by
   `codex-acp` actually honor it (model, `approval_policy`, `sandbox_mode`,
   `mcp_servers`), or does the bridge override config with its own CLI flags?
6. **Approvals shape.** Under which `approval_policy` / `sandbox_mode` does
   `codex-acp` raise ACP permission requests, and in what shape (`availableReplies`
   values, `toolCall.title` / `kind`, stable tool-call ids)? Does an unanswered gate
   survive the runner's pause contract (no reply, session teardown resolves the RPC as
   cancelled), and can a parked gate be answered later on the live session via
   `respondPermission` (the park-and-resume path)?
7. **Session continuity.** Does `codex-acp` advertise the ACP `loadSession`
   capability, which the repo's sandbox-agent patch requires for `session/load`
   resume? If not, does cold replay (the runner's fallback) behave correctly?
8. **Model listing and selection.** What model ids does a live codex session advertise
   (session config options or modes), does `applyModel`'s exact-then-suffix matching
   select them, and what does the harness report back as the resolved model for the
   chat span?
9. **Capability probe.** What does the daemon's `AgentInfo.capabilities` report for
   codex (`mcpTools`, `permissions`, `streamingDeltas`, `sessionLifecycle`, `usage`),
   and does it match the static non-Pi fallback in `capabilities.ts`?
10. **Instructions file.** Does the codex run read the cwd `AGENTS.md` that
    `prepareWorkspace` writes for non-claude harnesses, with no filename branch
    needed?
11. **Usage reporting.** Does `codex-acp` emit token usage the runner's
    `resolveRunUsage` / stream-usage path can read, or does a codex run need a
    usage-out mechanism like Pi's?
12. **Skills directory.** Does Codex read anything from the `.codex/skills/<name>`
    directories the workspace writer would produce for a skills-carrying run, or
    should the skill copy be skipped for codex?
