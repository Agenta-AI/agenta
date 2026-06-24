# Contract versioning for the agent-workflows feature

A proposal for adding versioning, skew detection, and adapter-based evolution to the
cross-service and cross-process contracts in the agent-workflows stack. The center of
gravity is the `/run` spine between the Python agent service and the Node runner sidecar,
because those two deploy independently and their contract today carries no version.

This is a proposal, not an implementation. It changes no code and no contract. Where it
names Composio, the tool gateway, connections, or MCP, it describes them only as things that
exist; this work leaves them unchanged.

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
safe but makes a new *semantic* field a silent no-op on an old peer, and makes a new enum
value (the imminent `pi` -> `pi_core` harness rename) an opaque downstream failure rather
than a clean version error. The recommendation: turn the dormant `protocol` major into a
real, enforced two-number contract version with a min-supported floor, add a small capability
handshake off `/health`, and evolve the payload through **upcasting adapters keyed on the
declared version** so a newer service and an older runner still interoperate.

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
on the other. Today the spine between them has no version, no negotiation, and no skew check.
A future change such as a new agent config shape, a renamed harness id, or a split of `/run`
can reach a skewed peer and fail in a way that is hard to attribute, instead of being
rejected cleanly with a "your runner is too old" message.

Two near-term changes make this urgent:

- A sibling effort (A2, `wire-contract-schema`) is designing a schema-driven `/run` contract
  to replace the hand-mirror between `protocol.ts` and `wire.py`, and is evaluating splitting
  `/run`. A schema source of truth is the natural place to also carry a version field.
- Another sibling (A3) is removing the legacy in-process backend and renaming harnesses
  `pi` -> `pi_core` and `agenta` -> `pi_agenta`. That is precisely an **enum-value change on
  a versionless wire**: a new service that sends `harness: "pi_core"` to an old runner hits
  `run-plan.ts`'s pass-through (`acpAgent = harness === "agenta" ? "pi" : harness`), which
  forwards `"pi_core"` to a sandbox-agent SDK that does not know it. The failure is opaque.

## Current-state matrix

Every cross-service, cross-process, or external contract in the feature, and whether it
carries any version, negotiation, or capability handshake today. (P) = process boundary,
(X) = external boundary, (E) = public edge.

