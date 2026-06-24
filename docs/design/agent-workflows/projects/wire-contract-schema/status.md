# Status: wire-contract-schema

| | |
| --- | --- |
| **Phase** | Plan written + Codex-reviewed (corrections folded in). Awaiting human review. No code. |
| **Owner** | wire-contract-schema (this session is A2 in the A1/A2/A3/A10 cohort) |
| **Lane** | dedicated GitButler lane `feat/agent-wire-contract-schema-plan`, single commit (docs only) |
| **Created** | 2026-06-24 |

## What exists

- `README.md` — the full plan: current-state assessment, the three source-of-truth options with
  the Option B recommendation, the `/run` split decision, the A10 structured-error + cancelled
  change, the A1 in-band contract-version coordination, a 9-step test-at-each-step migration, and a
  Review section (§11) recording the Codex pass.

## Decisions made in the plan

1. **Schema source = dedicated Pydantic *wire* models (Option B), NOT the semantic DTOs.** Codex's
   sharpest catch: the real contract lives in the hand serializers (`wire.py`, `*.to_wire`), and
   the `dtos.py` classes are snake_case with a loose `AgentEvent` — exporting them would give the
   wrong schema. So author `WireRunRequest` / `WireRunResult` / a discriminated `WireAgentEvent`
   with camelCase aliases, export JSON Schema via `model_json_schema()`, validate in the runner
   with ajv (one dep, no build step). JSON-Schema-as-source (A) and a shared IDL (C) both pull
   codegen toolchains into a repo that has none and a package that forbids a build step.
2. **TS types are best generated from the schema (b2).** A top-level key guard misses *nullability*
   drift (`sessionId`/`trace` are `null` on the wire, `?:` in `protocol.ts`). Generate `protocol.ts`
   as a committed artifact, or add nullability-deep type tests. Open question for review.
3. **`/run` stays unified for the turn.** One-shot vs streaming is content negotiation (`Accept`),
   not two endpoints — they share the request/result shapes. Promoted instead: a `GET /capabilities`
   probe (static **base** per-harness capabilities, no run) and consuming the contract version on
   **both** transports. Rejected: a `/cancel` endpoint.
4. **Error model `{ code, message, retryable }`** with an expanded taxonomy (incl. `auth_error` /
   `quota_exceeded` / `rate_limited` / `permission_denied`, which `errors.ts` already classifies)
   and a cancelled outcome that is modeled correctly: terminal record for **cooperative** cancel,
   a Python `CancelledError` for **transport-teardown** cancel (a disconnect cannot receive a
   terminal record).
5. **Behavior-preserving first.** Steps 1-6 introduce the schema, artifact, validation, and
   boundary guard at contract **v1**. A10 + A3 are the **single** v2 cut (step 8), not two "v2"
   steps. The version probe (7) and capability probe (9) are additive.

## Codex review (2026-06-24)

gpt-5.5, xhigh, read-only. Verdict: "Option B is the right direction, but the plan was too
optimistic as written." Six corrections folded in: wire-models-not-DTOs, nullability drift,
two-breaking-changes-one-cut, step-5 error-shape ordering, both-transport version probe,
cooperative-vs-teardown cancellation. Plus taxonomy expansion and base-vs-effective capabilities.
Full critique in README §11. Log at `/tmp/codex-out-wire-schema.log` (transient).

## Coordination

- **A1 (`contract-versioning`)** — sibling at `../contract-versioning/`; it found the same
  unconsumed-`/health.protocol` gap. A1 owns version-number semantics + bump policy; this project
  provides the in-band `contractVersion` field and the both-transport probe (step 7).
- **A3 (backend removal + harness rename)** — assumed end state; schema drops `backend` and renames
  the `harness` enum to `pi_core | pi_agenta | claude` as part of the v2 cut (step 8). Steps 1-6
  are at v1, so the schema work does not block on A3.
- **A10 (error model)** — folded into step 8.
- **`sidecar-trust-and-sandbox-enforcement`** flagged a stale comment at `protocol.ts:149-150`
  (sandbox enforcement is now real on Daytona). Noted; the v2 `SandboxPermission` schema work
  should pick up the corrected wording.
- **DOCS-ONLY.** No edit to `protocol.ts` / `wire.py` / golden / contract tests. Composio, the tool
  gateway, connections, and MCP are described as existing and **unchanged**.

## Next actions (after review)

- Get sign-off on README §10 open questions (wire-model placement, b1-vs-b2 TS types,
  `additionalProperties`, cancelled modeling, version-cut grouping, `contractVersion` granularity,
  capability probe shape).
- Confirm the v2-cut grouping (A10 + A3 together vs A3 as v3) with A1/A3 owners.
- Then implement step 1 (dedicated wire models with round-trip parity tests against the goldens).

## Open questions (see README §10 for full text)

1. Wire-model placement: `agents/wire_models.py` (proposed) vs a contract package.
2. TS types: generated from schema (b2, proposed) vs hand-written + deep guard (b1).
3. `additionalProperties`: permissive top-level + strict nested (proposed).
4. Cancelled modeling: cooperative terminal record + teardown `CancelledError` (proposed).
5. Version-cut grouping: A10 + A3 one v2 (proposed) vs A3 as v3 — A1's call.
6. `contractVersion` granularity + subprocess probe shape — A1's call.
7. Capability probe: all harnesses + base capabilities (proposed).
