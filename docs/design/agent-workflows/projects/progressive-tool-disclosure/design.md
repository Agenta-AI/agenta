# Design

Two independent levers, in the order their evidence supports. Revised 2026-07-26: the re-baseline
([baseline.md](baseline.md)) showed the token cost is concentrated in schema *depth*, not tool
*count*, which promotes the diet and demotes the meta-toolset.

| | Lever A — schema diet | Lever B — meta-toolset |
| --- | --- | --- |
| Fixes | token cost | wander / tool count |
| Win | ~84% (18,353 → ~2,970) | ~14% more (→ ~400) |
| Touches | `op_catalog.py` schemas | advertisement + 4 permission sites |
| Runner change | none | substantial |
| Wire change | none | possible (marker) |
| Risk | near-zero | **high** ([security.md](security.md)) |

---

# Lever A — the schema diet (primary)

## The core move

Two ops embed the *same* 6,441-token object, `_build_agent_template_delta_schema()`
(`op_catalog.py:317`), expanded inline into their `input_schema`. That single object counted twice
is 70% of the entire advertised bill. Replace the deep expansion with a shallow schema plus a
pointer to prose guidance that already ships.

## Why this costs almost no capability

The replacement is not hypothetical — it is already in the product and already mandatory:

- `references/config-schema.md` (3,621 tokens of prose + worked examples) ships as a `SkillFile` on
  `BUILD_AN_AGENT_SKILL` (`agenta_builtins.py:740`).
- The skill body already says *"Read `references/config-schema.md` before your first
  `commit_revision`"* (`:579`), and points back to it on failure (`:711`, `:716`).
- That reference states the commit endpoint **does not validate this shape**. So the embedded
  schema enforces no server contract; it is model guidance only.

The model therefore already has a better-written, on-demand source for the same information. The
embedded schema is duplication.

## Shallow, not empty

The first draft proposed `{"type": "object"}` plus a description. Prefer a **shallow** schema over
an open one: keep the top-level keys (`instructions`, `llm`, `tools`, `mcps`, `skills`, `harness`,
`runner`, `sandbox`) with one-line descriptions, and stop before expanding nested `$defs`. That
costs a few hundred tokens instead of ~6,400 and keeps the model oriented about *which* keys exist,
while the reference doc supplies the shapes underneath.

The expansion is what explodes — `expand_type_refs` / `_deep_partial_schema` (`op_catalog.py:249`).
A depth-limited expansion is the surgical form of this change and is reusable for any future op.

## What is genuinely lost

Pi validates arguments against the advertised JSON Schema before dispatch
(`registerTool({parameters})`, `extensions/agenta.ts:305`). A shallower schema catches less
pre-call, so a malformed config surfaces as a server error rather than a harness error. Bounded:
the server does not validate the config shape today either, so this changes *where* the failure
appears, not *whether* it is caught. `test_run` after commit remains the real verification, exactly
as the skill already instructs.

---

# Lever B — the discovery meta-toolset (deferred behind evidence)

## The core move

Stop advertising N op schemas. Advertise a small fixed meta-toolset; keep the op specs resolved but
**private** in runner memory; move each op's schema from the *prompt* into a *tool result*.

