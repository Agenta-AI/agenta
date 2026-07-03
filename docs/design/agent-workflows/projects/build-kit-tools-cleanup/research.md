# Research: executor architecture, rename/cut surfaces, gotchas

Status: 2026-07-03. Everything here was read from the working tree today. File:line
references are to the repo root (`/home/mahmoud/code/agenta`) unless marked as the lab
(`/home/mahmoud/code/agent-creation-lab`).

Companion docs: [tool-home-options.md](tool-home-options.md) weighs the four homes for
logic-bearing tools; [api-design.md](api-design.md) sketches the `test_run` contract;
[context.md](context.md) has the goals and settled decisions.

## Part 1: how tools actually execute today

### The four executor kinds on the wire

`ResolvedToolSpec` (`services/runner/src/protocol.ts:105-141`) has two orthogonal axes:
`kind` (executor: `"callback" | "code" | "client"`, absent = callback) and `render`
(generative UI). A callback spec carries `call` XOR `callRef`:

- **`callRef`** = gateway tools (Composio). The runner POSTs the OpenAI-style envelope
  back to Agenta's `/tools/call` (`services/runner/src/tools/callback.ts:31-91`). The
  Composio secret stays server-side.
- **`call`** = direct-call tools (reference and platform). The runner calls the named
  Agenta endpoint itself (`services/runner/src/tools/direct.ts`).
- **`code`** runs inline code in a sandbox subprocess; **`client`** is browser-fulfilled
  across a turn boundary (`request_connection` is the one instance,
  `sdks/python/agenta/sdk/agents/platform/workflow.py:38-39`).

"Platform" is not a runner-visible kind. It is a config type (`{type:"platform", op}`)
that the SDK resolves into a callback spec with a direct `call`
(`sdks/python/agenta/sdk/agents/platform/platform_tools.py:72-82`).

### The platform-op pipeline, end to end

1. **Catalog** (`sdks/python/agenta/sdk/agents/platform/op_catalog.py:532-697`):
   `PLATFORM_OPS` holds 18 frozen `PlatformOp` entries. Each owns the model-facing
   description, method + relative path, input schema, `context_bindings`, `args_into`,
   and a `read_only` hint (`op_catalog.py:56-88`). `reserved_id` is
   `tools.agenta.<op>` (`op_catalog.py:121-124`).
2. **Resolve** (`platform_tools.py:36-90`): `AgentaPlatformToolResolver` emits one
   `CallbackToolSpec` per op with `call=op.to_call()` and a shared
   `ToolCallback(endpoint=f"{api_base}/tools/call", authorization=...)`. Note: even
   direct-call ops carry the `/tools/call` endpoint; the runner uses it as the ORIGIN
   ANCHOR, not as the target.
3. **Dispatch** (`services/runner/src/tools/relay.ts:271-280`): when `spec.call` is set,
   the runner assembles the body, validates the URL, and calls the endpoint directly.
4. **Body assembly** (`direct.ts:205-239`): model args land at `args_into` (or the root),
   static `call.body` overlays them, and `call.context` bindings fill LAST. Each
   `"$ctx.<path>"` token resolves against the run's `runContext` blob; an unresolvable
   binding throws (`direct.ts:229-236`). This is the **self-targeting guarantee**: the
   model never sees or wins a bound field.
5. **SSRF guard** (`direct.ts:259-325`): method allowlist (GET/POST/DELETE), single
   absolute path, origin host-locked to the run's own callback endpoint, and the resolved
   path **confined to the callback's mount** (the callback path minus `/tools/call`, i.e.
   `/api` on cloud). `direct.ts:310-323` is why a platform op cannot reach
   `/services/agent/v0/invoke`: that path is outside the `/api` mount.
6. **The call** (`direct.ts:337-389`): one round-trip with the caller's credential, body
   returned verbatim, under `TOOL_CALL_TIMEOUT_MS` (default **30s**,
   `callback.ts:15-17`). The Daytona/local relay loop that carries the whole exchange has
   its own `RELAY_TIMEOUT_MS` (default **60s**, `relay.ts:42-44`). Any long-running tool
   must fit under both, or thread new timeout plumbing.

### Run context

`RunContext` (`protocol.ts:174-185`) carries `workflow.{artifact,variant,revision}` refs,
`workflow.is_draft`, and `trace.{trace_id,span_id}`. The service computes it per turn
(`services/oss/src/agent/tracing.py:164-171`), and it rides the `/run` request
(`protocol.ts:472`). It is consumed ONLY by `call.context` bindings today. Gateway
(`callRef`) dispatch passes the model's args verbatim with no context injection
(`relay.ts:283-289`).

