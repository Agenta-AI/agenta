# Run context propagation — boundaries, options, tradeoffs

Date: 2026-06-27
Status: Codex-reviewed. Revised recommendation: **Option C** (run-level context channel +
server-side injection of protected fields). One decision left for Mahmoud (A vs C). See the
bottom.

## Problem

Some tools need the run's own context:

- `update_own_workflow` needs the running agent's variant — and the business state around it:
  the current revision, whether it is a **draft**, and if so the **latest revision** and the
  **variant name**, because an "update" appends a new revision to the last variant.
- `add_trace_annotation` needs the **current trace_id** (and span).
- Both (and others) may want the **session_id**.

The service already has all of this from the inbound request and `RunningContext.revision` — no
API calls needed. The question is not "how does the service get it" but **how it reaches the
tool, and where the boundaries sit**. The tools take `trace_id` / `workflow_variant_id` as
inputs; we just need to deliver the current run context to the place that fills them.

## System boundaries (who does what)

This is the part that matters most. Keep responsibilities clean:

- **Service** (`services/oss/src/agent/`): owns business context. It computes the run-context
  blob (it has revision, draft-state, latest variant/revision, variant name, session_id, trace).
  It resolves tools. It hands **both** the resolved tools and the run context to the sidecar on
  `/run`. All business logic lives here.
- **Sidecar / runner** (`services/agent/`): generic. It materializes tools from config and
  dispatches calls. It **holds** the run-context blob but does **not** compute or interpret it.
  Its behavior reduces to a small set of canonical primitives (below).
- **SDK local backend** (future: claude / pi / codex in a folder): plays **both** roles in one
  process — computes the run context (it has `RunningContext`) and materializes/dispatches in a
  working folder. Same boundaries, collapsed. The design must not assume a separate sidecar.
- **API endpoints**: consume the context (trace_id to link an annotation, variant_id to commit a
  revision) and enforce permissions on the caller credential.

## The canonical sidecar primitives (the generality that matters)

The sidecar's tool behavior should reduce to a **small, canonical set** of executors, so any
backend is built by generating config that maps onto them — not by adding bespoke logic per
backend. Today's set:

1. **Callback** (`ToolCallback`): the call is POSTed back to Agenta — gateway via `/tools/call`,
   or direct via `call.path`. The canonical "call back to the platform" primitive.
2. **Code**: run code in the sandbox subprocess.
3. **Client**: browser-fulfilled across a turn boundary.
4. **MCP-delivered**: tools surfaced through an MCP server (stdio/http) the sidecar wires up.

Run context forces a choice that is really about this set: **add one new canonical primitive (a
"static" tool that returns embedded data), or extend the callback primitive with a
context-injection step.** That choice, not the field list, is the real design decision, because
the localBackend reuses whichever primitives exist.

## The run-context payload (what the service computes)

```
RunContext {
  session_id: str
  trace: { trace_id, span_id }
  workflow: {
    artifact_id, variant_id, variant_name,
    revision_id, version,
    is_draft: bool,
    latest_revision_id            // the revision an "update" would append onto
  }
}
```

`project_id` / `user_id` are not included — they ride the caller credential.

## Options

### Option A — `get_run_context` as a static-output tool (a new canonical primitive)

The service computes the run context and embeds it in a `get_run_context` tool **definition**
(a new tool type whose `output` is a pre-built JSON). The sidecar materializes a tool that just
returns that JSON. The model calls `get_run_context`, reads `trace_id` / `variant_id`, and passes
them as inputs to `update_own_workflow` / `add_trace_annotation`.

- **Boundaries:** clean. Service computes + embeds; sidecar returns-constant; model forwards;
  endpoint consumes + permission-checks.
- **Generality:** adds exactly one new canonical primitive (static-return), simple and reusable.
  Strong localBackend fit — the SDK materializes the same static tool in a folder.
- **Security:** the model holds the context and re-supplies it as args, so it **could** pass a
  different trace_id / variant_id. Mitigation: endpoints must enforce ownership/scoping on the
  **caller credential**, not trust the arg (e.g. "you may only commit to variants you own").
- **Cost:** one extra model round-trip (read context, then call the edit tool); the model sees
  its own context (transparent, sometimes useful).

### Option B — the runner injects context into the call body (extend the callback primitive)

The service passes the run context as a `runContext` field on `/run`. Each direct tool's `call`
gains a `context` map (`{ body-path -> run-context-key }`). The runner deep-sets those at
dispatch from `runContext`. The model never sees or sets them.

- **Boundaries:** service computes; runner injects; endpoint consumes.
- **Generality:** no new primitive, but the callback primitive grows an injection step every
  backend must implement.
- **Security:** strong — injected values override model args, so the model cannot spoof its trace
  or variant.
- **Cost:** no extra round-trip; but the model cannot reference context it cannot see (fine for
  the default-current case, limiting if a tool wants the model to choose).

### Option C — hybrid

Static `get_run_context` so the model **can** read context when it needs to reason, **plus**
injection (Option B) for the security-sensitive defaults (own-variant, current-trace). Best
coverage, most machinery.