- **`agenta_ops(query?)`** — the op catalog as a compact list: `{op, one_line, read_only}`, no input
  schemas. The **advertised prompt cost is flat** regardless of catalog size — that is the win. The
  *result* is O(n) in the catalog (~200 tokens at today's 13 ops, ~15/op), so it must be bounded:
  `query` filters, results are capped at a hard limit, and the response states when it truncated.
  Without a cap, a large catalog reintroduces the same cost one layer down.
- **`agenta_op(op, args?)`** — the generic invoker. No `args` (or `mode:"describe"`) returns one
  op's `inputSchema` as a tool result; with `args` it executes that op.

The op specs stay in `plan.toolSpecs` and `toolSpecsByName`. Only the *advertisement* changes. This
is the pattern Claude Code uses on its own tools: names listed, schema loaded on demand.

## Why it is deferred

1. **Its token case is weak after Lever A.** ~2,600 marginal tokens (~14% of the original bill).
2. **Its real case is reliability** — fewer wander targets — and that is a hypothesis from the
   internal-tools review, not a measurement. The diet does not reduce tool count, so this argument
   survives Lever A intact; it just has to be *proven* rather than assumed.
3. **Its cost is the permission plane.** Four independent gate sites, each of which must learn to
   resolve the target from `args.op`, in code deliberately written to fail closed. Full analysis:
   **[security.md](security.md)**.
4. **It can regress long sessions.** A fetched schema is history-resident for the rest of the
   conversation, in a far less cache-friendly position than a stable tool-definition prefix.
   Without Lever A first, disclosure can cost *more* across a real build session.

## One shared target resolver (required)

Four separate sites need to answer "which op is this really?", and a site that gets it wrong fails
**open** (see [security.md](security.md)). Four independent implementations of a security-sensitive
lookup is the wrong shape.

**Requirement:** define exactly one runner-side primitive —
`resolveDisclosedTarget(toolName, args, specsByName)` — that

1. returns `undefined` unless `toolName` is the invoker (so non-disclosed calls are untouched),
2. validates `args.op` against the same fixed spec map every gate already uses, returning
   `undefined` (→ fail closed) for anything unknown or malformed,
3. returns the canonical `{spec, gateName, args}` triple the caller builds its `GateDescriptor`
   from.

All four gate sites and the invoker's dispatch consume that one result. No site re-implements the
lookup. This is what makes "resolve the target" a single reviewable, single-testable change instead
of four chances to fail open.

## Execution path for `agenta_op(op, args)`

1. **Resolve the target** via the shared primitive above. Unknown → tool error listing valid ops
   (recoverable), and fail closed at every gate.
2. **Describe mode** → return the target's resolved input schema. No side effects, no approval.
3. **Execute mode** → build the permission gate from the **target** spec at all four sites, run
   `decide()`, then `assertRequiredArguments(target, innerArgs)`.
4. **Dispatch on the target's shape — there are two.** Reuse the `executeRelayedTool` core rather
   than reimplementing either branch:
   - **Endpoint-mode** (12 ops, direct `call`) → `assembleBody` → `directCallUrl` → `callDirect`.
   - **Handler-mode** (`test_run`, `callRef`) → `applyContextBindings` → `callAgentaTool`.

   An invoker that forwards only `spec.call` cannot run `test_run` at all.
5. **Return** the response verbatim.

## Why execution itself is safe by construction

Execution reads the **private** spec (research seams 2–3), so dispatching the target through its
own unchanged execution branch preserves:

- **Self-targeting, endpoint-mode.** `assembleBody` still fills `call.context` (`$ctx.*`) last, so
  `commit_revision` still binds `$ctx.workflow.variant.id`; the model cannot retarget. Those fields
  were stripped at resolve time and are re-applied below the invoker.
- **Self-targeting, handler-mode.** `test_run` binds `target.workflow_variant_id` through
  `applyContextBindings` on the `callAgentaTool` branch — a different mechanism, equally below the
  invoker. Both branches must be covered by the `$ctx` test in security.md, not just the first.
- **SSRF guard.** `directCallUrl` host-locks to the run's Agenta origin (endpoint-mode);
  `callAgentaTool` posts back through Agenta's own `/tools/call` so the secret stays server-side
  (handler-mode).

Permission is the part that is **not** free. It is designed in, not inherited — see security.md.

## Identifying the disclosure-eligible set

**Revised 2026-07-26.** The earlier draft recommended a "collapse every direct-`call` callback spec"
heuristic for the POC. That rule is wrong: platform ops do not share one shape (research seam 5).

- `test_run` is **handler-mode** — it resolves to a `callRef`, not a `call` (`op_catalog.py:175`).
  A direct-`call` heuristic **skips it**, leaving 7,777 tokens (42% of the bill, the largest single
  target) advertised. The POC would miss most of its own goal.
- Conversely, an author's `reference` tool carries a direct `call` and a gateway tool carries a
  `callRef`, so both fields over-collapse in the other direction.

**Decision: use the marker.** The platform resolver stamps `source:"platform"` (or a `disclosable`
group tag) on the resolved spec; the runner collapses exactly that group. Costs a `protocol.ts` +
`wire.py` + golden change — small, and it is the only rule that is actually correct. It also lets us
disclose gateway/reference groups later on purpose rather than by accident.

The heuristic is retained only as a documented non-option, so it is not re-proposed.

## The catalog summary (`agenta_ops`)

Build `{op, one_line, read_only}` runner-side from the resolved specs already in memory —
`description` and `readOnly` ride along; only `inputSchema` is dropped. Zero new wire fields.

## Discoverability

The always-loaded `build-an-agent` skill (64-token description, 2,619-token body) gains one line:
"platform actions are listed by `agenta_ops`; fetch a schema with `agenta_op(op)` before calling it
with args."

---

## Alternatives considered

- **Op-set curation** — drop the 5-op event pack from the default overlay unless the ask is
  event-driven. **Rejected.** Saves ~1,052 tokens (~5%) and cannot be decided correctly at run
  start: a user who pivots to "schedule this daily" mid-conversation would find the capability
  missing. A capability regression is not worth 5%.
- **M2 — dynamic real-name advertisement.** Advertise names only; a `load_op` call registers the
  real spec into the harness registry mid-session (Pi re-register; Claude MCP `tools/list_changed`)
  so the model calls the op by its real name with native per-op permission. **Highest fidelity, and
  it dissolves most of security.md** — the gates keep seeing real names. But it needs mid-session
  re-registration on both harnesses and, under the cold-replay runtime, reconstruction of the
  "loaded" set each turn. If Lever B is ever justified, compare M2 against it directly rather than
  treating M2 as a later upgrade — M2's extra complexity may be cheaper than four-site gate surgery.
- **Mode-gating.** Drop the build kit in Chat mode, keep it in Build mode. Removes capability rather
  than deferring it; can layer on top, not a substitute.

## Cost of laziness (Lever B)

One extra round-trip per *distinct* op used, paid only for ops the run actually touches, cacheable
to once per op per conversation. A no-op turn pays nothing beyond the two meta-tools. Must be
measured at **session** level, counting history-resident schemas — not on a "hi" turn.