| Contract | Boundary | Version today | Negotiation / handshake | Notes |
|---|---|---|---|---|
| `/run` request + result | service -> runner (P) | **None on the payload.** Runner advertises `protocol: 1` on `/health` but no field on `/run` itself. | **None.** `ts_runner.py` never reads `/health`; it POSTs `/run` directly. | The spine. `protocol.ts` hand-mirrored by `wire.py`, pinned by golden fixtures. Unknown fields ignored silently on both sides. |
| `/run` streaming (NDJSON `{kind:"event"|"result"}`) | service -> runner (P) | None (shares the `/run` contract). | None. | Stream record envelope (`kind`) is itself an unversioned mini-contract. |
| `GET /health` runner identity | service <- runner (P) | **Carries `protocol: 1`, `runner` build version, `engines`, `harnesses`.** | Advertised but **unconsumed**. | The only place a version lives on the spine. `version.ts` calls it "the version-skew guard"; there is no guard. This is the seam to build on. |
| `harness` selection (`pi` / `claude` / `agenta`) | inside `/run` (P) | Versionless enum. Closed `HarnessType` enum in Python; **free `string` on the TS wire** (`harness?: string`). | None. Unknown value passes through `run-plan.ts` untouched. | A3's `pi_core` / `pi_agenta` rename changes these values. Highest skew risk. |
| `POST /tools/call` (gateway callback) | runner -> Agenta (P/X) | None. OpenAI-style function-call envelope. | None. | The tool gateway and Composio are UNCHANGED by this work; listed only to show the boundary is unversioned. |
| `POST /tools/resolve` | service -> Agenta tool resolution (P) | None. | None. | Tool resolution shape is unversioned; UNCHANGED by this work. |
| Runner-owned MCP stdio bridge (`initialize` / `tools/list` / `tools/call`) | runner -> harness (P) | **Yes, external standard:** MCP `protocolVersion`, defaults `"2025-06-18"`, echoes the client's requested version. | Yes, MCP's own `initialize` handshake. | This is the one boundary that already does it right, because it follows the MCP spec. MCP itself is UNCHANGED by this work. |
| User-declared MCP servers (in `mcpServers`) | service -> runner -> server (P/X) | None on our envelope; the server itself speaks MCP. | None on our side. | The `mcpServers` config shape rides `/run`, so it inherits the spine's lack of version. MCP UNCHANGED by this work. |
| OTLP trace export (`/api/otlp/v1/traces`) | runner -> Agenta (X) | **Yes, external standard:** OTLP proto via `@opentelemetry/exporter-trace-otlp-proto@0.54.0`; endpoint path carries `v1`. | OTLP content negotiation (external). | Standards-versioned; our own semantic-attribute names are the unversioned part. Trace pipeline UNCHANGED by this work. |
| Vault / connection / secret resolution (`GET /secrets/`, `POST /secrets/resolve`) | service -> Agenta (P) | None. | None. | Internal resolution; connections and the vault are UNCHANGED by this work. |
| `/invoke` (batch) | client -> service (E) | Generic `WorkflowInvokeRequest` envelope; `/inspect` response carries a dated `"version": "2025.07.14"`. | None for agents specifically. | Public edge; shared across all workflow types, so it changes conservatively. |
| `/inspect` (interface description) | client -> service (E) | Dated envelope `version` + `x-ag-type-ref` schema markers (`agent_config`, `messages`). | The form reads `meta.harness_capabilities` to pre-filter choices (a form-side capability read, not a wire handshake). | The agent config schema lives behind `x-ag-type-ref: "agent_config"`; a new config shape changes what this returns. |
| `/messages` (chat stream) | client -> service (E) | **Yes:** `x-ag-messages-format: vercel` + `x-ag-messages-version: v1` on responses; `VERCEL_MESSAGE_PROTOCOL_VERSION = "v1"`. | Transport negotiated from `Accept`. | The model to copy: an explicit, named, header-carried version on a contract that faces callers we do not control. |
| pinned `sandbox-agent@0.4.2` npm dep | runner -> harness lib (build-time) | **Yes, semver, but baked into the image.** | None at runtime. | The runner image *is* the version. The deployed runner's harness contract is whatever its image pinned; the service cannot tell which sandbox-agent a given runner shipped with, except via what `/health` chooses to expose (today: nothing about it). |

### Where versioning is missing, ranked by blast radius

1. **The `/run` payload has no version field and no negotiation.** This is the spine. A
   skewed deploy (new service + old runner, or the reverse) has no clean failure mode.
2. **`/health`'s `protocol: 1` has no consumer.** The skew guard exists on paper. Wiring a
   reader is the single highest-leverage, lowest-risk fix.
3. **`harness` is a free string on the TS wire with pass-through selection.** A3's rename is
   a versionless enum change. Without a guard it fails opaquely inside the sandbox-agent SDK.
4. **The runner cannot tell the service what it can do.** `/health` lists `engines` and
   `harnesses` but the service ignores them, so it cannot decline to send `pi_core` to a
   runner whose `harnesses` list lacks it.
5. **Stream record envelope, tool-callback envelope, and resolution shapes are unversioned**,
   but they are lower risk: callback/resolve are request-scoped within one logical release
   path, and the stream envelope rides the already-versioned `/run`.

### Where a future change breaks a skewed deploy

A new agent config shape is the canonical example. Trace it through:

