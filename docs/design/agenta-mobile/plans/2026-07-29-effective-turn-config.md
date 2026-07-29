# Effective turn config on HITL resume — design & plan

**Status:** PLANNED · **Date:** 2026-07-29 · **Branch:** `feat/agenta-mobile-wave-1`
**Goal:** when an approval is answered from a client that cannot reproduce the turn's config
(mobile, the M2 detached dispatcher), the resumed run must continue under **the config the
gated turn was actually running**, not under whatever the referenced variant's HEAD revision
happens to say — most importantly for **tool permissions**, where the gap means the approval
UI enforced a policy the turn was not running under.

Everything in §1 was executed live against the EE dev stack (ephemeral accounts/projects,
harness in the scratchpad); log lines and DB rows are quoted verbatim.

---

## 1. Grounded findings

### 1.0 The shape of the gap (code)

- Hydration is decided **purely by what the caller sent**:
  `sdks/python/agenta/sdk/middlewares/running/resolver.py:594-596`

  ```python
  needs_reference_hydration = bool(
      request.references and not _caller_supplied_configuration(request)
  )
  ```

  with `_caller_supplied_configuration` (`resolver.py:549-564`) true iff `data.parameters` or
  `data.revision` is non-empty. So *any* inline `data.parameters` suppresses hydration; a
  references-only body always hydrates.

- Desktop always sends `data.parameters` inline (draft-aware) and **withholds the revision
  reference when dirty** — `web/packages/agenta-playground/src/state/execution/agentRequest.ts:353-372`:

  ```ts
  const isCommittedRevisionRun =
      !isDirty && typeof fullReferences?.application_revision?.id === "string"
  ```

- Mobile answers approvals with a **references-only** invoke —
  `web/packages/agenta-chat/src/transport/agentResumeRequest.ts:1-11` documents "the body carries
  NO `data.parameters`" as a load-bearing invariant. The M2 dispatcher does the same
  (`api/oss/src/tasks/asyncio/sessions/interactions_dispatcher.py:259-300`, builds
  `WorkflowServiceRequest(references=…, data=WorkflowServiceRequestData(inputs=…))`).

- The interaction row's `references` come from **the same builder** as the turn row's:
  `services/runner/src/sessions/interactions.ts:26-41` `buildWorkflowReferences(request.runContext?.workflow)`,
  called at `run-turn.ts:228` (turn row) and `run-turn.ts:464` (interaction row). `runContext.workflow`
  is derived from the tracing references in `sdks/python/agenta/sdk/agents/tracing.py:136-166`.
  `is_draft` **is computed there** (`workflow.is_draft = revision is None`) but `buildWorkflowReferences`
  drops it — the durable row keeps no draft-ness marker.

- The effective `parameters` blob exists **only in the Python SDK process** — parked at
  `resolver.py:669` (`TracingContext.get().parameters`) and flattened into wire fields by
  `sdks/python/agenta/sdk/agents/utils/wire.py:128-160`. There is **no `parameters` field on the
  `/run` wire at all** (`grep -n parameters services/runner/src/protocol.ts` → nothing). The runner,
  which writes the interaction row, therefore cannot reach it today.

### 1.1 EXPERIMENT 1 — dirty-run reference shape (answered)

Harness: `scratchpad/effective_config_harness.py e1` + `scratchpad/e2_respond.py`. Ephemeral
project, agent revision committed with `anthropic/claude-haiku-4-5`; arm A = committed run
(references incl. revision, no inline parameters), arm B = the desktop's dirty shape (inline
draft `data.parameters` with `anthropic/claude-sonnet-4-5` + draft instructions, revision
reference withheld exactly as `agentRequest.ts` does).

**`session_turns.references` (arm A, committed):**

```json
[{"id":"019fac87-f619-…","slug":"harness-agent-0eb7e167e4"},
 {"id":"019fac87-f621-…","slug":"harness-agent-0eb7e167e4.default"},
 {"id":"019fac87-f63c-…","slug":"49f7faf7cf4b","version":"1"}]
```

**`session_turns.references` (arm B, dirty):**

```json
[{"id":"019fac87-f619-…","slug":"harness-agent-0eb7e167e4"},
 {"id":"019fac87-f621-…","slug":"harness-agent-0eb7e167e4.default"}]
```

**`session_interactions.data` for a real parked gate on a dirty run** (project
`019fac90-33c1-…`, token `8c07647e-…`), verbatim:

