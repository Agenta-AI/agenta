# Design — the discovery meta-toolset

## The core move

Stop advertising N full op schemas every turn. Advertise a small fixed meta-toolset; keep the op
specs resolved but **private** in runner memory; move each op's full schema from the *prompt*
(paid every turn) to a *tool result* (paid once, only for ops actually used).

Two model-facing tools (names illustrative):

- **`agenta_ops(query?)`** — returns the op catalog as a compact list: `{op, one_line,
  read_only}` per op, no input schemas. Optional `query` filters. A few hundred tokens, flat,
  regardless of catalog size. This is the "what can I do on the platform" index.
- **`agenta_op(op, args?)`** — the generic invoker. With no `args` (or `mode:"describe"`) it
  returns **one** op's full `inputSchema` as a tool result; with `args` it executes that op.

The 13 op specs stay in `plan.toolSpecs` and in `toolSpecsByName`. Only the *advertisement* is
replaced. This is the pattern Claude Code uses on its own ~200 tools: names are listed, and a
`ToolSearch` step loads a schema only when needed.

## Why this is safe by construction

Execution and permission read the **private** spec (research seams 2–4). The invoker feeds the
target op's private `call` descriptor into the *unchanged* `direct.ts` path, so:

- **Self-targeting is preserved.** `assembleBody` still fills `call.context` (`$ctx.*`) last, so
  `commit_revision` still binds `$ctx.workflow.variant.id` and the model cannot retarget another
  variant. The invoker never sees or forwards those fields — they were stripped at resolve time
  and are re-applied below the invoker.
- **SSRF guard is preserved.** `directCallUrl` host-locks to the run's Agenta origin.
- **Approval is preserved — if the invoker gates per-op.** This is the one piece that is designed
  in, not free (see below).

## Execution path for `agenta_op(op, args)`

The runner special-cases the invoker in its dispatch:

1. **Resolve the target.** Look up `op` in `toolSpecsByName`. Unknown → tool error listing valid
   ops (recoverable).
2. **Describe mode** (no `args` / `mode:"describe"`) → return the target spec's
   `resolved input schema` as the tool result. No side effects, no approval.
3. **Execute mode** → build the permission **gate from the target op's spec** and run
   `decide(gate, plan, stored)` (`permission-plan.ts:138`). `allow` runs; `deny` refuses;
   `ask`/undecided pauses the turn and emits the normal `interaction_request(user_approval)` —
   identical to calling the op directly today. Then run the target's `call` through
   `assembleBody` → `directCallUrl` → `callDirect`, exactly as `executeRelayedTool` does now.
4. **Return** the endpoint response verbatim.

The invoker is one ordinary advertised tool on both delivery paths (Pi native, Claude MCP), so no
harness-specific advertisement logic is needed.

## Identifying the disclosure-eligible set

A platform op is a `callback`-kind spec with a direct `call`; so is a `reference` (workflow)
tool. There is no explicit marker today (research seam 5). Two options:

- **Heuristic (zero wire change).** Collapse every direct-`call` callback spec into the
  meta-toolset; leave builtins, `client`, `code`, `gateway` (callRef), and MCP advertised as-is.
  The playground overlay only injects platform ops (+ the two client tools), so this covers the
  measured cost. Risk: an author who added a `reference` tool would see it disclosed too. Fine for
  a flagged POC.
- **Marker (small wire add).** The platform resolver stamps a `source:"platform"` (or a
  `disclosable` group tag) on the resolved spec; the runner collapses exactly that group. Precise,
  and lets us disclose gateway/reference later on purpose. Costs a `protocol.ts` + `wire.py` +
  golden change.

Recommendation: heuristic for the POC to prove the numbers, marker before default-on.

## The catalog summary (`agenta_ops`)

Build `{op, one_line, read_only}` runner-side from the resolved specs already in memory — the
`description` and `read_only`/`permission` fields ride along; only `inputSchema` is dropped. Zero
new wire fields. (Alternative: thread a summary list from `op_catalog.py`; rejected for the POC as
extra plumbing.)

## Discoverability

The always-loaded `build-an-agent` skill (~68 tokens) gains one line: "platform actions are listed
by `agenta_ops`; fetch a schema with `agenta_op(op)` before calling it with args." Mirrors how the
skill already routes the builder; negligible always-on weight.

## Alternatives considered

- **M2 — dynamic real-name advertisement.** Advertise names only; a `load_op` call registers the
  real op spec into the harness registry mid-session (Pi extension re-register; Claude MCP
  `tools/list_changed`) so the model calls the op by its real name with a schema-validated
  signature and native per-op permission. Highest fidelity, but needs mid-session re-registration
  on both harnesses and, under the cold-replay runtime, reconstruction of the "loaded" set each
  turn. Deferred to productionization.
- **Schema diet only.** Keep all ops advertised; replace the embedded ~5.5K agent-template delta
  schema in `commit_revision`/`test_run` with an open object + a pointer to the skill's
  `references/config-schema.md`. ~11K of ~15K is those two schemas, so this alone is a large,
  near-zero-risk win. Complementary — it also shrinks each describe-mode fetch under the invoker.
- **Mode-gating.** Drop the build kit in Chat mode, keep it in Build mode. Removes capability
  rather than deferring it; can layer on top, not a substitute.

## Cost of laziness

One extra round-trip per *distinct* op used (describe → then execute), paid only for ops the run
actually touches, and cacheable to once per op per conversation. A no-op turn pays nothing beyond
the two meta-tools. Acceptable for a builder flow; measured in Slice 3.
