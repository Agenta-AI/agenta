# Cheaper platform tools in the playground build kit

Status: **Phases 1–2 SHIPPED. Phase 3 (lazy schema) STASHED**, not in the tree.
**18,353 → 5,357 tokens (70.8%).**
Date: 2026-07-20 · Revised 2026-07-28.

The playground advertised 13 platform-op schemas on every turn — **18,353 tokens** measured —
before the model did anything. It now advertises 5,357.

## Strategy

**Diet the schemas.** One lever shipped; the second is built but held back.

| Phase | Lever | Delivered | Cut | Where |
| --- | --- | ---: | ---: | --- |
| 1 | agent-template diet | 18,353 → 6,353 | 65.4% | `op_catalog.py` |
| 2 | `query_spans` DSL trim | → **5,357** | **70.8%** | same file + a skill reference |
| 3 | lazy schema | *(stashed)* | — | — |

Neither shipped phase needed a permission change or transport work, and both landed on all three
harnesses at once. Numbers and findings: **[results.md](results.md)** · [plan.md](plan.md) ·
[design.md](design.md).

## Why Phase 3 is stashed

Lazy schema was built, measured at 82.1%, and **failed its first lab trace**: at a 400-character
deferral threshold nine of thirteen ops deferred, and the model called `discover_tools` with
invented arguments — plus the stub's own instruction text as an argument name
(`{"load_op": "discover_tools", …}`). Four fixes followed (a 2,000-char threshold, a stub carrying
top-level `required`, a literal `load_op({"op": "…"})` call form, and errors naming that call),
and they hold under unit test. What they do not have is a second lab run proving a live model
takes the hint.

That evidence gap is the reason for the hold, not a defect in the code. Phases 1–2 carry 70.8% on
their own, change one Python file, add no round trip, and lose no enforcement — so they ship now
and Phase 3 waits for the measurement it needs.

**The work is recoverable in full** — see [results.md](results.md#phase-3-stashed).

## What measurement changed after shipping

- **The diet's expected cost did not exist.** Nested `required` was never enforceable under
  `parameters.agent` — the deep-partial pass had already stripped it. No enforcement was lost.
- **One behavior change, in the safe direction.** The full schema closed every nested object, so a
  config using an unmodelled field was rejected in the harness even though the commit endpoint
  never validated that shape. Those payloads now reach the server, the actual authority.
- **The plan's per-phase estimates were optimistic**, each assuming the residue after a lever was
  ~0. Direction held; magnitudes did not. Full arithmetic in [results.md](results.md).

## The two levers are different things

| | the schema | the tool entry |
| --- | --- | --- |
| Diet | permanently shorter | present |
| Lazy schema *(stashed)* | fetched on request (>2,000 chars only) | present |

Both are token levers; the tool *count* is unchanged, so neither addresses wander.

## Lazy activation is out of scope

Deferring the tool entry itself is the only lever that would reduce tool count — and it is **not in
this plan** until explicitly asked for. It buys ~100 tokens over lazy schema, so its case rests
entirely on wander, which is asserted rather than measured. It is also the only lever needing
per-harness transport work: Pi has the API today, but Claude and Codex go over MCP and need
`notifications/tools/list_changed` — which the local HTTP server cannot send at all, which the stdio
shim would need re-plumbing to send, and which the pinned third-party ACP clients may ignore
mid-turn. Full record:
[alternatives.md](alternatives.md#3--lazy-activation-out-of-scope).

## What the measurement changed

Three ops are 88% of the bill, and one schema object embedded twice is 70% of it
([baseline.md](baseline.md)). The cost is schema *depth*, not catalog *length* — which is why the
diet, not the mechanism, is the delivery.

## What the design review changed

The original mechanism was a **card/menu invoker**: one `agenta_op(op, args)` tool proxying all 13
ops. **Rejected 2026-07-27** — routing every op through one name breaks the permission ladder in
four fail-closed sites where a missed site fails open.

Eight strategies were weighed in total. All of them, with the win each would deliver and why the
seven non-adopted ones are closed, are in one file: **[alternatives.md](alternatives.md)**.

## Locked decisions

- Diet ships first, alone.
- Lazy schema is the mechanism. One projection site, all harnesses, real names.
- Lazy activation is **out of scope** — not a later phase. Revisit only if asked for.
- Discovery is **not** lazy — names and one-liners stay in the prompt.
- Card/menu rejected, recorded, not to be re-proposed.
- Op-set curation dropped: ~5% of tokens for a real capability regression.
- Playground overlay only. No saved-agent change. No commits during planning.

## Open questions

Neither blocks the plan; both would only matter if lazy activation is ever asked for.

1. **Wander evidence.** Is there measured evidence that tool *count* causes failures?
2. **Does a client honor `list_changed` mid-turn?** Only matters if 1 comes back positive.

## Corrections and closed items

- **Handler flag "default off" — wrong.** It defaults **on** (`platform_tools.py:41`, unset and
  empty both enable). All 13 ops advertise; 18,353 is live. *(CodeRabbit, 2026-07-26.)*
- **"Malformed args become a server error" — overstated, then re-sharpened.**
  `assertRequiredArguments` runs runner-side against the private spec (`relay.ts:327`, `:369`)
  before execution, so lazy schema loses nothing. The diet does lose nested `required` checks,
  because it shrinks the private spec too. *(CodeRabbit, 2026-07-27.)*
- **Direct-`call` eligibility heuristic — wrong.** It missed handler-mode `test_run`, 42% of the
  bill. Moot now: real names need no eligibility rule. *(CodeRabbit, 2026-07-26.)*
- **Approval leak across ops — not real.** Grant and decision stores key on
  `approvedCallKey(toolName, args)` — name **plus** args hash.
- **In-sandbox stdio MCP — already ships.** `tool-mcp-stdio.ts`, bundled and uploaded for Daytona.
  Earlier notes treated it as future work.
- **"Disclosure inevitably breaks permission" — overstated.** Only the invoker did.

## Docs

- [results.md](results.md) — **what shipped, what it measured, and what is still untested.**
- [measure.py](measure.py) — reproduces every number, any lever combination.
- [baseline.md](baseline.md) — measured per-op cost and the concentration finding.
- [context.md](context.md) — scope, glossary, success criteria.
- [research.md](research.md) — how tools reach the model, with `file:line`.
- [design.md](design.md) — the two levers, in full.
- [plan.md](plan.md) — phases, each with its win and exit check.
- [alternatives.md](alternatives.md) — **all 8 strategies, win comparison, and why the rejected ones
  were rejected.**