```json
{
  "request": { "args": { "command": "echo \"hello\" > notes.md" }, "tool": "Bash" },
  "references": {
    "workflow":        { "id": "019fac90-3438-…", "slug": "harness-agent-7e487deeaf" },
    "workflow_variant":{ "id": "019fac90-343f-…", "slug": "harness-agent-7e487deeaf.default" }
  }
}
```

> **Answer 1.** A dirty run's interaction row carries `workflow` + `workflow_variant` and **no
> `workflow_revision`**; a committed run's carries all three (with `version`). The row keeps no
> parameters and no draft flag. Mobile's actionable filter only requires `data.references` to be
> non-empty (`web/mobile/src/features/chat/useApprovalActions.ts:106-120`), so the dirty row
> **passes the filter and is resumed** — it is not detectably different to today's client.

**Why that is worse than "just the wrong revision":** a revision reference is **pinned**, a
variant-only reference resolves to **HEAD**. Measured on `POST /workflows/revisions/retrieve`
after committing a v2 over v1:

```
PINNED revision ref (v1)     -> v1 model=anthropic/claude-haiku-4-5 instr={'agents_md': 'V1 INSTRUCTIONS'}
VARIANT-only ref             -> v2 model=anthropic/claude-sonnet-4-5 instr={'agents_md': 'V2 INSTRUCTIONS'}
```

So a **committed** run's parked gate is already immune to later commits (the revision id pins
it). Only the **dirty** run is exposed, and it is exposed twice: the resume gets (a) not the
draft, and (b) whatever HEAD is at answer time.

### 1.2 EXPERIMENT 2 — what a warm resume actually executes with (answered)

Setup (`scratchpad/e2_respond.py`, cross-provider so the credential resolution is observable):
committed revision = `openai/gpt-4o-mini` with **no OpenAI secret in the project**; inline draft =
`anthropic/claude-sonnet-4-5` with an Anthropic secret. Turn 1 runs dirty and parks a Bash gate;
the gate is then answered through `POST /sessions/interactions/{id}/respond` (the M2 dispatcher,
references-only).

Runner (`agenta-ee-dev-runner-1`), session `48268312-…`, verbatim:

```
[keepalive] miss key=019fac94-…:48268312-…; cold
[sandbox-agent] resolved model=anthropic/claude-sonnet-4-5 provider=anthropic deployment=direct connection=<none> secretKeys=[ANTHROPIC_API_KEY]
[sandbox-agent] [HITL] pi-gate id=61707b08-… {"gate":"pi-builtin","toolCallId":"toolu_01XHeuqPtdscoHcGSxo9vbdL","toolName":"Bash","executor":"harness","readOnlyHint":false}
[sandbox-agent] [HITL] gate toolName="Bash" permission=ask outcome=pendingApproval
[keepalive] park key=019fac94-…:48268312-… ttl=1800000ms state=awaiting_approval poolSize=1
[keepalive] resume key=019fac94-…:48268312-… gates=1 answered=1 carried=0 approve=1 reject=0 tool=Bash
[sandbox-agent] [HITL] resume state: decisions=["Bash#{\"command\":\"echo \\\"hello\\\" > notes.md\"}"]
[sandbox-agent] [HITL] pi-gate id=a879c4ec-… {"gate":"pi-builtin","toolCallId":"toolu_01WwK99fUUEUAEAyXhpPW87h","toolName":"Bash",…}
[keepalive] park key=019fac94-…:48268312-… ttl=1800000ms state=awaiting_approval (re-park) poolSize=1
```

Services (`agenta-ee-dev-services-1`), same second as the resume, verbatim:

```
2026-07-29T06:34:40.842Z [WARN.] agent: no connection resolved for provider 'openai' (mode=agenta);
running with no injected credential (harness login / self-managed) [agenta.sdk.agents.handler]
```

> **Answer 2a (mismatch confirmed).** The resume is **warm** (`resume key=…`, no `cold`, no new
> `resolved model=` line): the parked sandbox keeps the model and secrets baked at acquire time —
> `anthropic/claude-sonnet-4-5` + `ANTHROPIC_API_KEY`. Meanwhile the SDK, hydrating the *committed*
> revision from the references-only resume, resolved **provider `openai`** and produced an empty
> credential set. **Sandbox model X (`sonnet`, Anthropic) vs the resume's resolved credential for
> provider Y (`openai`, none).** The run continued regardless and parked a second gate.