- **New service, old runner.** The service serializes the new config field onto `/run`. The
  old runner's `JSON.parse(...) as AgentRunRequest` cast silently ignores the unknown field.
  The run proceeds **as if the field were never set** — a silent semantic regression, not an
  error. If the new field is a renamed harness value (`pi_core`), it is worse: the old runner
  forwards it to a sandbox-agent agent id it does not have, and the run fails deep in the SDK
  with a message that does not mention version skew.
- **Old service, new runner.** The new runner expects the new field. The old service never
  sends it, so the runner falls back to a default. Tolerable if the default is safe, a
  correctness bug if the new field changed a default's meaning. Nothing flags the mismatch.

Today both directions fail silently or opaquely. The goal is to make them fail loudly when
incompatible and **interoperate through an adapter when the gap is bridgeable**.

## Recommendation

A single approach with four parts. The parts are ordered so each is shippable on its own and
the early ones are cheap.

### 1. One contract version, two numbers, carried on the payload

Add a `contractVersion` to the `/run` request and result: a `{ major, minor }` pair (or the
string `"major.minor"`).

- **major** bumps only on a breaking change (a field removed, a field's meaning changed, a
  required new field, a renamed enum value that the runner must understand). This is the
  existing dormant `PROTOCOL_VERSION` promoted from `/health`-only to the payload.
- **minor** bumps on a backward-compatible addition (a new optional field, a new event kind,
  a new capability flag). A peer one minor behind can ignore the addition safely.

This maps onto the rule the inventory already states ("a field cannot move on one side
alone") and onto the existing semver intuition in `version.ts`. The version is part of the
schema, so it lives wherever A2's schema source of truth ends up.

### 2. A min-supported-version floor, enforced at the seam

Each side declares two numbers: the contract version it *speaks* and the **minimum major it
still accepts**. On the first contact:

- The service reads the runner's `protocol` (already on `/health`) and the runner's declared
  floor (a new `minProtocol` next to it).
- If the runner's major is below the service's floor, or the service's major is below the
  runner's floor, the run is **rejected with an explicit skew error** ("agent runner
  protocol vN is older than the minimum vM this service supports; upgrade the runner") before
  any work starts. This is the guard `version.ts` already describes; this proposal gives it a
  consumer.
- Inside the overlapping band (runner major >= floor, but older than the service's current
  major), the service does not reject; it **adapts** (part 4).

This is the cheapest high-value change: it converts today's silent/opaque failures into a
clear, attributable one, and it can ship before any adapter work.

### 3. A small capability handshake, reusing `/health`

`/health` already returns `engines` and `harnesses`. Make the service **read** them and
extend the record minimally:

- The service caches the runner's `/health` (protocol, floor, engines, harnesses, and
  optionally the baked `sandbox-agent` version) per runner endpoint, refreshed on a TTL or on
  a skew error.
- Before sending a run, the service checks the chosen `harness` against the runner's declared
  `harnesses`. If the runner does not advertise `pi_core`, the service either declines with a
  clear error or (during the rename window) downgrades the value through an adapter to the id
  the runner does know (`pi`). This is exactly how the `agenta` -> `pi` remap already works
  inside the runner; the handshake just lets the service do the equivalent when the runner is
  too old to do it itself.

Capability negotiation here is deliberately thin: a published list the service reads, not a
round-trip protocol. It piggybacks on an endpoint and fields that already exist.

### 4. Evolve through upcasting adapters keyed on the declared version

This is the part that delivers the user's stated goal: a new agent config shape that an older
runner and a newer service still interoperate on.

- The schema source of truth (A2) defines the contract at each major version.
- Between adjacent majors live **pure translation functions**: an *upcaster* `vN -> vN+1`
  and, where a newer producer must talk to an older consumer, a *downcaster* `vN+1 -> vN`.
  These are small, total functions with no I/O, easy to unit-test, and they live next to the
  schema, not scattered through the request builders.
