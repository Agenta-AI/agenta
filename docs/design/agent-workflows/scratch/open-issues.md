# Open issues

Deferred TODOs and open questions for the agent-workflows project. Each entry carries enough
context and provenance to act on cold. See the `defer-todo` skill for the format.

## Open issues

### The `install_http` integration fixture patches removed `agenta_api_base`/`request_authorization` seams

**Status:** open
**Added:** 2026-06-24
**Commit:** 670491fee0 (branch `gitbutler/workspace`)
**Project:** [agent-workflows/provider-model-auth](../projects/provider-model-auth/) (found here; root cause is the earlier tool-resolution `PlatformConnection` refactor)
**Source:** provider-model-auth Slice 3 implementation + test run

**The problem.** All 15 integration tests under
`services/oss/tests/pytest/integration/agent/` that use the `install_http` fixture are RED
(`test_resolve_secrets_http.py`, `tools/test_gateway_http.py`, `tools/test_secrets_http.py`).
The fixture (`services/oss/tests/pytest/integration/agent/conftest.py:66-67`) does
`monkeypatch.setattr(module, "agenta_api_base", ...)` and `"request_authorization"`, but those
module-level seams were removed when tool/secret resolution moved into the SDK
`agenta.sdk.agents.platform` package and started constructing `PlatformConnection()` (which
resolves base URL + auth via its own `base_url()` / `headers()` / `_derive_*`). The resolver
modules (`oss.src.agent.secrets`, the gateway/named-secret SDK modules) no longer expose those
names, so the fixture raises `AttributeError` before the test body runs.

**Why it is deferred (not fixed in this feature run).** It is pre-existing debt from a sibling
project's refactor (red on the base branch, not caused by provider-model-auth), and it spans
the gateway and named-secret resolvers owned by the tool-resolution work, not this feature.
Folding a cross-cutting test-infra migration into the provider-model-auth lane would mix
concerns. The provider-model-auth resolve path has its own green coverage: the SDK
`VaultConnectionResolver` httpx-mocked test
(`sdks/python/oss/tests/pytest/unit/agents/platform/test_connections_http.py`) and the pure
API resolution tests (`api/oss/tests/pytest/unit/secrets/test_connections.py`). The deprecated
`resolve_secrets`/`resolve_harness_secrets` that `test_resolve_secrets_http.py` exercises is
being retired anyway (its `app.py` call site was removed in Slice 3).

**What to decide or do.** Migrate the `install_http` fixture to patch the new seam: either
`monkeypatch.setattr(PlatformConnection, "base_url", ...)` and `"headers"`/`"authorization"`,
or the module-level `_derive_base_url`/`_derive_authorization` in
`sdks/python/agenta/sdk/agents/platform/connection.py`. Then delete
`test_resolve_secrets_http.py` (it tests the retired whole-vault dump) or repoint it at the new
connection-resolve path. This unblocks the gateway and named-secret integration tests too.

### Supply secret values to tools during a standalone run

**Status:** open
**Added:** 2026-06-19
**Commit:** 6a812efb95 (branch `gitbutler/workspace`)
**Project:** [agent-workflows/sdk-local-tools](./sdk-local-tools/)
**Source:** sdk-local-tools design review session (answering reviewer comments on plan.md, Decision 3)

**The problem.** An agent's `code` tool declares the secrets it needs by name, for example
`secrets: ["GITHUB_TOKEN"]`. An MCP server declares an env-var-to-name map. The config stores
only the name, never the value. At run time something must turn the name into a value and
inject it as an env var, into the sandbox subprocess for a code tool or into the server
process for MCP. On the Agenta server path that consumer is meant to read the `custom_secret`
entries from the project vault by name, but it is not built yet. Custom secrets are
storage-only this iteration by design, so today a declared secret resolves to nothing and the
tool runs without it. For a standalone run the goal is different: do not depend on the Agenta
vault at all. The trouble is the SDK has no secret resolution of any kind today. Resolution
lives only in the service. So a standalone agent has no way to supply `GITHUB_TOKEN` to its
code tool.

**Why it is deferred.** The first slice is offline and narrow (built-in plus code tools with
env secrets). Env alone closes the gap for that slice, so the wider question of where secret
values come from does not block it. The vault path also depends on work another effort owns
(see below), so it cannot land here yet.