Second arm, same shape but committed `runner.permissions.default = "deny"` vs draft
`"allow_reads"` (project `019fac91-9e0f-…`, session `14c72363-…`), verbatim:

```
[sandbox-agent] [HITL] gate toolName="Bash" permission=ask outcome=pendingApproval      <- turn 1, DRAFT policy
[keepalive] resume key=019fac91-…:14c72363-… gates=1 answered=1 carried=0 approve=1 reject=0 tool=Bash
[sandbox-agent] [HITL] resume state: decisions=["Bash#{\"command\":\"echo \\\"hello\\\" > notes.md\"}"]
[sandbox-agent] [HITL] gate toolName="Bash" permission=deny outcome=deny                <- resume, COMMITTED policy
```

> **Answer 2b (the security-relevant half).** The **permission map is re-read from the incoming
> request on every turn** (`services/runner/src/engines/sandbox_agent/run-turn.ts:428`
> `permissionsFromRequest(request)`), so on a resume it is the **committed** policy, while model,
> system prompt, MCP servers, tool specs and injected secrets stay at their **acquire-time (draft)**
> values (`environment.ts:596-603, 879-895, 1025`). The resumed turn is a genuine split brain:
> draft engine, committed policy. The `awaiting_approval` branch **deliberately skips** the
> config-fingerprint and credential-epoch checks that the idle-continuation branch enforces
> (`server.ts:678-739` vs `server.ts:594-621`), so nothing detects the divergence.

> **Answer 2c (cold replay).** When the parked sandbox is gone (TTL 30 min, evicted, or the
> resume trips `approval-mismatch (history)` — observed verbatim as
> `[keepalive] approval-mismatch (history) key=…; evict + cold`), the run cold-starts from
> `buildRunPlan(request)`, i.e. **entirely from the hydrated committed config**. In the
> cross-provider arm the cold resume resolved `provider 'openai'` with no credential. So cold is
> not "less wrong", it is *differently* wrong: 100% committed config replaying a draft transcript.

**Not answered experimentally (stated, not guessed):** whether a *Claude*-harness resume also
diverges in its in-sandbox `.claude/settings.json` (rendered from `harnessFiles` at acquire —
`run-plan.ts:159-165`). Code says yes; the dev stack's local Claude harness needs a mounted
subscription, so it was not exercised. Treat as an additional, un-measured divergence surface.

### 1.3 Config blob size and sensitivity (measured)

Over all `workflow_revisions` in the dev DB with a non-empty `data.parameters` (n = 326):
`avg 761 B`, `p90 1 365 B`, `max 20 410 B`. The large ones are entirely
**tool JSON-Schema** — e.g. one 14 KB `parameters.agent` = 11 gateway tool specs plus a 345-byte
`instructions`, with `llm: {"model":"opus","provider":"anthropic"}`. Connections are stored as
**references** (`{"mode":"agenta"}` / `{"mode":"agenta","slug":…}`), never raw keys; secrets are
resolved per-request from the project vault (`sdks/python/agenta/sdk/agents/platform/connections.py`),
so a `parameters` blob carries **no credentials today**.

### 1.4 Storage facts that constrain the options

| Store | Column | Type | Migration needed to add config? |
|---|---|---|---|
| `agenta_ee_core.session_interactions` | `data` | **`json`** (schemaless) | **No** — but `SessionInteractionData` is a closed Pydantic model with default `extra="ignore"` (`api/oss/src/core/sessions/interactions/dtos.py:24-28`), so an unknown key is **silently dropped** on both write and read. A DTO field is required. |
| `agenta_ee_core.session_turns` | — | no data/params column | **Yes** — a real Alembic migration. |
| `agenta_ee_tracing.records` | `attributes` | `jsonb`, **GIN-indexed** (`ix_records_payload_gin`) | No — `record_type` is free-form. But every stamped blob enters the GIN index. |

The EE dev stack shares one Postgres volume across worktrees, so a `session_turns` migration is
a **shared-state change**: it lands for every worktree at once and must be forward-only.

---

## 2. Options

### A. Stamp the effective config on the interaction row (at gate creation)