### Option D — standard propagation (traceparent header + baggage)

The runner propagates `traceparent` (+ baggage) on outbound calls; endpoints derive trace/session
server-side. Idiomatic for trace, but endpoint-specific and does **not** cover identity
(variant/draft-state), so it is at best a complement, not a full answer.

## Tradeoff summary

| | Boundaries | New sidecar primitive | Spoof-resistance | Extra round-trip | localBackend fit |
|---|---|---|---|---|---|
| A static tool | cleanest | +1 (static) | weak (mitigate at endpoint) | yes | strong |
| B inject | clean | none (callback grows) | strong | no | medium |
| C hybrid | clean | +1 | strong | optional | strong |
| D propagate | trace-only | none | n/a | no | partial |

## Recommendation (revised after the Codex review)

Lead with **Option C / B: run context is a run-level channel, and protected fields are bound
server-side, not model-owned.** Codex pushed back hard on Option A as the lead, and the argument
holds:

- **A is a boundary category-error.** A static-return tool is a "what the model can see" channel,
  not a tool-execution primitive. Run context belongs to the **`run` contract** — a run-level
  `runContext` payload on `/run` (trace, workflow lineage, session_id) — not to tool behavior.
  Modeling it as a tool drifts the boundary.
- **Generality actually favors B/C, not A.** B/C add NO new canonical primitive: run context is a
  run-level field plus an injection step inside the existing callback primitive. A would add a
  whole new "static" primitive. So the "small canonical set" goal is *better* served by B/C — the
  opposite of the original lean.
- **Security:** with A, identity/trace become model-supplied args (spoofable). An endpoint check
  is necessary but not sufficient (see the security section below).

So: put `runContext` on the run request; the runner (or the SDK local backend) binds the
protected fields (`trace_id`, `variant_id`, `latest_revision_id`) into the call server-side; the
model cannot override them. Keep a `get_run_context` static disclosure ONLY if the product needs
the model to *reason about* its context, and only for non-authority fields (`is_draft`,
`variant_name`) — never as the trust anchor for a commit or annotation.

**The decision for Mahmoud:** you leaned A (static tool) for boundary cleanliness; Codex and I
land on **C** (run-level channel + injection) as both cleaner and safer. Confirm C, or say why A.

## localBackend angle

For a localBackend (claude / pi / codex running in a folder, with MCPs we generate), the run
context must be produced by the in-process SDK and exposed through the **same** primitive as the
sidecar uses — a static tool (Option A) or an injected callback (Option B). Whichever we pick
becomes a primitive the localBackend materializer reuses verbatim, which is exactly why the
"small canonical set" constraint drives the choice.

## Security and guardrails (from the Codex review)

These apply regardless of which option we pick, and several are net-new findings:

- **Confused-deputy on the variant.** If the model can name `workflow_variant_id`, the commit
  endpoint must verify it is the run-owned target. Today workflow-commit is gated by a
  request-level permission (`EDIT_WORKFLOWS`), which does NOT encode "owned-variant" semantics. So
  `update_own_workflow` must bind the owning variant server-side (run context), and/or the
  endpoint must enforce ownership — not just the generic permission.
- **Replay/race on `latest_revision_id`.** A model-supplied "latest revision" is staleness-prone.
  The commit endpoint needs an expected-revision precondition (optimistic-lock / CAS), not a blind
  append.
- **Trace integrity.** Model-supplied trace IDs must be ignored/overridden by the server's run
  context, or a model can redirect annotations onto another trace.
- **`add_trace_annotation` has no backend today.** `/api/annotations/` currently always mints a
  NEW trace link (`uuid4`) and does not consume a supplied trace id
  (`api/oss/src/core/annotations/service.py`). So attaching to the *active* trace is a real
  endpoint to build, not just a tool to wire.
- **The `call` descriptor is an untrusted HTTP dispatcher.** Treat it as a transport guardrail:
  enforce a method allowlist (`GET`/`POST`), a relative-path regex, an `/api/...` prefix check,
  and origin binding to the single trusted Agenta host (already derived from
  `toolCallback.endpoint`). This is now also noted in `design.md`.

## Codex verdict (xhigh, gpt-5.3-codex-spark)

- **Verdict:** do not ship Option A alone; recommended posture is **Option C** (bind
  security-sensitive fields server-side; optional read-only visibility). The boundary direction
  (service resolves + supplies the call; sidecar executes) is right.
- **Architecture:** boundaries mostly correct; the `call` descriptor is the right seam if
  implemented as untrusted-input parsing with strict validation. Direct-call support needs
  synchronized changes in BOTH the direct and the relayed (Daytona) paths. Removing the
  `workflow.*` parse from `/tools/call` must be a deliberate migration, not a silent change.
- **Priorities:** (1) endpoint-side hardening for sensitive ops (bind run-owned ids; revision
  precondition) — required regardless of option; (2) a run-level context channel for protected
  injection; (3) a concrete `add_trace_annotation` backend that attaches to the active trace;
  (4) a strict `call` parser/validator with malformed-input tests; (5) `get_run_context` only as
  read-only metadata if the product needs model visibility.