### The `/tools/call` plane already runs composite server-side logic

Two precedents matter for the tool-home question:

- **Reserved ops**: `_call_agenta_tool` (`api/oss/src/apis/fastapi/tools/router.py:1141-1207`)
  dispatches `tools.agenta.*` call_refs server-side. v1 op: `find_capabilities` (pinned to
  `FIND_CAPABILITIES_OP` at `api/oss/src/core/tools/discovery.py:45`). This is the legacy
  path the platform-op catalog migrated off, "retained during migration"
  (`docs/design/agent-workflows/interfaces/README.md:51`).
- **Workflow tools**: a `workflow.*` call_ref makes `/tools/call` resolve a revision and
  **invoke a whole workflow run** server-side
  (`tools/router.py:1240-1330`, calling `workflows_service.invoke_workflow` at line 1299).
  So the tool-call plane is already, by design, a place where one tool call fans out into
  a real run. The resource API stayed atomic; the tool surface composed.

### How the server invokes the agent service (for `test_run`)

`WorkflowsService._prepare_invoke` (`api/oss/src/core/workflows/service.py:2040-2071`)
centralizes auth and resolution: it signs an internal `Secret` token itself
(`sign_secret_token`, lines 2054-2062), resolves references to a runnable revision
(`_ensure_request_revision`), and derives the service URL. `invoke_workflow` (line 2073)
POSTs `{service_url}/invoke` batch; `invoke_workflow_detached` (line 2115) streams and
returns on the started handshake. Two facts fall out:

- The server already holds a first-party, credential-clean way to run an agent headless.
  No Agenta-internal credential ever enters the user connections system; the service
  signs its own token per call.