**What to decide or do.** Pick the local source of secret values for a standalone run. Three
options, and they are not exclusive.

1. Env, the offline default. Read the declared name straight from the process environment.
   `GITHUB_TOKEN` comes from `os.environ`. Simple, offline, and enough for the first slice.
2. A pluggable `SecretResolver` interface. The user implements it. Env is the built-in
   default, but they can back it with a `.env` file, a secret manager, or their own vault. A
   small interface for a lot of flexibility.
3. The Agenta vault over HTTP. It reads `custom_secret` entries by name. This needs the
   future runtime consumer endpoint to be built, and it is the connected-standalone path
   only.

The lean: ship option 1 as the default and option 2 as the interface it plugs into, both in
the first slice. Treat option 3 as later work tied to the named-secrets effort building the
consumer. See [./sdk-local-tools/plan.md](./sdk-local-tools/plan.md) (Decision 3 and Phase
4), [./sdk-local-tools/research.md](./sdk-local-tools/research.md) (stage 3), and
[../vault-named-secrets/](../vault-named-secrets/).

### Batch the two vault round-trips on the agent invoke path

**Status:** open
**Added:** 2026-06-19
**Commit:** 6a812efb95 (branch `gitbutler/workspace`)
**Project:** [agent-workflows/sdk-local-tools](./sdk-local-tools/)
**Source:** xhigh code review of the sdk-local-tools first slice

**The problem.** The service resolves a code tool's named secrets inside `resolve_tools` and an
MCP server's named secrets inside `resolve_mcp_servers`. Each one builds its own
`_VaultSecretResolver` and makes its own `POST /secrets/resolve`. When a config has both a code
tool and an enabled MCP server that each declare secrets, a cold invoke makes two sequential
vault round-trips where one batched call over the union of names would do. The two functions
are also awaited one after another in `app.py`, not concurrently.

**Why it is deferred.** MCP is flag-gated off this release, so the second round-trip does not
happen on the default path yet. The cost only appears once MCP turns on. Fixing it now would be
optimizing a path no one runs.

**What to decide or do.** When MCP comes off the flag (sdk-local-tools Phase 5), resolve the
union of code-tool and MCP secret names in one vault call, and consider running the independent
resolve steps in `app.py` concurrently.

### Give the resolved-tool shape one source of truth

**Status:** open
**Added:** 2026-06-19
**Commit:** 6a812efb95 (branch `gitbutler/workspace`)
**Project:** [agent-workflows/sdk-local-tools](./sdk-local-tools/)
**Source:** xhigh code review of the sdk-local-tools first slice

**The problem.** `ResolvedTools` (the SDK resolver's return type) carries the same four fields,
`builtin_tools` / `custom_tools` / `tool_callback` / `mcp_servers`, that `SessionConfig` already
declares. The two shapes can drift: when a new per-tool wire field lands, a maintainer has to
add it in both places, and missing one silently drops the field from either the standalone path
or the service path.

**Why it is deferred.** The duplication is small and the two types serve different layers today
(a resolver result versus the full session bundle). It is a maintainability touch-point, not a
bug.

**What to decide or do.** Decide whether the resolver should return the `SessionConfig` tool
fields directly (or a shared sub-model both reuse), so the wire tool shape has one definition.

### Relay-tool HITL: resolved code/gateway tools cannot park/emit/resume (S5.2)

**Status:** open
**Added:** 2026-06-24
**Commit:** 770cdf4068 (branch `gitbutler/workspace`)
**Project:** [agent-workflows/capability-config](../projects/capability-config/) (Phase 5, slice S5.2)
**Source:** capability-config HITL slice — built `HITLResponder` for the harness (Claude builtin)
permission gate, deferred the relay path.

**The problem.** The cross-turn approval just built (`HITLResponder` in
`services/agent/src/responder.ts`, wired at `services/agent/src/engines/sandbox_agent.ts`
~:270) only covers permissions the **harness** raises over ACP (Claude builtins; Pi never
gates). Resolved `code` and gateway/`callback` tools never reach that gate — they run through
the runner-side relay loop (`services/agent/src/tools/relay.ts`), which is a synchronous
fire-and-forget poll: `executeRelayedTool` (relay.ts:114-147) resolves a tool's `disposition`
via `resolveDisposition` (relay.ts:49-66) and, for `ask` or an unset disposition, collapses
onto the headless `permissionPolicy` and returns a refusal string
(`"...requires approval; denied in headless mode."`, relay.ts:128-129). There is no way for the
relay to emit an `interaction_request`, end the turn, and resume the same call on a later turn,
so an `ask` Composio/code tool can never actually prompt a human. The `TODO(S5)` markers at
`relay.ts:65` and `relay.ts:128` flag exactly this. The S3b `ask`->policy behavior was left
as-is per the slice scope.

**Why it is deferred.** The relay loop has no turn-boundary model. The harness path can park
because the ACP permission request is itself the suspension point (the harness blocks awaiting
`respondPermission`); the relay just executes and returns a string inline. Giving the relay a
park/resume needs a different mechanism, not a tweak to `resolveDisposition`.

**What it would take.** When the relay hits an `ask`/unset tool with no recorded decision: emit
an `interaction_request` (permission) keyed by the tool-call id (reuse the
`extractApprovalDecisions` lookup the responder already builds from the inbound messages), then
END the turn instead of returning a refusal — i.e. do NOT write the relay response file, let the
harness see an incomplete tool call, and surface the prompt. On the next turn, the runner reads
the stored decision from the replayed messages (same `{ approved: boolean }` envelope the
responder consumes) and either executes the relayed call or returns the denial. This couples the
relay to the run's turn lifecycle (today it is a standalone poll started/stopped around
`session.prompt`), so it likely needs the relay to share the responder's decision map and a way
to signal "park this turn" back up to the engine. Open sub-question: whether a cold replay even
re-attempts a relayed `code`/gateway call on turn 2 (see the live-verification todo below).

