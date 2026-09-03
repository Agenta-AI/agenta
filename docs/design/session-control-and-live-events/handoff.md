# Where the design session stopped

> **AGENT-GENERATED, low weight.**

As of 4 September 2026, four independent reviews are complete and their accepted findings are in
the contracts. The current documents form the contract-baseline candidate. Implementation has not
started from this baseline.

The design freezes six durable event payloads. It also fixes temporary frame retention at 15
minutes and 100,000 frames per session. The runner sends frames through the existing records ingest
stream. The relay forwards them to API SSE connections.

Late output disposition remains open. O2 in `open-questions.md` holds the choice between quarantine
and rejection. The current code quarantines behind `AGENTA_SESSIONS_HISTORY_WRITES`.

`open-questions.md` holds the seven remaining choices: sequence home, late output, Codex child
cleanup, rollout granularity, Stop spelling, shutdown grace, and teardown result. The next actor
should resolve each choice when its package needs it, record the baseline commit in `status.md`, and
start implementation at the checkpoints in `plan.md`.