- **At send time**, the service builds the request in its native (newest) version, then, if
  the target runner speaks an older major it still supports, runs the request through the
  downcaster chain down to the runner's version before serializing. A new config field that
  the old runner cannot honor is dropped or mapped to its closest old-version equivalent by
  the downcaster, *explicitly and visibly in one place*, instead of being silently ignored by
  a raw JSON cast.
- **At receive time** (for the result/stream), the newer side upcasts an older runner's
  result up to its native version, so the rest of the service only ever handles one shape.
- The runner does the symmetric thing for the request it receives if it is the newer peer.

The win over today's "ignore unknown fields" behavior is that the translation is **named,
located, tested, and version-keyed**. When `pi` becomes `pi_core`, the `v1 -> v2` upcaster
maps the value and the `v2 -> v1` downcaster maps it back, so a v2 service and a v1 runner
interoperate during the rename window without either one guessing.

### Why this approach over the alternatives

- **Versioned URL paths (`/v2/run`).** Heavier: forks routing, multiplies handlers, and does
  not by itself give adapters or a min-version floor. A payload version plus a floor is
  lighter and composes with A2's single schema.
- **Pure capability negotiation, no version number.** Capabilities answer "can you do X" but
  not "what shape is X." A renamed field or changed default is a shape change a capability
  flag does not capture. We want both: the version for shape, a thin capability read for
  routing (which harness, which engine).
- **Do nothing and rely on additive-only changes.** This is the status quo. It works until
  the first non-additive change, which A3's rename already is. The silent-ignore behavior
  actively hides the break.
- **Strict validation that rejects unknown fields.** Tempting (it would have surfaced the
  silent no-op), but it makes *every* additive change breaking and kills forward-compat. The
  adapter model keeps additive changes cheap while making breaking ones explicit.

## Migration plan

Sequenced so each step is independently shippable and the golden-fixture tests stay
meaningful throughout. This plan describes work; it does not perform it.

