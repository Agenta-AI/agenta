# Where do logic-bearing internal tools live?

Status: proposal, 2026-07-03; revised 2026-07-04 after Mahmoud's review round 1. This is
the heart of the project. Round-1 outcomes folded in below: the meaning of "gateway" is
corrected (plus a rename proposal), Option B is rejected, and a concrete field-level
comparison of the two survivors (A' vs C) is added.

The question, restated: `test_run` (and future internal tools whose job needs
composition: invoke, wait, read spans, digest) does not fit the platform-op descriptor,
which wraps exactly one existing endpoint. The review's first answer was "add a composite
`/api` endpoint and wrap it thinly." Mahmoud rejected that framing: `test_run` is a
**tool**; the resource API should not go non-atomic to satisfy the current plumbing. So
where does the tool's logic run?

Evidence for every claim below is in [research.md](research.md) part 1. The constraints
any answer must respect:

- **Self-targeting**: the agent tests only itself. Today this is the `$ctx` binding the
  runner fills last and the model never sees (`direct.ts:205-239`).
- **Credential separation**: Agenta-internal auth never enters the user connections
  system. The precedent is `_prepare_invoke` signing its own `Secret` token per call
  (`workflows/service.py:2054-2062`).
- **Approval semantics untouched**: the relay's gate (`relay.ts:225-248`) and the
  permission model belong to the approval-boundary lane. Whatever home we pick must slot
  into that gate as one more tool, with zero changes to how gating works.

## The key observation

The platform already has TWO execution planes, and they have different atomicity rules:

- The **resource API** (`/api/workflows/...`, `/api/triggers/...`): nouns, atomic,
  Mahmoud's constraint holds here.
- The **tool-call plane** (`/tools/call` plus the direct-call dispatch): an RPC surface
  whose whole job is "execute one tool call". It is already composite: a `workflow.*`
  call_ref resolves a revision and runs an entire agent workflow server-side inside one
  tool call (`tools/router.py:1240-1330`). Nobody considers that endpoint "non-atomic
  API"; it is the tool executor doing tool-executor work.

So "no composite endpoint" and "the logic runs server-side" are not in conflict. The
composite logic can live behind the tool plane, in Python, without adding a verb to the
resource API.

## What "gateway" means (corrected, review round 1)

The first draft read "gateway" as "an external provider action executed through the
connections system". Mahmoud corrected that: **gateway means the tool call runs through
the Agenta gateway.** It is a server-executed tool call that needs the Agenta API to run.
External integrations (Composio) are one kind; Agenta-implemented actions were always
meant to be another. So Option A is not a semantics hack; it is the intended use of the
plane. The trade-off analysis below is rewritten on that definition.

### Rename proposal (Mahmoud asked for one)

"Gateway" names the pipe, not the role. The design-interfaces rule is to name a field by
what it IS: here, a tool call that executes server-side on Agenta. Candidates:

| Candidate | Reading | Verdict |
|---|---|---|
| `server` | the call executes server-side on Agenta | **Recommended.** It names the execution locus, and it mirrors the existing `client` (browser-fulfilled) value, so the executor vocabulary reads as a set of places: `client` / `code` (sandbox) / `server`. Boring and predictable, which is the goal. |
| `hosted` | Agenta hosts the execution | Workable, but it does not say hosted by whom, and it drifts toward marketing vocabulary. |
| `platform_run` | run by the Agenta platform | Accurate but collides with `type:"platform"`, which already names the catalog-wrapper CONFIG kind (`models.py:228-243`). One word across two axes invites exactly the confusion this rename should end. |

Scope of the rename, if approved: the executor-axis vocabulary in docs, comments, and
gate labels renames cheaply. The persisted config literal (`type:"gateway"`,
`GatewayToolConfig` at `models.py:105-117`) is a data migration; this project's stance is
hard-migrate-no-aliases anyway, so fold it into the same sweep as the op renames or
explicitly defer it. Either way, the wire field `callRef` keeps its name: it is an opaque
routing reference, not an axis label.

## Option A: an Agenta action on the gateway plane (`type:"gateway"`, provider `agenta`)

**What it is.** Ship `test_run` as a server-executed tool on the existing `/tools/call`
plane (a reserved `tools.agenta.test_run` call_ref, like the v1 `find_capabilities`
dispatch at `tools/router.py:1141-1207`), and teach the relay to inject run context into
`callRef` dispatch the way it already does for `call` dispatch. In config terms, per
Mahmoud's framing: a tool of type `gateway` with an `agenta` provider. Call this **A'**.

**Can the relay inject context into gateway calls?** Yes, cheaply. The machinery exists:
`resolveCtxToken` and the merge helpers live in `direct.ts:129-147` and are already
imported by `relay.ts`. Today the `callRef` branch passes `req.args` verbatim
(`relay.ts:283-289`). The change: allow a resolved spec to carry `context` bindings next
to `callRef` (the wire type change is small; `protocol.ts:122-127` currently documents
`context` under `call` only), and have `executeAllowedRelayedTool` fill the bound arg
fields from `runContext` before `callAgentaTool`. Fail hard on an unresolvable binding,
exactly like `assembleBody` does.

**Self-targeting.** Equivalent to today's guarantee: the runner overwrites the bound
fields last, the model-visible schema strips them (`op_catalog.py:126-143` already does
this for any `context_bindings`). A caller who bypasses the runner and hits `/tools/call`
directly holds a project credential and can already commit/schedule anything in the
project through the resource API, so nothing weakens.

**Trade-offs (rewritten on the corrected gateway definition).**

- (+) Smallest possible runtime footprint: one relay branch tweak, one server-side
  handler. No new endpoint on the resource API.
- (+) Credential-clean: `/tools/call` runs under the caller's project auth; the internal
  invoke signs its own token server-side.
- (+) Semantically sanctioned: under the corrected definition, an Agenta-implemented
  action is a first-class resident of the gateway plane, not a smuggle.
- (-) **The config shape does not fit.** `GatewayToolConfig` is provider-shaped: it
  requires `integration` and `connection` and builds a five-segment reference grammar
  (`models.py:105-117`); an internal op has neither an integration nor a connection, so
  the arm needs field-level surgery (see the A' column in the concrete comparison below).
- (-) **The metadata needs a registry anyway.** A gateway tool gets its description,
  input schema, and hints from the provider's catalog at resolve time. An internal op has
  no provider catalog; the registry that owns exactly this metadata for Agenta ops is
  `PLATFORM_OPS`. A' therefore imports or duplicates the platform catalog it tried to
  bypass.

## Option B: runner-side composite ops (REJECTED)

**Verdict: rejected by Mahmoud, review round 1 (2026-07-04).** No business logic in the
runner; the runner should just run the agents. That matches this doc's original
recommendation, so B is closed, not merely disfavored. The section stays for the record.

**What it is.** The runner learns multi-step ops: on `test_run`, the runner itself
invokes the agent, polls the trace, digests, and returns the verdict. Every API endpoint
stays atomic; the composition lives in TypeScript.

**Trade-offs.**

- (+) Timeout control is natural: the runner owns the loop, can stream progress events,
  and is not squeezed by its own `TOOL_CALL_TIMEOUT_MS`.
- (+) No API surface change at all.
- (-) **The runner cannot reach the invoke surface.** Direct calls are host-locked and
  confined to the `/api` mount (`direct.ts:310-323`); the agent service lives at
  `/services/agent/v0/invoke`, outside it. There is no `/api`-side invoke route today
  (verified: `apis/fastapi/workflows/router.py` exposes none). Option B therefore forces
  either loosening the SSRF guard (bad) or adding an `/api` invoke endpoint, which is the
  composite-endpoint concession Option B exists to avoid.
- (-) **It breaks the runner's design role.** The runner is a dumb executor: "it
  dispatches any `call` opaquely, the runner needs no platform-specific code"
  (`documentation/tools.md:260`; the same stance runs through `dispatch.ts` and
  `relay.ts` comments). Test-run semantics (span queries, verdict rules, digest shape)
  are product logic. Putting them in the sidecar splits that logic across languages,
  couples every verdict tweak to a runner image release, and duplicates span-reading code
  Python already owns.
- (-) The composition would run with only the caller credential and the runner's limited
  view; the server-side path gets revision hydration, delta application, and internal
  token signing for free (`_prepare_invoke`).

## Option C: the platform catalog grows a `handler` mode

**What it is.** The same runtime mechanics as A', declared from the platform catalog
instead of the gateway config arm. Mahmoud's restatement is exactly right: the tool still
executes under the tool-call plane; what changes is the shape of the platform-op schema,
which now says where the logic lives (a server-side handler) instead of which REST
endpoint to wrap. The explicit contract for "an Agenta-internal tool whose logic runs
server-side with run context":

- **Catalog**: `PlatformOp` entries stay the single registry. An op either wraps one
  endpoint (today's `call` shape) or names a server-side handler (a new
  `handler: "test_run"` mode; exactly one of the two, mirroring the existing
  `input_schema` XOR `input_schema_ref` validator at `op_catalog.py:89-119`).
  `context_bindings`, schema stripping, `read_only`, and descriptions work identically
  for both modes, so self-targeting and approval inputs stay uniform.
- **Wire**: the resolved spec carries the reserved id as `callRef`
  (`tools.agenta.test_run`) plus `context` bindings. Kind stays `callback`; the executor
  axis does not grow a new value, because from the runner's seat this IS a callback: post
  the envelope, return the text. The only runner change is the generic context injection
  from Option A'. (Naming note: if the approval-boundary lane would rather see an explicit
  `executor: "server"` marker on the gate descriptor, that is their call; the gate
  already receives `executor: "relay"` today, `relay.ts:226`.)
- **Server**: a handler registry in the tools domain
  (`api/oss/src/apis/fastapi/tools/` + `core/tools/`), keyed by op, next to the existing
  `tools.agenta.*` dispatch. The `test_run` handler composes
  `retrieve_workflow_revision` -> apply delta -> `invoke_workflow` -> spans query ->
  digest, all in Python, reusing `_prepare_invoke`'s auth pattern.

**Trade-offs.**

- (+) Respects every constraint: resource API stays atomic (the logic sits behind the
  tool plane, where composition is already the norm, see the `workflow.*` precedent);
  self-targeting rides the same `$ctx` machinery; credentials follow the
  `sign_secret_token` pattern; approval sees one more spec with a `read_only=False` hint
  and nothing else.
- (+) One registry: the catalog that already owns internal-op metadata (description,
  schema, bindings, `read_only`) also declares the handler ops, and the authoring surface
  (`{"type": "platform", "op": ...}`) does not change. Future logic-bearing ops (a richer
  verify, a config linter) get a named home with zero new config shapes.
- (+) The runner change is generic and tiny (context injection on `callRef` specs), and
  it is useful beyond this project.
- (-) Touches the wire contract (spec-level `context` next to `callRef`), so the golden
  fixtures, `protocol.ts`, `wire.py`, and both contract tests move together (the
  runner CLAUDE.md change-both-sides rule).
- (-) One more mode inside `PlatformOp`. Mitigated by the existing XOR-validator pattern.
- (-) Sync execution still sits under the 30s/60s timeout ceilings; per-op
  `timeout_ms` plumbing is needed (see [api-design.md](api-design.md)). This cost is
  shared with Option A' and D; only B escaped it, at the costs above.

## Option D: the composite endpoint (kept for comparison)

**What it is.** The review's original sketch: `POST /api/workflows/test` in the workflows
domain, wrapped by a thin platform op (part 2 of the tools-review, "test_run endpoint
sketch").

**Trade-offs.**

- (+) Zero runner and zero wire changes: it is a pure data add to the catalog plus one
  endpoint. Fastest to ship.
- (+) The endpoint is independently curl-able, testable, and documented in OpenAPI.
- (-) **Rejected framing.** It puts a verb ("test") into the resource API to compensate
  for tool-plumbing limits. The workflows domain would own an endpoint whose semantics
  (invoke + wait + digest + verdict) are tool semantics, not resource semantics.
- (-) Grows the public API surface for something only the builder agent calls.

## A' vs C, concretely

Requested in review round 1: the interface changes and the logic changes for both
survivors, side by side. Both put the logic in the same place (a Python handler behind
the tool-call plane, reached by a reserved `callRef`, with run context injected by the
relay). Under the corrected gateway semantics they are the same runtime design. The whole
difference is which declaration surface says the tool exists: the gateway config arm (A')
or the platform catalog (C).

### (a) What the author's config carries

```jsonc
// A' — a new arm of the gateway config
{ "type": "gateway", "provider": "agenta", "action": "test_run" }
// (no integration, no connection — both are required fields today)

// C — the platform config, unchanged authoring surface
{ "type": "platform", "op": "test_run" }
```

### (b) The schema change, against the real dataclasses

**A' changes `GatewayToolConfig`** (`sdks/python/agenta/sdk/agents/tools/models.py:105-117`).
Today every field is provider-shaped and required:

```python
class GatewayToolConfig(ToolConfigBase):
    type: Literal["gateway"] = "gateway"
    provider: str = Field(default="composio", min_length=1)
    integration: str = Field(min_length=1)     # meaningless for an internal op
    action: str = Field(min_length=1)
    connection: str = Field(min_length=1)      # an internal op has no connection
    name: Optional[str] = ...

    @property
    def reference(self) -> str:                # five-segment grammar, assumes all four parts
        return f"tools.{provider}.{integration}.{action}.{connection}"
```

The A' surgery: make `integration` and `connection` optional with a validator ("required
unless `provider == 'agenta'`"), give `reference` a second grammar
(`tools.agenta.<action>`), and source the description, model-visible input schema,
context bindings, and `read_only` hint from somewhere. That last part is the real cost: a
Composio gateway tool gets its metadata from the provider's live catalog at resolve time;
an internal op has no provider catalog, and the registry that owns exactly this metadata
for Agenta ops is `PLATFORM_OPS`. A' ends up reading the platform catalog from the
gateway resolve path.

**C changes `PlatformOp`** (`sdks/python/agenta/sdk/agents/platform/op_catalog.py:56-119`):

```python
class PlatformOp(BaseModel):
    op: str
    description: str
    method: Optional[Literal["GET", "POST", "DELETE"]] = None  # was required
    path: Optional[str] = None                                 # was required
    handler: Optional[str] = None                              # NEW: server-side handler key
    input_schema / input_schema_ref: ...                       # unchanged XOR pair
    context_bindings: Dict[str, str] = ...                     # unchanged
    read_only: bool = ...                                      # unchanged
    # validator: exactly one of (method + path) or handler — mirrors the existing
    # input_schema XOR input_schema_ref check (op_catalog.py:89-95)
```

Plus one resolver branch: the platform branch of `resolver.py` today always emits a
direct `call` (`PlatformOp.to_call()`, `op_catalog.py:145-154`); a `handler` op instead
emits `call_ref = op.reserved_id` (the property already exists, `op_catalog.py:121-124`)
with spec-level `context`.

### (c) The wire spec the runner sees — identical in both

```jsonc
{ "name": "test_run", "kind": "callback",
  "callRef": "tools.agenta.test_run",
  "context": { "workflow_revision.workflow_variant_id": "$ctx.workflow.variant.id" },
  "inputSchema": { /* context-bound fields stripped */ },
  "readOnly": false }
```

One wire addition either way: `context` moves up to the spec level so it can ride next to
`callRef` (today it exists only inside `call`; `protocol.ts:121-127`,
`models.py:319-349`). The relay change is also identical: the gateway branch of
`executeAllowedRelayedTool` (`relay.ts:225-232`) deep-sets the resolved `$ctx` values
into `req.args` before `callAgentaTool`, reusing `resolveCtxToken` (`direct.ts:129-147`)
and failing hard on an unresolvable binding, exactly like `assembleBody`
(`direct.ts:226-237`).

### (d) Files that change

| Surface | A' | C |
|---|---|---|
| SDK config models (`tools/models.py`) | `GatewayToolConfig` field surgery, validator, second `reference` grammar | none |
| SDK catalog (`platform/op_catalog.py`) | still needed as the metadata registry for internal actions | `handler` mode + validator |
| SDK resolver (`tools/resolver.py`) | gateway branch learns `provider == "agenta"` (skip the provider resolve, read the catalog) | platform branch emits `call_ref` + `context` for handler ops |
| Wire (`protocol.ts`, `wire.py`, golden fixtures, both contract tests) | spec-level `context` | same change |
| Runner (`relay.ts`) | `$ctx` injection on the `callRef` branch | same change |
| API (`tools/router.py` + `core/tools/`) | reserved-prefix dispatch + the handler | same change |
| FE config editor | the gateway form must special-case the `agenta` provider (no integration or connection pickers) | none (a platform op's only author field is `op`) |

### (e) What stays identical either way

The Python `test_run` handler itself, the `$ctx` binding namespace and schema stripping,
the credential pattern (`sign_secret_token`, `workflows/service.py:2054-2062`), the
approval gate's view (one more callback spec with `readOnly` / `permission`), and the
model-visible request/response contract in [api-design.md](api-design.md).

### The choice, fairly

A' is the smaller conceptual step if you think of internal actions as "one more gateway
provider": no new catalog mode, and the `/tools/call` plane stays the single server-run
surface. Its costs are the config-shape surgery on an arm whose required fields exist
because external providers need them, the second `reference` grammar, the FE form
special-case, and a resolve path that reads the platform catalog from the gateway branch.

C is the smaller interface step: the authoring surface does not change, the metadata
stays in the registry that already owns it, and the new concept is one field ("this op's
target is a handler, not a path") guarded by the same XOR-validator pattern the class
already uses. Its cost is that `PlatformOp` now has two target modes.

Codex second opinion: see PR comment.

## Recommendation

**Option C.** Same wire, same server, same handler; the choice is only which config
surface declares the tool. A' spends its budget relaxing `GatewayToolConfig` and still
needs the platform catalog for the metadata; C adds one mode to that catalog and changes
nothing the author sees. Under the corrected gateway semantics both are legitimate
residents of the gateway plane; C simply declares residency from the registry that
already exists for Agenta-internal ops.

Why C over B: rejected in review round 1 (no business logic in the runner), and B was
independently blocked on hard facts (the SSRF mount confinement, no `/api` invoke route).

Why C over D: D changes the resource API's character to save one week of plumbing; C
keeps the API atomic and pays with a small, reusable wire addition.

Fallback if the wire change is unwelcome right now: ship **D's endpoint under the tools
mount instead of workflows** (`POST /api/tools/...` is still a tool-plane path), wrapped
as a plain platform op. That keeps the workflows API atomic and needs no wire change, at
the cost of a slightly odd endpoint. Noted only so the decision has a cheap escape hatch;
C remains the recommendation.

The `test_run` contract under C, and how it degrades under A'/B/D, is in
[api-design.md](api-design.md).
