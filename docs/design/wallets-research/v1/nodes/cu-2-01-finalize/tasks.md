# CU-2-01 tasks

1. Delete `ee/src/core/measurements/pricing.py` and every reference to it. Run the unit suites.
2. Move whatever of the wallet-owned fakes a test still needs under
   `api/ee/tests/pytest/utils/`, and delete the rest. A fake that no test imports is dead.
3. Establish whether the gateway is now the sole mechanism for platform-key model calls. If it
   is, retire `Counter.CREDITS_CONSUMED` and say so in the commit; if it is not, record what
   still bypasses the gateway, because that list is the condition D24 waits on.
4. Update `wave-2.md`, `entities.md`, `seams.md` and `open-designs.md` to what was delivered.
   Where a delivered name differs from a planned one, the delivered name wins and the document
   changes.
5. Update `HANDOFF.md`: the state of the code, the counts, the open items in priority order,
   and what the next wave must contain.
6. `ruff format`, `ruff check`, both unit suites, and record the final counts.
