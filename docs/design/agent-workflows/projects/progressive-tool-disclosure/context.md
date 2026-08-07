# Context

## Problem

Open a playground agent that shows "Tools: None" and type "hi". The turn carries **18,353 prompt
tokens** of platform-op schema (measured 2026-07-26 — [baseline.md](baseline.md)). Nothing the
author did explains it: the cost is the playground **build kit**, which injects 13 platform ops
into the agent template and advertises every one of them on every turn.

Two costs, not one:

- **Tokens**, and they are *concentrated*. `test_run` (7,777) + `commit_revision` (6,878) +
  `query_spans` (1,578) are **88%** of the bill; the other ten ops are 2,120 combined. One schema
  object — `_build_agent_template_delta_schema()`, 6,441 tokens — is embedded in **both**
  `test_run` and `commit_revision`, so **70% of the bill is one object counted twice.**
- **Reliability.** The internal-tools review
  (`../builder-agent-reliability/tools-review/part-2-internal-tools.md`) found the same tools are a
  *double* cost: "each unused tool is context cost plus a wander target (the capstone showed extra
  visible tools derail runs)."

**These two costs need different fixes, and that is the central finding of this workspace.**
Shrinking schemas fixes the token cost and the wander cost not at all — the tool *count* is
unchanged. Reducing the advertised tool count fixes wander but, after the schema work, buys ~100
tokens. Conflating them is what made the first draft lead with the expensive, risky lever instead
of the cheap one.

The tail is *cheap* — ten ops for 2,120 tokens — so catalog growth is not the current pain. Schema
*depth* is.

## Scope (this delivery)

- A **schema diet** for the ops carrying deep expanded schemas — `commit_revision`, `test_run`,
  then `query_spans`. 84% of the token win, no runner change.
- **Lazy schema** — ops stay advertised under real names with stub schemas; `load_op` returns the
  full schema on request. One projection site, all harnesses ([design.md](design.md)).
- A **token baseline** so before/after is measured, not asserted — done ([baseline.md](baseline.md));
  reliability measurement still open.

## Out of scope

- **Lazy activation** (deferring the tool entry itself). Out of scope until explicitly asked for —
  ~100 tokens over lazy schema, an unmeasured wander case, and the only lever needing per-harness
  transport work. Record: [alternatives.md](alternatives.md#3--lazy-activation-out-of-scope).

## Product language

- **Platform op** — an existing Agenta endpoint exposed to the agent as a tool, defined in the code
  catalog `op_catalog.py` (e.g. `commit_revision`, `query_spans`).
- **Advertised spec** — the `{name, description, inputSchema, …}` projection the model sees;
  distinct from the **private resolved spec** the runner executes and validates from.
- **Schema diet** — permanently shrinking a deep, type-expanded `inputSchema` to a shallow one plus
  a pointer to prose. The detail is gone; the tool stays visible.
- **Lazy schema** — the full schema still exists but is not in the prompt. `load_op(name)` returns
  it on request. The tool stays visible.
- **Lazy activation** — the tool entry itself is absent until activated. The only lever that reduces
  tool count, and out of scope here.
- **Card/menu invoker** — the rejected alternative: one `agenta_op(op, args)` tool that both lists
  and **proxies** every op. See [alternatives.md](alternatives.md).

## Success criteria

1. **Diet:** platform-op prompt cost drops from 18,353 to under ~3,000 tokens with no capability
   loss — a lab agent still commits a valid config and runs a test.
2. **Lazy schema:** under ~500 tokens, and adding a catalog op grows the prompt by its index
   entry only (name + one-liner, ~12 tokens), never by its schema. Discovery stays eager, so the
   index itself still scales linearly; the target is that *schema* growth stops.
3. **Session-level, not turn-level:** total platform-op tokens across a full build session
   (discover → wire → commit → test → schedule) drop materially. A no-op turn is *reported*, never
   the target.
4. **No safety regression:** `$ctx` bindings and per-op approval behave exactly as today —
   preserved by construction (real names reach every gate) and verified per mutating op.
5. **Discovery never regresses:** the model can always name what it is able to do. An op it cannot
   see is a capability it will deny having — worse than the token bill.
6. **Cost of laziness bounded:** ≤1 extra round-trip per distinct op used, and no net regression in
   session-level tokens.
7. **Wander measured, not assumed** — the input that would decide whether lazy activation is ever
   asked for.
