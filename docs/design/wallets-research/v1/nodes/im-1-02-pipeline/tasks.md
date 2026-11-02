# IM-1-02 tasks

1. Merge `WP-1-03` onto `IM-1-01` in the IM worktree.
2. Walk the eight checks in the specification; record the result of each.
3. Drive both chains end to end against local Redis and Postgres using the fakes.
4. Replay one posting key through the real stream and assert one settlement.
5. Restart both workers and confirm consumer-group creation is idempotent and nothing reprocesses.
6. Feed a poisoned message and confirm it is terminally ACKed rather than wedging its group.
7. Write the acceptance procedure for the local deployment, naming the `AGENTA_WORKER_STREAMS`
   entries needed to run both workers.
8. Record results for `CU-1-01`.
