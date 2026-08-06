# Builder tooling review: platform ops vs the build-agent scripts

Status: research and proposal, 2026-07-03. One decision made (op renames, see "Agreed changes" below); the rest is open. No code changed yet. Sources: `op_catalog.py`, `overlay.py`, `static_catalog.py`, the runner's `direct.ts`, all 13 scripts + `SKILL.md` in `agenta-skills/skills/build-agent/`, and the lab evidence in `agent-creation-lab/`.

## TL;DR

- Inside Agenta the playground agent gets 18 platform ops + `request_connection` (19 tools), all injected unconditionally by `overlay.py`. The lab's successful runs used about 7 capabilities. The other ~12 are lifecycle management or unproven.
- The outside kit won because it is small, ordered, and self-verifying. Its killer tool is `test-agent.sh`: one streaming invoke with OUTPUT, an ordered TOOLS line, APPROVAL gates, and the RESOLVED config from the trace.
- Inside Agenta there is no self-test or verify tool. That is the biggest gap. A platform op can only wrap one existing endpoint, so `test_run` needs a new composite endpoint.
- Cut the pause/resume family (4 ops) and `query_workflows` from the default overlay. Keep `test_subscription` (revised per Mahmoud, 2026-07-03). Keep removes for cleanup and retry.
- Renaming to one verb per capability (`discover_tools` / `discover_triggers` inside, matching the outside scripts) is decided: hard migrate, no aliases.
- Recommended unified set: 13 tools inside (8 core + 5 event ops), 11 scripts outside.

## Read next

- [Part 1: the outside kit](part-1-external-tools.md): the alignment matrix, the outside verdicts, and the outside recommendations.
- [Part 2: the inside platform ops](part-2-internal-tools.md): how a platform op works, the per-op verdicts, why logic-bearing tools cannot be gateway tools, the `test_run` gap and endpoint sketch, and the recommended inside set.

## Open questions for Mahmoud

1. Overlay selection: static smaller overlay, or the event pack added conditionally?
2. `test_run` sync vs async: a duration cap first, or the `test_id` + poll pair now?
3. Should `test_run` accept a `delta` (test-before-commit), or only the committed revision?
4. Does inside ever grow a builder-of-other-agents (a `create_workflow` op)?
5. Ship the `query_spans` stopgap read op now, or hold it for `test_run`?

## Agreed changes to batch into one PR

- 2026-07-03 — op renames: hard-migrate `find_capabilities` -> `discover_tools` and `find_triggers` -> `discover_triggers` (no aliases; pre-production, no backward-compat). Decided by Mahmoud on decision op-renames.
