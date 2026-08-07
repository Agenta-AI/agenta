# Cheaper platform tools in the playground build kit

Status: PLANNING — no implementation.
Date: 2026-07-20 · Revised 2026-07-27.

The playground advertises 13 platform-op schemas on every turn — **18,353 tokens** measured — before
the model does anything. Every always-on tool is also a wander target.

## Strategy

**Diet the schemas, then make them lazy.** Two levers, that's it.

| Phase | Lever | From → to | Cut | Effort |
| --- | --- | ---: | ---: | --- |
| 1–2 | schema diet | 18,353 → ~3,000 | 84% | 1 Python file |
| 3 | lazy schema | ~3,000 → ~500 | 97% | 1 runner function |

Neither needs a permission change or transport work, and both land on all three harnesses at once.
Details: [design.md](design.md) · [plan.md](plan.md).

## The two levers are different things

| | the schema | the tool entry |
| --- | --- | --- |
| Diet | permanently shorter | present |
| Lazy schema | fetched on request | present |

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

- [baseline.md](baseline.md) — measured per-op cost and the concentration finding.
- [context.md](context.md) — scope, glossary, success criteria.
- [research.md](research.md) — how tools reach the model, with `file:line`.
- [design.md](design.md) — the two levers, in full.
- [plan.md](plan.md) — phases, each with its win and exit check.
- [alternatives.md](alternatives.md) — **all 8 strategies, win comparison, and why the rejected ones
  were rejected.**
