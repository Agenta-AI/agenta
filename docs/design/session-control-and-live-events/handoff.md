# Where the design session stopped

> **AGENT-GENERATED, low weight.**

As of 4 September 2026, four independent reviews are complete and their accepted findings are in
the contracts. The current documents form the contract-baseline candidate. Implementation has not
started from this baseline.

The design freezes six durable event payloads. It also fixes temporary frame retention at 15
minutes and 100,000 frames per session. The runner sends frames through the existing records ingest
stream. The relay forwards them to API SSE connections.

Mahmoud settled all seven open choices on 2026-09-04. Late output is quarantined. The records domain
uses a cursor table on the analytics database. The Codex reap ships before a separate pin bump. Each
increment uses one global environment switch. The public Stop route remains `/cancel`. The runner
shutdown grace period is 30 seconds. Stop after teardown returns `not_running`.

No design question blocks implementation. The next actor should record the baseline commit in
`status.md` and start implementation at the checkpoints in `plan.md`.