The runner adds `parameters` to the `data` it already POSTs at
`services/runner/src/engines/sandbox_agent/run-turn.ts:456-478`; mobile and the dispatcher resume
with those parameters **inline**, which suppresses hydration entirely
(`resolver.py:594`) and reproduces the turn exactly.

The runner does not have the blob today (§1.0), so one of:

- **A1 (recommended).** SDK adds one opaque field to the `/run` wire
  (`sdks/python/agenta/sdk/agents/utils/wire.py:128-160`), runner types it in `protocol.ts` and
  echoes it into the interaction `data`. Runner stays dumb; the SDK — the only component that
  knows the effective config — stays authoritative.
- **A2 (rejected).** Runner posts the row without parameters; the SDK, which sees the
  `interaction_request` event stream, PATCHes the row afterwards. Two writes, a race against the
  client answering a fast gate, and a second failure mode on a row that must exist.

**Cost:** ~1 KB typical / 20 KB worst case per gated turn, in a schemaless `json` column with no
index. No migration. **Cold vs warm:** both fixed — inline parameters make the resume's
`configFingerprint` equal the parked session's *and* make a cold replay rebuild the same plan.
**Back-compat:** rows written before the change have no `data.parameters`; clients fall back to
today's references-only path (§3, T6/T7 pin this).
**New persistence:** for a *dirty* run this durably stores a config that exists nowhere else
today (draft instructions + tool schemas). That is the one honest privacy delta — see T8.

### B. Per-turn config snapshot (every turn, not just gated ones)

Stamp the effective parameters for **every** turn so any client can reconstruct any turn.

- On `session_turns`: **needs a migration** (no column exists) — and on the shared EE dev volume.
- On the records log: **no migration** (new `record_type`, e.g. `config`), but every blob lands in
  the `ix_records_payload_gin` index, and records are the hot ingest path
  (`POST /sessions/records/ingest` → Redis stream → worker), so this is the write-amplifying option.
  At ~1 KB × every turn of every session it is a real, ongoing cost for a benefit only the
  approval path uses today.

Its two extra claims do not survive §1.1: a *committed* run's gate is already pinned by its
revision reference, so "someone commits a new revision while the session is parked" **only bites
dirty runs** — exactly what A already fixes. The genuinely new capability is "mobile sends a live
message on a session whose last turn was dirty", which is **not** in the current mobile scope
(mobile answers approvals; it does not compose fresh turns against a draft).

### C. Detect-and-surface only

No config plumbing. Mobile inspects `data.references`; if `workflow_revision` is absent, the row
is a dirty-run gate → show "answer on desktop" instead of approve/deny.

Cheap and honest, and §1.1 proves it is **implementable today with zero backend change** (the
reference shape is already the discriminator). But it makes the most common developer flow — edit
config, run, walk away, approve from the phone — permanently unanswerable from mobile, and it does
nothing for the M2 dispatcher (a server-side path with no UI to defer to). It also silently
depends on `buildWorkflowReferences` never starting to emit a revision ref for draft runs.

### Recommendation — **A1, with C's detector as the fallback branch**

A1 is the only option that makes the resumed run *actually correct* rather than *refused*, it is
the smallest change that closes the tool-permission hole, it needs no migration, and its blob is
bounded and already-persisted-shaped. Ship C's discriminator too, but as the **fallback for legacy
rows** (`data.parameters` absent **and** `workflow_revision` absent → warn/defer), not as the
primary answer. Defer B until mobile composes fresh turns; when that day comes, B rides the
records log (no migration), not a `session_turns` column.

### Where the fix belongs

**The SDK owns the value; the runner owns the row; the API owns the replay.** The SDK is the only
component that has the hydrated `parameters` (§1.0), so it must emit it. The runner already writes
the row at exactly the right moment and must not learn what a config *means* — it echoes an opaque
blob. The API changes are two lines of DTO plus one line in the dispatcher. No new endpoint.

---

## 3. Task list