1. **Land the version field as additive (minor bump, no behavior change).** Add
   `contractVersion` to the `/run` request and result as an optional field defaulting to the
   current major (`1`). Because it is optional and both sides already ignore unknown fields,
   an unversioned peer keeps working. Update `protocol.ts`, `wire.py`, and the golden
   fixtures together (the inventory's rule), and **regenerate the golden fixtures
   deliberately** so they now pin the version field. The golden tests stay meaningful: they
   now also assert that the version is serialized and that its absence still parses.
2. **Wire the floor and the `/health` read (the skew guard becomes real).** Add `minProtocol`
   to `/health` and make `ts_runner.py` probe `/health` once per runner endpoint, cache it,
   and reject on an out-of-band major before the first run. No payload change. Add tests for
   the reject path and the in-band pass path. This is the first step that changes behavior,
   and it is purely defensive.
3. **Add the capability read for `harness` / `engines`.** Service checks the chosen harness
   against the runner's advertised list and errors clearly (or, during a rename, downcasts)
   when the runner is too old. This is the step that directly de-risks A3's
   `pi` -> `pi_core` / `agenta` -> `pi_agenta` rename: the rename becomes a major bump with a
   `v2 -> v1` downcaster that maps `pi_core` back to `pi` for old runners.
4. **Introduce the adapter layer once A2's schema source of truth exists.** Define the v1
   schema as the baseline, then add the first real upcaster/downcaster pair when the first
   breaking change lands (likely A3's rename or a new agent config field). Adapters are pure
   functions with their own unit tests. The **golden fixtures gain a per-version directory**:
   `golden/v1/` keeps today's bytes, `golden/v2/` pins the new shape, and a round-trip test
   asserts `downcast(v2_fixture) == v1_fixture` and `upcast(v1_fixture)` is well-formed. This
   keeps the golden tests meaningful across versions instead of letting a new shape silently
   replace the old pinned bytes.
5. **Bump the major for the first breaking change, with adapters carrying the gap.** When A3
   renames the harnesses or a new agent config shape lands, bump major to `2`, ship the
   adapters, and keep the floor at `1` for a deprecation window so a `v2` service still drives
   a `v1` runner. Drop `v1` from the floor only after the runner fleet is upgraded.

### Keeping the golden-fixture tests meaningful

The golden fixtures are the contract's teeth. The risk in any versioning scheme is that a new
shape just overwrites the old pinned bytes, so the test passes but the back-compat guarantee
is untested. The mitigation, baked into steps 1 and 4:

- Fixtures become **per-version** (`golden/v1/`, `golden/v2/`), and the old bytes are kept,
  not replaced.
- A **round-trip adapter test** asserts that downcasting a `v2` fixture yields exactly the
  `v1` fixture, and that upcasting a `v1` fixture yields a well-formed `v2` shape. That is the
  test that actually proves a newer service and an older runner interoperate.
- The existing byte-for-byte back-compat splits the inventory already calls out (a plain
  string `model` must keep `provider`/`connection` off the wire) become *the v1 contract* and
  are pinned in `golden/v1/` unchanged.

## Compatibility with the sibling efforts (A2, A3)

- **A2 (`wire-contract-schema`, schema source of truth, possible `/run` split).** This
  proposal puts the version field *in the schema*, so A2 owns where it lives and this work
  owns what it means. The adapters are defined against schema versions, which is the natural
  home once the hand-mirror is replaced. If A2 splits `/run` into multiple endpoints, the
  same `contractVersion` + floor + adapter model applies per resulting contract; nothing here
  assumes a single endpoint. A2's row on the board explicitly folds in "contract-version" as
  a coordination point with A1 (this work); this is the A1 half of that handshake.
- **A3 (backend removal + `pi` -> `pi_core`, `agenta` -> `pi_agenta`).** A3's rename is the
  first concrete breaking change this scheme is designed to absorb. Recommended sequencing:
  A3 lands the rename as a **major bump** with the `v2 -> v1` harness downcaster (mapping
  `pi_core` -> `pi`, `pi_agenta` -> `pi` since `agenta` already remaps to `pi` in the runner)
  so a new service still drives an old runner during the rollout. Removing the legacy
  in-process backend is orthogonal to the wire version: it removes an *engine* (`pi` engine
  vs `sandbox-agent`), not a contract version, and `/health`'s `engines` list already exists
  to advertise which engines a runner still has.

## Open questions

- **Who owns the version constant after A2?** Today `PROTOCOL_VERSION` lives in `version.ts`
  and is mirrored by intent in `wire.py`. With a schema source of truth, the version should
  be generated from the schema so the two sides cannot drift. Confirm with A2.
- **String `"major.minor"` vs structured `{major, minor}` on the wire.** A string is simpler
  to log and grep; a struct is easier to compare. Either works; pick whatever A2's schema
  codegen prefers.
- **How long is the deprecation window / how many majors back must adapters span?** One major
  back (N and N-1) is the cheap default and covers a normal rolling upgrade. Spanning more
  than one back multiplies adapter pairs. Recommend N..N-1 unless an operational reason
  demands longer.
- **Should `/health` advertise the baked `sandbox-agent` version?** It would let the service
  reason about harness-library skew, not just our own protocol. Low cost (one more field on an
  existing endpoint), and it would make "this runner's sandbox-agent is too old for `pi_core`"
  diagnosable. Out of scope to decide here, flagged for A2/A3.
- **Floor enforcement location: service-side, runner-side, or both?** Service-side reject on
  `/health` is the cheapest and catches the common "old runner" case before any run. A
  runner-side check on the inbound `contractVersion` would also catch "old service" and a
  direct caller bypassing the service. Both is safest; service-side first is the minimum.
- **Does the streaming record envelope (`{kind}`) need its own version?** It rides `/run`, so
  it inherits the spine version. Likely no separate version needed, but confirm once A2
  decides whether streaming is a separate contract.