### Live multi-turn HITL round-trip is unverified (cold-replay re-raise + re-attempt)

**Status:** open
**Added:** 2026-06-24
**Commit:** 770cdf4068 (branch `gitbutler/workspace`)
**Project:** [agent-workflows/capability-config](../projects/capability-config/) (Phase 5 / Phase 6 acceptance)
**Source:** capability-config HITL slice — `HITLResponder` is unit-tested (park, resume, headless
parity) but never exercised against a live multi-turn run.

**The open question.** The park/resume design assumes that after turn 1 parks an `ask` (the
responder returns `deny`/`reject`, the turn ends with the unapproved tool not run), turn 2 —
carrying the user's approval in the replayed message history — makes the **cold** harness
re-raise the SAME permission so the stored decision applies, AND that the harness then actually
re-attempts the tool. Neither is proven. Each `/invoke` is a cold sandbox that replays prior
turns as transcript text (`services/agent/src/engines/sandbox_agent/transcript.ts`), so whether
the model re-issues the identical tool call and the harness re-raises the gate on turn 2 is an
empirical property of the harness + the replayed transcript, not something the responder can
guarantee. The responder keys decisions by tool-call id AND tool name precisely because a cold
replay mints fresh ids each turn (so the name is the stable anchor) — but that only helps if the
gate is re-raised at all.

**Why it is deferred.** It needs a live multi-turn run against the real harness over the
sidecar; it cannot be faked in a unit test (a fake harness re-raises on demand and proves
nothing about the real one).

**The exact live test to run.** Against a running agent sidecar (e.g. the EE-dev compose stack;
see the `agent-workflows-qa` / `debug-local-deployment` skills), with a Claude agent configured
so a mutating builtin (or an `ask`-disposition tool) triggers a permission gate:

1. POST `/messages` with `session_id=S` and a single user turn that forces the gated tool
   (e.g. "edit file X"). Assert the response stream contains a `tool-approval-request`
   (the parked gate) and that the tool did NOT run (no `output-available` for it).
2. POST `/messages` again with the SAME `session_id=S`, replaying the full history plus a
   `tool-approval-response` part (`approved: true`) for that tool call. Assert that this turn
   the harness re-raises the gate, the stored decision resolves it to `always`, and the tool
   ACTUALLY runs (a `tool-output-available` / real tool result appears, and the file is edited).
3. Repeat step 2 with `approved: false` in a fresh session and assert the tool stays un-run and
   the model continues without it.

If turn 2 does NOT re-raise the gate (the model does not re-issue the call after a cold replay),
the design needs a different resume mechanism (e.g. the runner replaying the approved tool's
result directly into the transcript rather than relying on the harness to re-ask). Capture the
finding either way.

### Land the runner half of test_run (slice 5b) and default the flag on