| # | Area | Task |
|---|---|---|
| T1 | SDK | `sdks/python/agenta/sdk/agents/utils/wire.py` — add an optional `effectiveParameters` to the `/run` payload, **emitted only when `session_id` is set** so non-session runs stay byte-identical to the golden wire contract. Source it from the handler's already-resolved `parameters` (`agents/handler.py:249-320`) or `TracingContext.get().parameters` (`resolver.py:669`). |
| T2 | SDK tests | Extend the golden wire fixtures (`sdks/python/oss/tests/pytest/unit/agents/golden`) with a session run that carries `effectiveParameters` **and** a non-session run that still does not. Add a unit test that the emitted blob equals the post-hydration `data.parameters` for both a references-only invoke and an inline-parameters invoke. |
| T3 | Runner | `services/runner/src/protocol.ts` — `effectiveParameters?: Record<string, unknown>` on `AgentRunRequest` (opaque; **not** part of `configFingerprint`, `session-identity.ts:145-176`, so it cannot itself trip an eviction). `run-turn.ts:456-478` `recordPendingInteraction` — include it as `parameters` in the interaction `data` alongside `request`/`references`. |
| T4 | Runner tests | New `services/runner/tests/unit/interactions-parameters.test.ts`: (a) the POSTed body carries `data.parameters` when the request has `effectiveParameters`; (b) the key is **absent** (not `null`/`{}`) when it does not; (c) `configFingerprint` is unchanged by the new field. |
| T5 | API | `api/oss/src/core/sessions/interactions/dtos.py:24-28` — add `parameters: Optional[Dict[str, Any]] = None` to `SessionInteractionData` (required: the model defaults to `extra="ignore"`, so without this the runner's key is dropped on ingest **and** on read-back in `mappings.py`). **No migration** — `data` is a schemaless `json` column. |
| T6 | API | `api/oss/src/tasks/asyncio/sessions/interactions_dispatcher.py:259-300` — when `interaction.data.parameters` is present, set it on `WorkflowServiceRequestData(parameters=…)` (the field already exists: `sdks/python/agenta/sdk/models/workflows.py:226-238`); when absent, keep today's references-only body verbatim. |
| T7 | API tests | Extend `api/oss/tests/pytest/unit/sessions/test_interactions_dispatcher.py` with both branches (parameters present → inline + references still sent; absent → byte-identical to today), and add a round-trip test through create → fetch → query proving the DTO carries `parameters` (guards the `extra="ignore"` trap). |
| T8 | API / SDK | **Redaction + cap before stamping.** Audit `parameters.agent.mcps[]` and `tools[]` for any `headers`/`authorization`-shaped value (§1.3 found none in the dev corpus, but the schema permits `mcps` headers); strip them, and hard-cap the stamped blob (suggest 64 KB — 3× the measured max) with a log line on truncation rather than a silent drop. |
| T9 | Web (package) | `web/packages/agenta-chat/src/transport/agentResumeRequest.ts` — optional `parameters`; emit `data.parameters` **only when non-empty**. Update the module docstring: the invariant becomes "no `parameters` key unless we are deliberately replaying a stamped effective config". Update the existing invariant unit test to pin both directions. |
| T10 | Mobile | `web/mobile/src/features/chat/useApprovalActions.ts:101-120` — read `row.data.parameters` and pass it to `buildAgentResumeRequest`. Keep the existing references-only path when absent. Replace the current hard failure at :116-120 with the C-style fallback: no parameters **and** no `workflow_revision` → "this approval was made against unsaved config — answer on desktop". |
| T11 | Entities | `web/packages/agenta-entities/src/session/api/api.ts` — surface `data.parameters` on the interaction row type returned by `queryInteractions`/`fetchInteraction` (currently typed without it). |
| T12 | Harness | Extend `scratchpad/effective_config_harness.py` with an assertion arm: park a gate on a dirty run whose draft `runner.permissions.default` differs from the committed revision's, answer it, and assert the runner logs `permission=<draft value>` on the resumed gate (today it logs the committed value — see §1.2 Answer 2b). This is the regression the whole plan exists to prevent. |
| T13 | Docs | Note in `docs/design/agenta-mobile/plans/2026-07-27-mobile-approvals-steering.md` §1.3 that the interaction row now carries the effective config, and that a pre-change row is answerable but degrades to hydration. |

**Sequencing:** T1→T3→T5 must land together (the blob is dropped at any missing link) but can be
one stacked series: SDK lane → runner lane → API lane → web lane. T9-T11 are independent of the
backend lanes only in the sense that they no-op until the backend stamps; land them last.

**Explicit non-goals:** changing the `awaiting_approval` branch's deliberate skip of the
config-fingerprint check (`server.ts:682-695`) — with A1 the resume's fingerprint matches by
construction, so the skip stops mattering; and reconfiguring a warm sandbox mid-session, which is
out of scope for every option here.
