# Contract versioning for the agent-workflows feature

A proposal for putting a single, explicit version on the cross-service contract between the
Python agent service and the Node runner sidecar, and reading it. The center of gravity is
the `/run` spine between those two, because they deploy independently and their contract
today carries no version that anything checks.

This is a proposal, not an implementation. It changes no code and no contract. Where it
names Composio, the tool gateway, connections, or MCP, it describes them only as things that
exist; this work leaves them unchanged.

We are **preproduction**: there is no deployed fleet to keep compatible and no back-compat
burden. The point of versioning here is to fail loudly on a skewed deploy during development,
not to migrate a live install base. That framing keeps the whole design small.

Graduated from the interface inventory at `../../interfaces/`, which maps every boundary in
the feature and is the source of truth for the contract shapes referenced here.

## The shape in one paragraph

The public edge versions itself: `/messages` stamps `x-ag-messages-version: v1` on every
response. The cross-service spine does not. The runner already exports a `protocol: 1` field
on `GET /health` and `version.ts` even documents it as "the version-skew guard," but nothing
reads it: the Python client (`ts_runner.py`) POSTs straight to `/run` and never probes
`/health`. So the guard is documented intent with no consumer. Meanwhile both sides ignore
unknown fields silently (Python via `data.get(...)`, the runner via a raw
`JSON.parse(...) as AgentRunRequest` cast with no validation), which makes additive changes
safe but makes a new *semantic* field a silent no-op on an old peer. The recommendation is
deliberately small: carry one **string** version on the `/run` payload, read the runner's
`protocol` off `/health` before the first run, and dispatch behavior with a plain `if/elif`
on the version string — exactly the way the LLM-as-a-judge evaluator already does it. No new
adapter machinery, no version negotiation protocol.

## Problem

The agent-workflows feature is a distributed system whose parts ship on different cadences:

- The Python agent service (`services/oss/src/agent/` + `sdks/python/agenta/sdk/agents/`)
  ships with the API / SDK release.
- The Node runner sidecar (`services/agent/`) is a standalone pnpm package with its own
  lockfile and Docker image, deployed as a sidecar that can lag or lead the service.
- The sandbox-agent harness layer is a **pinned npm dependency** of the runner
  (`sandbox-agent@0.4.2` in `services/agent/package.json`), so the harness contract version
  is baked into whichever runner image is deployed.

Because these deploy independently, a field can change on one side and reach an older version
on the other. Today the spine between them has no version anyone checks. A future change such
as a new agent config shape can reach a skewed peer and fail in a way that is hard to
attribute, instead of being rejected cleanly with a "your runner is too old" message.

A sibling effort (A2, `wire-contract-schema`) is designing a schema-driven `/run` contract to
replace the hand-mirror between `protocol.ts` and `wire.py`. A schema source of truth is the
natural place to carry the version string this proposal adds.

## Current-state matrix

Every cross-service, cross-process, or external contract in the feature, and whether it
carries any version or skew check today. (P) = process boundary, (X) = external boundary,
(E) = public edge.

| Contract | Boundary | Version today | Notes |
|---|---|---|---|
| `/run` request + result | service -> runner (P) | **None on the payload.** Runner advertises `protocol: 1` on `/health` but no field on `/run` itself. `ts_runner.py` never reads `/health`. | The spine. `protocol.ts` hand-mirrored by `wire.py`, pinned by golden fixtures. Unknown fields ignored silently on both sides. |
| `/run` streaming (NDJSON `{kind:"event"\|"result"}`) | service -> runner (P) | None (shares the `/run` contract). | The stream record envelope (`kind`) rides the already-unversioned `/run`. |
| `GET /health` runner identity | service <- runner (P) | **Carries `protocol: 1`, `runner` build version, `engines`, `harnesses`.** Advertised but **unconsumed**. | The only place a version lives on the spine. `version.ts` calls it "the version-skew guard"; there is no guard. This is the seam to build on. |
| `harness` selection | inside `/run` (P) | Versionless enum. Closed `HarnessType` enum in Python; **free `string` on the TS wire** (`harness?: string`). | The harness values are now `pi_core` / `pi_agenta` / `claude` (see below). |
| `POST /tools/call` (gateway callback) | runner -> Agenta (P/X) | None. | The tool gateway and Composio are UNCHANGED by this work; listed only to show the boundary is unversioned. |
| `POST /tools/resolve` | service -> Agenta tool resolution (P) | None. | UNCHANGED by this work. |
| Runner-owned MCP stdio bridge | runner -> harness (P) | **Yes, external standard:** MCP `protocolVersion`, defaults `"2025-06-18"`. | The one boundary that already does it right, because it follows the MCP spec. UNCHANGED by this work. |
| OTLP trace export (`/api/otlp/v1/traces`) | runner -> Agenta (X) | **Yes, external standard:** OTLP proto; endpoint path carries `v1`. | Standards-versioned. Trace pipeline UNCHANGED by this work. |
| Vault / connection / secret resolution | service -> Agenta (P) | None. | UNCHANGED by this work. |
| `/invoke` (batch) | client -> service (E) | Generic `WorkflowInvokeRequest` envelope; `/inspect` carries a dated `"version": "2025.07.14"`. | Public edge; shared across all workflow types. |
| `/inspect` (interface description) | client -> service (E) | Dated envelope `version` + `x-ag-type-ref` schema markers (`agent_config`, `messages`). | The agent config schema lives behind `x-ag-type-ref: "agent_config"`. |
| `/messages` (chat stream) | client -> service (E) | **Yes:** `x-ag-messages-version: v1` on responses; `VERCEL_MESSAGE_PROTOCOL_VERSION = "v1"`. | The model to copy: an explicit, named, header-carried version. |
| pinned `sandbox-agent@0.4.2` npm dep | runner -> harness lib (build-time) | **Yes, semver, but baked into the image.** | The runner image *is* the version. `/health` could expose it; today it exposes nothing about it. |

