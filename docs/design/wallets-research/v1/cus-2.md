# Wave 2 cleanup nodes

| Node | Depends on | Branch | Purpose |
| --- | --- | --- | --- |
| `CU-2-01` | `IM-2-02` | both | Retire the Wave 1 placeholders the seam replaces, resolve the naming collisions `seams.md` recorded, and synchronise the design documents with what was delivered. |

`CU-2-01` is a real node with its own worktree and throwaway branch, not informal post-merge
work. It owns five things and nothing else:

- **The fixture pricing.** `ee/src/core/measurements/pricing.py` and every reference to
  `calculate_fake_charge` go, once `WP-2-02`'s rate card is in place.
- **The fake producers.** The fake LLM producer is superseded by the real one and goes. The
  fake MCP producer is not: Wave 2 built no MCP producer, so it remains the only thing that
  emits an MCP measurement and the only thing the MCP charge can be tested against. It moves
  under the test utilities and stays, with a comment saying what still owes a replacement.
- **The vocabulary collisions.** `seams.md` under "Three live meanings of one word" and
  "Mechanical collisions to fix before anyone writes code" lists conflicts that were left to
  this point deliberately. The one that binds here is the word *credit*: the production
  `Counter.CREDITS_CONSUMED` meter counts requests against platform keys, and the wallet's
  credit is a lot of micro-dollars. `gateways-research` D24 leaves the counter alone until
  the gateway is the sole mechanism; this node records whether Wave 2 made it so, and if it
  did, retires it rather than leaving two things called credits.
- **The wallet runtime factory.** `ee/src/core/subscriptions/service.py` and
  `ee/src/core/organizations/service.py` both reach for `get_wallets_service()`
  (`ee/src/core/wallets/runtime.py`), which builds a concrete `WalletsDAO` inside core.
  `api/AGENTS.md` states that core services depend on interfaces rather than concrete database
  implementations, and that concrete dependencies are wired in `api/entrypoints/*` only. The
  answer is known: a plan-change interface on the constructor, with the concrete implementation
  wired at the entrypoint. Importing a concrete DAO from core is not peculiar to the wallet
  (`ee/src/core/events/service.py` and `ee/src/core/tracing/service.py` do it too), but the
  self-constructing factory is, and the shape to copy is already in EE core:
  `ee/src/core/access/entitlements/service.py` holds its service singletons in core and has the
  entrypoint register them through `register_entitlements_services`. What makes this more than
  tidiness is that a core service reaching for global runtime state cannot be constructed in a
  test without that state, and the wallet fakes exist precisely so that it can be. Nothing in it
  depends on the seam, so it can land before the rest of this node if a test needs it sooner.
- **The documents.** `wave-2.md`'s completion evidence, `entities.md` where a name changed,
  `seams.md`'s "what nobody owns yet", and the open-design items this wave closed or opened.