**Status:** open
**Added:** 2026-07-04
**Commit:** 61cf1751b9 (branch `feat/build-kit-tools-cleanup`)
**Project:** [agent-workflows/build-kit-tools-cleanup](../projects/build-kit-tools-cleanup/)
**Source:** build-kit-tools-cleanup implementation, slice 5 split into 5a (server) / 5b (runner)

**The problem.** The builder agent cannot test the agent it builds. Slice 5a shipped the
server half of `test_run`: a handler-mode `PlatformOp` (`handler` XOR `method`+`path`), a
reserved-ref registry dispatch at `POST /tools/call`
(`api/oss/src/core/tools/platform_handlers.py`), and the composite handler (hydrate the bound
variant, apply an optional in-memory `delta` gated on `EDIT_WORKFLOWS`, invoke headless with a
server-minted token, digest spans, return a terminal-result-wins verdict under a 120s
ceiling). The runner half does not exist: the runner cannot dispatch a reserved
`tools.agenta.*` `call_ref`, does not inject spec-level `contextBindings`, does not honor
`timeoutMs`, and `protocol.ts` plus the golden wire fixtures do not carry the two new spec
fields. Resolution of handler-mode ops is therefore gated off by
`AGENTA_AGENT_ENABLE_PLATFORM_HANDLERS` (default off), and `test_run` is not in
`DEFAULT_BUILD_KIT_OPS`.

**Why it is deferred.** The runner/wire surface (`relay.ts`, `protocol.ts`, `responder.ts`)
was doubly contended when 5a landed: the `feat/claude-client-tools-recut` lane owns recent
commits on those files, and a second session held uncommitted pi-builtin-gating WIP on the
same files. Editing over live WIP was ruled out (plan.md coordination constraint 2).

**What to do.** In one slice, once the runner surface is free: mirror `contextBindings` and
`timeoutMs` into `protocol.ts` and the golden fixtures (both wire contract tests move
together); add the reserved-`call_ref` branch in the relay with `$ctx` injection strictly
after the permission verdict (fail hard on an unresolvable binding, like `assembleBody`);
honor per-spec `timeoutMs` over the relay default; make the recursion marker deny nested
`test_run`; add `test_run` to `DEFAULT_BUILD_KIT_OPS` and flip the playbook's test step from
the `query_spans` interim wording; then default the flag on and delete it. Acceptance: the
lab capstone (build, `test_run`, read `pass`, schedule) runs inside the playground, and a
gated write in the child run surfaces in `approvals` with verdict `unconfirmed`. Contract
detail: [api-design.md](../projects/build-kit-tools-cleanup/api-design.md), "5a -> 5b
contract".

### Decide and execute the gateway -> server executor rename (or close it)

**Status:** open
**Added:** 2026-07-04
**Commit:** 61cf1751b9 (branch `feat/build-kit-tools-cleanup`)
**Project:** [agent-workflows/build-kit-tools-cleanup](../projects/build-kit-tools-cleanup/)
**Source:** build-kit-tools-cleanup slice 6, deferred at implementation per the plan's default

**The problem.** The `gateway` tool type name misleads. "Gateway" means "runs through the
Agenta gateway", and Agenta-implemented actions (platform ops, handler ops) sit on that same
server-side plane by design, so the name no longer carves the space at the right joint. The
rename proposal (`server` as the executor vocabulary) is argued in
[tool-home-options.md](../projects/build-kit-tools-cleanup/tool-home-options.md).

**Why it is deferred.** Mahmoud proposed but did not decide the rename. The Codex design
review scoped the safe version to docs and UI labels only: the persisted config literal
(`type: "gateway"`) is a data migration (fold into the revision sweep script at
`data.parameters.agent.tools[*].type`), plus the SDK discriminator, FE config forms, and the
wire `kind` docs. That is too much surface to land unreviewed at the tail of a large PR, and
slice 6 was defined as droppable.

**What to decide or do.** At (or after) review of the build-kit-tools-cleanup PR: either
(a) rename docs/comments/UI labels only and keep `type: "gateway"` as the stored literal, or
(b) do the full rename including the sweep-script data migration and SDK/FE surfaces, or
(c) close the proposal and keep the name. The `callRef` field keeps its name in every
outcome. Scope inventory: plan.md slice 6 in the
[project workspace](../projects/build-kit-tools-cleanup/plan.md).