### Where versioning is missing, ranked by blast radius

1. **The `/run` payload has no version field.** This is the spine. A skewed deploy (new
   service + old runner, or the reverse) has no clean failure mode.
2. **`/health`'s `protocol: 1` has no consumer.** The skew guard exists on paper. Wiring a
   reader is the single highest-leverage, lowest-risk fix.
3. **The runner cannot tell the service what it can do.** `/health` lists `engines` and
   `harnesses` but the service ignores them, so it cannot decline to send a harness id a
   runner does not advertise.
4. **Stream record envelope, tool-callback envelope, and resolution shapes are unversioned**,
   but they are lower risk: callback/resolve are request-scoped within one logical release
   path, and the stream envelope rides `/run`.

### Preproduction: the harness rename is not a versioning event

The harnesses were renamed `pi` -> `pi_core` and `agenta` -> `pi_agenta` (the values now live
in `HarnessType` at `sdks/python/agenta/sdk/agents/dtos.py`). Because we are preproduction,
that rename just changed; it does **not** get its own version, downcaster, or compatibility
window. The same holds for the rename of the `pi` / `agenta` in-process artifacts. We version
the *contract shape*, not every naming change made before there is anything deployed.

## Recommendation

Three small parts, each shippable on its own.

### 1. One version string on the `/run` payload, named the way the repo already names versions

Add a `version` string to the `/run` request and result. Use the convention already in the
codebase — **do not invent a new field name or scheme.** Two existing conventions apply:

- **A plain version string in the payload, matching the evaluator convention.** Built-in
  evaluators store their interface version as a plain string in their parameters
  (`"version": "5"` for the LLM-as-a-judge evaluator, `"3"` for code eval — see
  `api/oss/src/resources/evaluators/evaluators.py`). The `/run` payload should carry the same
  kind of field: a plain `version` string the service stamps and the runner reads.
- **A versioned slug for the contract identity, matching the workflow-URI convention.** Every
  built-in workflow interface is identified by a colon-delimited slug whose final segment is
  the version: `agenta:builtin:agent:v0`, `agenta:builtin:llm:v0`, etc.
  (`sdks/python/agenta/sdk/engines/running/interfaces.py`). The `/run` contract is itself an
  interface, so its natural identity is a slug of the same shape — e.g.
  `agenta:runner:run:v0` — with the trailing `v0` bumped to `v1` when the shape breaks.

Concretely: the payload carries a `version` string (`"v0"`), and `/health`'s existing
`protocol` integer is the same number surfaced for the cheap liveness probe. The version is
part of the schema, so it lives wherever A2's schema source of truth ends up. We never use a
`contractVersion`-style field — we reuse the field name and the `v<N>` spelling the repo
already uses.

### 2. Make the runner expose a versioned harness slug, following the workflow-URI convention

The harness id on the wire is a free string today (`harness?: string`). When the harness
naming carries a version, give it the same colon-delimited, `v<N>`-suffixed shape the workflow
interfaces use:

- The dominant slug convention in the repo is `agenta:<namespace>:<name>:v0`
  (`agenta:builtin:agent:v0` in `interfaces.py`; lowercase `v`, colon delimiter, version as
  the final segment). Mirror it for a versioned harness identity rather than inventing a
  parallel format.
- The harness *values* themselves (`pi_core`, `pi_agenta`, `claude`) stay as they are; this is
  about giving the harness contract a versioned identity if and when its shape changes, using
  the existing slug grammar — not about renaming the harnesses again.

