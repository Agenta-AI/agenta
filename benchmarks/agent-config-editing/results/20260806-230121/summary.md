# One-shot config editing — 2026-08-06T23:01:21Z

threshold 95% one-shot · deployment `http://144.76.237.122:8580` · HEAD `0fb686cdd2a8`

## One-shot rate by cell and scenario

| cell | read-02-list-skills | skill-01-add-inline | skill-02-edit-body | skill-03-remove | skill-04-rename | list-03-nested-file-entry | fm-01-invented-marker | one-shot | excl. harness | eventual | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-local | 3/3 | 2/3 | 3/3 | 3/3 | 1/3 | 2/3 | 0/3 | 67% | 67% | 86% | $0.76 |
| pi-luna-local | 3/3 | 3/3 | 3/3 | 3/3 | 0/3 | 1/3 | 2/3 | 71% | 71% | 95% | $0.28 |
| codex-luna-local | 3/3 | 2/3 | 2/3 | 3/3 | 1/3 | 2/3 | 0/3 | 62% | 71% | 86% | $0.00 |

`n/m` is one-shot passes over measured trials. `!` marks a cell where a hard-fail instrument fired. `SKIP` is untested, never a pass.

**`excl. harness`** forgives trials that would have been one-shot but for a runtime failure carrying no error code — a malformed tool-input serialization, an EISDIR. `one-shot` is what a user experiences; `excl. harness` is what an instruction change can actually move, and the distance between them is a plumbing bug worth its own fix. Runs recorded before this column existed show the two as equal.

## Scenario totals across cells

| scenario | class | one-shot | eventual | gap | top failure |
|---|---|---|---|---|---|
| read-02-list-skills | read | 100% | 100% | +0% |  |
| skill-01-add-inline | skills | 78% | 100% | +22% |  |
| skill-02-edit-body | skills | 89% | 100% | +11% |  |
| skill-03-remove | skills | 100% | 100% | +0% |  |
| skill-04-rename | skills | 22% | 100% | +78% | item_rename_not_allowed |
| list-03-nested-file-entry | list_entries | 56% | 100% | +44% | target_not_found |
| fm-01-invented-marker | failure_mode | 22% | 22% | +0% | stored_matches |

`gap` is the error-then-fix rate: work the model got right only after a refusal. The goal drives it to zero, not just `eventual` to 100%.

## Failure shapes

Two cells can score the same and need opposite fixes, so a failure is labelled by SHAPE. `described_no_action` (knew the mechanism, never reached for it) wants directive guidance; `attempt_refused` (reached for it and got the details wrong) wants a mechanical correction; `wrong_surface` (did the job in the workspace and reported success) wants a location sentence. A wording change that moves one and not the others is only visible here.

| cell | described_no_action | no_action | wrong_surface | attempt_refused | committed_wrong | unsettled |
|---|---|---|---|---|---|---|
| claude-haiku-local | 0 | 3 | 0 | 0 | 0 | 0 |
| pi-luna-local | 0 | 1 | 0 | 0 | 0 | 0 |
| codex-luna-local | 0 | 3 | 0 | 0 | 0 | 0 |

| scenario | shape | trials |
|---|---|---|
| fm-01-invented-marker | no_action | 7 |

## Protocol version stamps

The instruction surfaces these numbers measure. A results file read against different text is a different measurement.

| surface | path | commit | sha256 | dirty |
|---|---|---|---|---|
| tool_descriptions | `sdks/python/agenta/sdk/agents/platform/op_catalog.py` | `8f08116a29ba` | `3b01fb97c8d5d2e1` | YES |
| platform_guidance | `services/runner/src/engines/sandbox_agent/platform-guidance.ts` | `7f4ff960b6fb` | `cda38f6ff5d31334` | YES |
| guidance_composer | `services/runner/src/engines/sandbox_agent/system-prompt-appendix.ts` | `5a27eb85072f` | `d8bd15d551087139` | YES |
| mount_guidance | `services/runner/src/engines/sandbox_agent/agent-mount-guidance.ts` | `c725a9780c4c` | `9839eee8a8499710` | YES |
| engine_errors | `api/oss/src/core/workflows/change_set.py` | `5fa2537536ee` | `da0577034a1f06ef` | YES |
| guidance_skill | `.agents/skills/build-agent/SKILL.md` | `` | `6c3bcbcbcf2e93f0` | no |
