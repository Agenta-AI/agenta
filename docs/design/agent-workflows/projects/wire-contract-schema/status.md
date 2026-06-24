# Status: wire-contract-schema

| | |
| --- | --- |
| **Phase** | Plan written + Codex-reviewed, then **revised per the author's PR review on #4830** (2026-06-24). Awaiting re-review. No code. |
| **Owner** | wire-contract-schema (A2 in the A1/A2/A3/A10 cohort) |
| **Lane** | dedicated GitButler lane `feat/agent-wire-contract-schema-plan`, single commit (docs only) |
| **Created** | 2026-06-24 |
| **Revised** | 2026-06-24 (author PR review) |

## What exists

- `README.md` — the plan, revised to the author's POC framing: current-state assessment, the three
  source-of-truth options with the Option B recommendation (Pydantic-as-source **for now**, JSON
  interface **in the SDK**, a Fern investigation in §4.1), the `/run` split decision (keep unified,
  promote `/capabilities`), the A10 structured-error + cancelled change, A1 coordination on a
  **simple string version**, a 7-step POC-framed plan with the heavy items deferred, and a Review
  section (§11) recording both the Codex pass and the author's revision.

## Author PR review (2026-06-24) — what changed

Four inline comments on #4830, all addressed:

1. **No back-compat burden** (README ~§3.1). Dropped all "the schema must preserve the
   model/connection split / omit-when-empty bytes" framing. This is an internal POC; any wire shape
   may change freely. Shape notes are now described as "current serializer behavior, not a
   constraint." (README §Status, §1, §2, §3.1, §11.)
2. **Pydantic-as-source now + interface in the SDK + Fern** (README ~§4 recommendation). Revised the
   recommendation: Pydantic is the source for now; the immediate goal is that the exported JSON
   Schema interface lives **in the SDK** (the `CATALOG_TYPES` path); added §4.1 investigating Fern.
   Explicitly **dropped using the schema in the sidecar/runner** for now (contract still brittle).
3. **No runner ingress validation** (README ~§5). Rewrote §5 as "validation — deferred": no ajv, no
   runner dependency, no `server.ts`/`cli.ts` request validation. The schema is used in Python tests
   only (goldens-must-validate). A boundary guard is a deferred follow-up.
4. **Keep `/capabilities`** (README ~§6). The probe stays; the author endorsed it. Noted his
   endorsement inline.

## Fern findings (the §4.1 investigation)

- Fern in this repo generates the multi-language API **clients** (Python + TS) under `clients/` and
  `web/packages/agenta-api-client/`. The pipeline (`clients/scripts/generate.sh`) is
  **Pydantic → `/api/openapi.json` → Fern (`fernapi/fern-python-sdk`, `fernapi/fern-typescript-sdk`)
  → SDKs**. There is no checked-in `.fern/` IDL; Fern's only input is the generated OpenAPI doc.
- The SDK **already** exposes Pydantic-derived JSON interfaces: `CATALOG_TYPES` in
  `sdks/python/agenta/sdk/utils/types.py` (~line 1265) is a dict of `model_json_schema()` outputs,
  surfaced via `/inspect` `x-ag-type-ref` markers (`services/oss/src/agent/schemas.py`). The wire
  contract should ship the same way.
- **Can Fern see this interface? Yes — but only via OpenAPI, with a caveat.** `/run` is the
  service↔runner spine, not a public FastAPI endpoint, so it is not in `openapi.json` today and Fern
  cannot see it as-is. Making Fern see it = reference the wire Pydantic models from a FastAPI surface
  (FastAPI then emits them into `components/schemas`, the same path `AgentConfigSchema` takes). **No
  hard blocker** — the only reason not to now is that the contract is brittle and publishing a moving
  target into every generated client is premature. So: SDK-resident now, Fern later.

## Decisions made in the (revised) plan

1. **Schema source = dedicated Pydantic *wire* models (Option B), NOT the semantic DTOs**, authored
   against the **already-landed** renamed shape (`pi_core` / `pi_agenta`, no `backend`). Export
   `model_json_schema()` and ship it in the SDK alongside `CATALOG_TYPES`.
2. **`protocol.ts` stays hand-written for now.** No generated TS types this phase (only pays off once
   the runner consumes the schema). Python goldens are the guard.
3. **`/run` stays unified for the turn.** Promote a `GET /capabilities` probe (static **base**
   per-harness capabilities). Rejected: a `/cancel` endpoint.
4. **Error model `{ code, message, retryable }`** with a grounded taxonomy and a cancelled outcome
   (terminal record for cooperative cancel; Python `CancelledError` for transport-teardown cancel).
   Made as a **direct wire change, no version bump** (POC).
5. **No versioning machinery.** The pi/agenta rename is not versioned. Any version field defers to
   A1's **simple string version + if/else** (the `x-ag-messages-version: "v1"` / LLM-as-judge
   pattern) — no `{major, minor}`, no `contractVersion` name, no upcaster/downcaster.
6. **No runner/sidecar validation yet** (deferred follow-up).

## Deferred (Section 8 follow-ups, out of scope for this POC phase)

- Runner-side request validation (ajv / boundary guard).
- Generating `protocol.ts` from the schema.
- A version field + negotiation (A1-owned, simple string).
- Fern generating the interface across languages (via Pydantic → OpenAPI once stable).

## Coordination

- **A1 (`contract-versioning`)** — sibling at `../contract-versioning/`, being simplified by another
  agent to a plain string version + if/else per the author. This project reuses whatever string
  convention A1 lands on; does NOT invent its own. (Did not touch A1's README — another agent owns it.)
- **A3 (backend removal + harness rename)** — **already landed in the working tree** (`version.ts`
  has `pi_core`/`pi_agenta`, golden renamed `run_request.pi_core.json`, `engines/pi.ts` deleted). The
  wire models describe that shape from the start; the rename is not versioned (POC).
- **A10 (error model)** — folded into the plan (step 6) as a direct wire change.
- **`sidecar-trust-and-sandbox-enforcement`** flagged a stale `protocol.ts:149-150` comment; noted.
- **DOCS-ONLY.** No edit to `protocol.ts` / `wire.py` / golden / contract tests / `interfaces/*`.
  Composio, the tool gateway, connections, and MCP are described as existing and unchanged.

## Next actions (after review)

- Get sign-off on README §10 open questions (wire-model placement, where the SDK surfaces the export,
  cancelled modeling, capability probe shape, and the deferred follow-up list).
- Confirm with A1 the exact simple string version convention to carry (if any) on the payload.
- Then implement step 1 (dedicated wire models with round-trip parity tests against the goldens).