- The batch invoke returns only final outputs. The ordered tool list needs either the
  streamed events (what the lab's `test-agent.sh` parses) or a spans query afterward
  (what `check-tools.sh` does against `POST /api/spans/query`; the route is
  `api/oss/src/apis/fastapi/tracing/router.py:97-98`). Spans are the ground truth either
  way, and they flush a second or two late (the lab script retries).

## Part 2: rename + cut surface inventory

### Rename: `find_capabilities` -> `discover_tools`, `find_triggers` -> `discover_triggers`

The op key is also the model-visible tool name and derives the reserved id
(`tools.agenta.<op>`), so one key rename moves all three names at once. Surfaces:

**SDK (source of truth)**

- `sdks/python/agenta/sdk/agents/platform/op_catalog.py` - the two `PlatformOp` entries
  (lines 535-542, 575-581), the `_FIND_CAPABILITIES_*` constants (188-216), the
  `_FIND_TRIGGERS_*` constants (374-401), and description text that says
  "returned by find_triggers" inside `_CREATE_SUBSCRIPTION_INPUT_SCHEMA` (474) and
  `_TEST_SUBSCRIPTION_INPUT_SCHEMA` (505).
- `sdks/python/agenta/sdk/agents/tools/models.py:220` - docstring example
  (`op ... e.g. 'find_capabilities'`).
- `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py` - skill bodies name
  `find_capabilities` (lines 123, 150-254) and `find_triggers` (line 290). The
  [skills port](skills-port.md) replaces these bodies wholesale, so the rename rides that
  change.

**SDK tests**

- `sdks/python/oss/tests/pytest/unit/agents/platform/test_op_catalog.py` - key list
  (39-53), reserved-id assertion (61-63), error-message assertion (143), direct-call
  tests (146-186), method/path table (263-283), duplicate test (345-353).
- `sdks/python/oss/tests/pytest/unit/agents/tools/test_parsing.py:194-196`,
  `test_models.py:61-63`, `test_resolver.py:269-281` (uses a fake catalog path
  `/api/find_capabilities`), `test_skill_template_catalog.py:171`.

**API**

- `api/oss/src/core/tools/discovery.py:45` - `FIND_CAPABILITIES_OP = "find_capabilities"`
  plus `parse_find_capabilities_arguments` (line 78) and comment text (3, 34, 125).
- `api/oss/src/apis/fastapi/tools/router.py:1141-1207` - the legacy `tools.agenta.*`
  `/tools/call` dispatch pins the old key (`op != FIND_CAPABILITIES_OP` -> 404). Decide:
  rename the constant, or **delete the legacy route** in the same PR (recommended; the
  platform tool emits a direct `call` now, and pre-production means nothing depends on
  the old call_ref). Deleting also removes `parse_find_capabilities_arguments`'s only
  router caller.
- Comment/docstring text only (no behavior): `core/tools/dtos.py:229-325`,
  `core/tools/service.py:54,471`, `apis/fastapi/tools/models.py:135`,
  `core/triggers/dtos.py:104`.

**API tests**

- `api/oss/tests/pytest/unit/applications/test_build_kit_overlay.py:188`
  (`tool.op == "find_capabilities"`), plus the overlay-equality tests (see cut below).
- `api/oss/tests/pytest/unit/tools/test_discovery.py`,
  `api/oss/tests/pytest/unit/triggers/test_triggers_discovery.py` (mentions; verify
  whether they assert the op key or just the endpoint behavior).

**Frontend**

- `web/packages/agenta-playground/tests/unit/agentRequest.test.ts:224-360` - op literals
  in unit tests only. No production FE code references the op keys (verified by grep over
  `web/` excluding node_modules/dist). The FE renders overlay tools generically.
- Generated clients (`web/packages/agenta-api-client/src/generated/api/types/CapabilitiesResult.ts:6`,
  `clients/python/agenta_client/types/capabilities_result.py:14`) mention
  `find_capabilities` only in a docstring on the `/api/tools/discover` response type. The
  endpoint does not change, so regeneration is cosmetic. Update the source docstring in
  `core/tools/dtos.py:325` and regenerate, or leave until the next codegen sweep.

**Docs**

- `docs/design/agent-workflows/documentation/tools.md` - lines 38, 393-436 (the op table
  at 405-406 and the whole "Tool discovery: `find_capabilities`" section at 416), 508-514.
- `docs/design/agent-workflows/interfaces/cross-service/runner-to-tool-callback.md:60-64`,
  `interfaces/in-service/tool-models-and-resolution.md:35,57,113-149`,
  `interfaces/public-edge/agent-config-schema.md:156`, `interfaces/README.md:51`.
- `documentation/triggers.md`, `agent-template.md`, `skills.md` carry no op names
  (verified by grep).

### Cut: shrinking the default overlay

The overlay injects **every** catalog op:
`api/oss/src/apis/fastapi/applications/overlay.py:82` iterates `PLATFORM_OPS`. The cut
therefore needs an explicit default-overlay list; keep/cut is an overlay decision, not a
catalog deletion (all 18 ops stay in `PLATFORM_OPS` for opt-in).

**Where the list lives.** Recommendation: an explicit `DEFAULT_BUILD_KIT_OPS` tuple in
`overlay.py`, validated against `PLATFORM_OPS` keys by the overlay unit test. Rationale
(design-interfaces lens): the catalog is the op REGISTRY (SDK-owned, "what exists"); the
overlay is a PRODUCT POLICY of the playground build kit (API-owned, "what a fresh builder
gets"). Different owners, different lifecycles, different files. It also keeps this
project's `op_catalog.py` edits down to the two key renames, which matters for the
approval-boundary coordination (see [plan.md](plan.md)).

**Surfaces**

- `api/oss/src/apis/fastapi/applications/overlay.py:80-84` - the tools list.
- `api/oss/tests/pytest/unit/applications/test_build_kit_overlay.py:41-42` - asserts the
  overlay equals ALL of `PLATFORM_OPS`; rewrite against the new explicit list. Lines
  133-143 assert the wire payload matches `build_agent_template_overlay()` byte for byte
  (follows automatically). Line 147-188 exercises overlay -> embed resolution.
- No FE surface: the FE deep-merges `additional_context.playground_build_kit.
  agent_template_overlay` generically (`web/packages/agenta-entities/src/workflow/api/api.ts`,
  `.../state/store.ts`); it holds no op list of its own.
- Docs: `documentation/tools.md` op table (405+) should gain a "default build kit"
  column or note; `documentation/agent-template.md` if it lists the overlay contents.

### Overlay scope (open decision 1) {#overlay-scope}

Static 12-13 vs a conditional event pack. Evidence:

- `build_agent_template_overlay()` takes **no arguments** (`overlay.py:64`) and is served
  on `GET /api/simple/applications/{id}`. It has no view of the user's ask. A conditional
  event pack needs new machinery: a request signal (FE-driven), a second-stage "load the
  event pack" tool, or runtime injection. None exists today.
- The lab's capstone finding: extra visible tools derail runs, so smaller is itself the
  reliability fix (tools-review part 2, "Recommended inside set").
- The event pack is 5 tools (`discover_triggers`, `create_subscription`,
  `list_deliveries`, `test_subscription`, `remove_subscription`). 8 core + 5 event = 13,
  already close to the lab's proven working set.

**Recommendation: static 13 now.** The conditional pack buys ~5 tools of context but
costs a new mechanism and a new failure mode (the pack not loading when the ask turns out
to be event-driven). Ship static, measure, and revisit conditionality only if the
13-tool set still wanders. Defer the mechanism question to a follow-up note in
open-issues if Mahmoud agrees.

## Part 3: gotchas found during research

1. **Three of the four authoring skills are never delivered.** The overlay embeds only
   the getting-started skill (`overlay.py:69-78`; asserted by
   `test_build_kit_overlay.py:47-57`). `AGENTA_FORCED_SKILLS` also holds only
   getting-started (`agenta_builtins.py:320`). The other three
   (`__ag__build_your_first_app`, `__ag__discover_and_wire_tools`,
   `__ag__set_up_triggers`) are registered in the static catalog
   (`api/oss/src/core/workflows/static_catalog.py:133-156`) but NOTHING embeds them: grep
   over `api/`, `web/`, and the SDK finds no other reference to their slugs or names. So
   the playground builder likely never had the flow map or the discovery loop in front of
   it. This may explain part of the observed wandering, and it changes the skills-port
   framing: we are not just rewriting four skills into one, we are attaching a playbook
   that was probably never attached. **Verify live before relying on this** (one
   playground run, check the resolved skills), then record it as a
   builder-agent-reliability finding.
2. **The discover skill's availability note is stale.** The `discover-and-wire-tools`
   body says (dated 2026-06-27) that `find_capabilities` is not yet callable as a tool
   and tells the model to use `POST /tools/discover` or the `/tools/call` workaround
   (`agenta_builtins.py:161-165`). The platform tool has shipped since. If the skill were
   delivered, this text would actively misdirect the model. Dies with the skills port.
3. **Two timeout ceilings sit under any sync `test_run`.** `TOOL_CALL_TIMEOUT_MS`
   defaults to 30s (`callback.ts:15-17`) and `RELAY_TIMEOUT_MS` to 60s
   (`relay.ts:42-44`). Lab runs finished "well under a minute", which is inside the relay
   ceiling but over the tool-call default. A sync `test_run` needs per-op timeout
   plumbing (a catalog `timeout_ms` threaded onto the spec and honored by both layers),
   whatever home it gets. Detailed in [api-design.md](api-design.md).
4. **Renaming the op key renames the reserved id for free, but the legacy route pins the
   old key.** `reserved_id` derives from `op` (`op_catalog.py:121-124`), while
   `_call_agenta_tool` hard-codes `FIND_CAPABILITIES_OP` (`tools/router.py:1152-1155`).
   Recommend deleting the legacy reserved dispatch in the same PR (see inventory above).
5. **`args_into` interacts with a rename only in text.** No `args_into` or binding path
   mentions the discovery ops; the renames touch names and docs, not body assembly.
6. **`list_subscriptions` fold-in is not free.** `list_deliveries` wraps
   `GET /api/triggers/deliveries` and `list_subscriptions` wraps
   `GET /api/triggers/subscriptions/` (`op_catalog.py:615-630`). "Folding" means either
   keeping two catalog entries and cutting one from the overlay (cheap, recommended) or a
   new combined read endpoint (out of scope; the API stays atomic). Recommendation: cut
   `list_subscriptions` from the overlay, keep the op in the catalog. The event pack's
   verify read is `list_deliveries`; `remove_subscription` takes an id that
   `create_subscription`'s response already returns.
7. **The overlay excludes itself on commit.** The build kit rides only playground runs
   and is excluded when the agent commits (builder-agent-reliability context, "The
   build-kit overlay"). This is the natural first recursion guard for `test_run`: the
   committed config a test run executes does not carry platform tools unless the author
   added them deliberately. [api-design.md](api-design.md) adds a belt-and-braces guard.
8. **Coordination is not optional on `op_catalog.py`.** The approval-boundary lane is
   implementing today against the same file (permission model: per-tool
   `allow | ask | deny`, `needs_approval` deleted, `read_only` consulted by an
   `allow_reads` policy mode; see `projects/approval-boundary/status.md` and
   `plan.md:28-49`). Every op entry's `read_only` field sits inside their blast radius.
   This project must not touch approval fields at all, and must sequence its
   `op_catalog.py` edits after their lane lands or with the owner's ack, via
   `docs/design/agent-workflows/scratch/agent-coordination.md`.
