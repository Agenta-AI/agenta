# CU-1-01 tasks

## Completed — terminology and delivered names

- [x] Remove superseded terminology and dead configuration the delivered code exposed. The
      `check(delta)` the design documents name throughout is now marked as the design operation,
      not the delivered signature: what shipped is `check(*, organization_id) -> bool`, async, with
      no amount argument (`entities.md` §5, `preflight.md` disposition B3).
- [x] Update `entities.md` with the delivered table, column and stream names, and mark the §5
      questions Wave 1 answered. Its "Delivered (Wave 1)" subsection now also carries
      `ee0000000005` and the feature-flag gate on `ALL_STREAMS`.

## Completed — migration ids and status lines

- [x] Update `wave-1.md` with the actual migration ids, stream names, consumer groups and `MAXLEN`
      values. `core_ee` head is `ee0000000005`; `tracing_ee` head is `ee0000000002`; the streams are
      `streams:measurements` / `worker-measurements` and `streams:debits` / `worker-debits`, both at
      `MAXLEN 100_000`.
- [x] Replace the status lines that still claimed nothing was implemented: `README.md`, `waves.md`
      and `wave-1.md` now say Wave 1 is code-complete and switched off behind
      `AGENTA_WALLETS_ENABLED`, and that checkpoint 1 closes only when the acceptance procedure has
      run with the flag on.
- [x] Record in `README.md` that the branch was squashed and rebased onto `feat/add-gateways` on
      12 September 2026, so its commit history no longer matches the node graph.

## Completed — open designs and preflight

- [x] Update `open-designs.md`: close only the items Wave 1 genuinely decided, and say what closed
      them. Item 6 closes for LLM and MCP, fixed by `entities.md` §3/§5 and the delivered
      `ee0000000002` migration; SBX stays open. Items 3, 5, 11 and 13 stay open — the wave built
      machinery under each of them and decided none of the policies. Item 10 records the concurrency
      guarantee as proved by a passing test and nothing more. A new register preamble states exactly
      this, so nobody infers a decision from the code.
- [x] Add `open-designs.md` item 14: how an organization provisioned while `AGENTA_WALLETS_ENABLED`
      was off gets its balance row. The migrations are unconditional and the `ee0000000005` backfill
      runs once, so those organizations hold no balance row and their first debit redelivers
      forever. Recorded with three options and a recommendation.
- [x] Update `preflight.md` dispositions with what the wave changed: the delivered `check`
      signature under B3, the `ee0000000005` addition under B2, the contract file under G1, the
      feature-flag gate on stream registration under G3, and the integration-proof status under G2.
      Added a post-implementation row for the feature flag, which did not exist at review time.

## Completed — checks and handoff

- [x] Run `ruff format`, `ruff check`, and `git diff --check` on `api/`. All clean: 1785 files
      formatted, all checks passed.
- [x] Run the API suites, to the extent they run without a deployed stack.
      - The wallet and measurement unit suites: 126 passed. The whole EE unit layer: 497 passed.
      - The whole EE plus OSS unit layer: 4791 passed, 0 failed, 6 skipped.
      - The integration suites that had never been executed, run for the first time on
        12 September 2026: 18 passed under `integration/wallets/`, 2 passed under
        `integration/measurements/`, 20 passed with both together under the default invocation.
      - Not run: the integration and acceptance layers that need a deployed API and workers.
      The first run failed four ways, two of them production defects. All four are fixed with
      regression tests and recorded in `../im-1-02-pipeline/acceptance.md` §9.
- [x] Hand the branch and the written acceptance procedure to the user for local deployment and the
      acceptance run. One thing still has to be settled before the flag is turned on:
      `open-designs.md` item 14, how an organization provisioned while the flag was off gets its
      balance row.