`/health` already returns `harnesses`. The service should read that list and decline a harness
the runner does not advertise, with a clear error, instead of forwarding an unknown value into
the sandbox-agent SDK where it fails opaquely.

### 3. Read the version and dispatch with a plain if/elif, like the evaluator does

This is the whole "evolution" story, and it is intentionally not a framework. The codebase
already evolves a contract by reading a version string and branching on it. The canonical
example is the LLM-as-a-judge evaluator handler
(`sdks/python/agenta/sdk/engines/running/handlers.py`, `auto_ai_critique_v0`):

```python
template_version = str(parameters.get("version") or "3")

# Per-version default. Existing versions are unchanged: v2 -> fstring,
# v3/v4 -> curly. v5 introduces mustache as the default ...
if template_version == "2":
    default_format = "fstring"
elif template_version == "5":
    default_format = "mustache"
else:
    default_format = "curly"
```

It reads the stored string, branches with `if/elif/else`, and keeps a comment explaining what
each version does. The code evaluator does the same
(`version if declared_version in ("2", "3") else "2"`, then `templates.get("v2" if version ==
"3" else "v1")`).

The `/run` contract should evolve the same way:

- The service reads the runner's `protocol` off `/health` once per runner endpoint and the
  `version` echoed on results. If the runner's major is older than the minimum the service
  understands, the run is **rejected with an explicit skew error** ("agent runner protocol vN
  is older than what this service supports; upgrade the runner") before any work starts. That
  is the guard `version.ts` already describes; this gives it a consumer.
- Where a shape actually differs between versions, the producer/consumer **branches on the
  version string** at the one place that cares, exactly like the evaluator handler — not
  through a layer of upcaster/downcaster functions. A new optional field is read when present
  and defaulted when absent; a renamed value is mapped in the branch. There is no separate
  adapter module, no version-keyed translation chain, and no per-version golden directory.

Why this is enough: preproduction means we do not need to interoperate a `v0` service with a
`v1` runner across a long deprecation window. We need a clear, attributable failure on skew,
plus the ability to keep a couple of older code paths alive behind an `if/elif` while the two
sides catch up in the same dev cycle. The evaluator already proves this pattern carries
several live versions (`v2`..`v5`) with nothing more than a string and a branch.

### Why this approach over the alternatives

- **Versioned URL paths (`/v2/run`).** Heavier: forks routing, multiplies handlers. A payload
  version string plus an `if/elif` is lighter and composes with A2's single schema.
- **A `contractVersion` `{major, minor}` struct with upcasting/downcasting adapters.**
  Rejected: it invents a field name and a translation framework the repo does not use, and it
  buys cross-version interoperability we do not need preproduction. The evaluator's plain
  string + branch is the convention; mirror it.
- **Do nothing and rely on additive-only changes.** This is the status quo. It works until
  the first non-additive change, and the silent-ignore behavior actively hides the break.
- **Strict validation that rejects unknown fields.** That belongs to A2's schema work, not
  here. A version string plus the `/health` read is the cheap, high-value slice.

## Compatibility with the sibling efforts (A2, A3)

- **A2 (`wire-contract-schema`, schema source of truth).** This proposal puts the `version`
  string *in the schema*, so A2 owns where it lives and this work owns that it is read and
  branched on. If A2 splits `/run` into multiple endpoints, the same `version` string + the
  `/health` read + an `if/elif` apply per resulting contract.
- **A3 (backend removal + `pi` -> `pi_core`, `agenta` -> `pi_agenta`).** Preproduction, so the
  rename is not a versioned change — it simply landed (the values are already in
  `HarnessType`). Removing the legacy in-process backend removes an *engine*, not a contract
  version; `/health`'s `engines` list already advertises which engines a runner has.

## Open questions

- **Who owns the version string after A2?** Today `PROTOCOL_VERSION` lives in `version.ts` and
  is mirrored by intent in `wire.py`. With a schema source of truth, generate it from the
  schema so the two sides cannot drift. Confirm with A2.
- **Slug spelling for the contract identity.** `agenta:runner:run:v0` mirrors
  `agenta:builtin:agent:v0`. Confirm the namespace segment (`runner`) with A2 when the schema
  lands.
- **Floor enforcement location: service-side, runner-side, or both?** Service-side reject on
  the `/health` read is the cheapest and catches the common "old runner" case before any run.
  A runner-side check on the inbound `version` would also catch "old service." Service-side
  first is the minimum.
- **Should `/health` advertise the baked `sandbox-agent` version?** Low cost (one more field on
  an existing endpoint); it would make "this runner's sandbox-agent is too old" diagnosable.
  Out of scope to decide here, flagged for A2/A3.
