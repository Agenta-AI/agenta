# IM-1-02 specification: pipeline fan-in review

Merge the debit worker onto the reviewed foundations. The result must carry the full fake LLM and
fake MCP two-stream path and be ready for cleanup and the local deployment.

## What must be true to merge

| Check | How to verify |
| --- | --- |
| Registration is coherent | `_build_debits_worker` constructs the class `WP-1-03` shipped; `ALL_STREAMS` holds both new streams; `WP-1-03` changed no line of `api/entrypoints/worker_streams.py` |
| Both chains run | a fake LLM call and a fake MCP call each produce one measurement and one settlement |
| Exactly-once holds end to end | replay the same posting key through the real stream; one set of debit rows |
| The loss boundary is where it was designed | a failed initial `XADD` produces neither measurement nor charge; anything past it retries |
| Failure handling matches across workers | terminal versus retryable is identical in the measurement worker and the debit worker |
| Nothing wedges | a poisoned message is terminally ACKed rather than blocking its group |
| Consumer groups register idempotently | restart both workers; no duplicate group, no reprocessing |
| Acceptance procedure is written | the steps for the local deployment run exist and name the env selector |

## Output

A branch ready for `CU-1-01`, plus the written acceptance procedure the deployment run will follow.
