# Wave 2 cleanup nodes

| Node | Depends on | Branch | Purpose |
| --- | --- | --- | --- |
| `CU-2-01` | `IM-2-02` | both | Retire the Wave 1 placeholders the seam replaces, resolve the naming collisions `seams.md` recorded, and synchronise the design documents with what was delivered. |

`CU-2-01` is a real node with its own worktree and throwaway branch, not informal post-merge
work. It owns four things and nothing else:

- **The fixture pricing.** `ee/src/core/measurements/pricing.py` and every reference to
  `calculate_fake_charge` go, once `WP-2-02`'s rate card is in place.
- **The fake producers.** `api/ee/tests/pytest/acceptance/wallets/fakes/` stops being the
  production measurement source. What survives is whatever a test still needs to build a
  deterministic measurement without standing up a gateway, and it moves under the test
  utilities that own that job.
- **The vocabulary collisions.** `seams.md` under "Three live meanings of one word" and
  "Mechanical collisions to fix before anyone writes code" lists conflicts that were left to
  this point deliberately. The one that binds here is the word *credit*: the production
  `Counter.CREDITS_CONSUMED` meter counts requests against platform keys, and the wallet's
  credit is a lot of micro-dollars. `gateways-research` D24 leaves the counter alone until
  the gateway is the sole mechanism; this node records whether Wave 2 made it so, and if it
  did, retires it rather than leaving two things called credits.
- **The documents.** `wave-2.md`'s completion evidence, `entities.md` where a name changed,
  `seams.md`'s "what nobody owns yet", and the open-design items this wave closed or opened.
