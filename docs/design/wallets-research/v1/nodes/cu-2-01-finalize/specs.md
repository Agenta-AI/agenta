# CU-2-01 specification: retire the placeholders

Fork from `IM-2-02`. Its own worktree and throwaway branch on each branch, not informal
post-merge work. It removes what the seam replaced and leaves the documents true.

## Owned work

| Item | What done means |
| --- | --- |
| The fixture pricing | `ee/src/core/measurements/pricing.py` and every `calculate_fake_charge` reference are gone; nothing imports `FIXTURE_MARKUP` |
| The fake producers | `api/ee/tests/pytest/acceptance/wallets/fakes/llm.py` is superseded by the real producer and goes. **`fakes/mcp.py` stays**: Wave 2 added no MCP producer, so it remains the only thing that emits an MCP measurement and the only thing the MCP charge is tested against. Move it under the test utilities with a comment saying exactly that, and record what a real MCP producer would have to replace |
| The word *credit* | `Counter.CREDITS_CONSUMED` counts requests against platform keys and a wallet credit is a lot of micro-dollars. `gateways-research` D24 leaves the counter alone until the gateway is the sole mechanism. Record whether Wave 2 made it so; if it did, retire the counter rather than leaving two things called credits |
| The documents | `wave-2.md`'s completion evidence filled in, `entities.md` updated where a name changed, `seams.md`'s "what nobody owns yet" revisited, and every open item this wave closed or opened marked |
| The repository checks | `ruff format`, `ruff check`, and the full unit suites on both branches |

## Explicit exclusions

No behaviour change, no new test beyond what a deletion requires, and no rate change. A cleanup
node that alters what the system does is not a cleanup node.
