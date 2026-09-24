# One-shot config editing — 2026-08-06T22:09:10Z

threshold 95% one-shot · deployment `http://144.76.237.122:8580` · HEAD `2d7e3664a999`

## One-shot rate by cell and scenario

| cell | edit-01-replace-sentence | edit-02-add-a-line | conflict-01-stale-base | multi-01-read-then-remove-section | fm-01-invented-marker | fm-02-stale-recitation | fm-05-recovery-from-correctable-refusal | one-shot | excl. harness | eventual | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-local | 2/3 | 0/3 | 3/3 | 1/3 | 0/3 | 1/3 | 3/3 | 48% | 57% | 57% | $0.84 |
| pi-luna-local | 3/3 | 3/3 | 3/3 | 3/3 | 1/3 | 3/3 | 3/3 | 90% | 90% | 90% | $0.30 |
| codex-luna-local | 1/3 | 2/3 | 3/3 | 2/3 | 0/3 | 3/3 | 2/3 | 62% | 67% | 76% | $0.00 |

`n/m` is one-shot passes over measured trials. `!` marks a cell where a hard-fail instrument fired. `SKIP` is untested, never a pass.

**`excl. harness`** forgives trials that would have been one-shot but for a runtime failure carrying no error code — a malformed tool-input serialization, an EISDIR. `one-shot` is what a user experiences; `excl. harness` is what an instruction change can actually move, and the distance between them is a plumbing bug worth its own fix. Runs recorded before this column existed show the two as equal.

## Scenario totals across cells

| scenario | class | one-shot | eventual | gap | top failure |
|---|---|---|---|---|---|
| edit-01-replace-sentence | edit_text | 67% | 89% | +22% | stored_not_contains |
| edit-02-add-a-line | edit_text | 56% | 67% | +11% | stored_matches |
| conflict-01-stale-base | conflict | 100% | 100% | +0% |  |
| multi-01-read-then-remove-section | multistep | 67% | 89% | +22% | stored_not_contains |
| fm-01-invented-marker | failure_mode | 11% | 11% | +0% | stored_matches |
| fm-02-stale-recitation | failure_mode | 78% | 78% | +0% | turn_tool_called |
| fm-05-recovery-from-correctable-refusal | failure_mode | 89% | 89% | +0% | stored_count |

`gap` is the error-then-fix rate: work the model got right only after a refusal. The goal drives it to zero, not just `eventual` to 100%.

## Failure shapes

Two cells can score the same and need opposite fixes, so a failure is labelled by SHAPE. `described_no_action` (knew the mechanism, never reached for it) wants directive guidance; `attempt_refused` (reached for it and got the details wrong) wants a mechanical correction; `wrong_surface` (did the job in the workspace and reported success) wants a location sentence. A wording change that moves one and not the others is only visible here.

| cell | described_no_action | no_action | wrong_surface | attempt_refused | committed_wrong | unsettled |
|---|---|---|---|---|---|---|
| claude-haiku-local | 0 | 2 | 4 | 0 | 0 | 3 |
| pi-luna-local | 0 | 2 | 0 | 0 | 0 | 0 |
| codex-luna-local | 0 | 2 | 3 | 0 | 0 | 0 |

| scenario | shape | trials |
|---|---|---|
| fm-01-invented-marker | no_action | 6 |
| edit-02-add-a-line | wrong_surface | 3 |
| fm-02-stale-recitation | unsettled | 2 |
| edit-01-replace-sentence | wrong_surface | 1 |
| multi-01-read-then-remove-section | wrong_surface | 1 |
| fm-01-invented-marker | unsettled | 1 |
| fm-01-invented-marker | wrong_surface | 1 |
| fm-05-recovery-from-correctable-refusal | wrong_surface | 1 |

## Protocol version stamps

The instruction surfaces these numbers measure. A results file read against different text is a different measurement.

| surface | path | commit | sha256 | dirty |
|---|---|---|---|---|
| tool_descriptions | `sdks/python/agenta/sdk/agents/platform/op_catalog.py` | `352e204c3a5e` | `a85076d4c3065298` | YES |
| platform_guidance | `services/runner/src/engines/sandbox_agent/platform-guidance.ts` | `7f4ff960b6fb` | `cda38f6ff5d31334` | YES |
| guidance_composer | `services/runner/src/engines/sandbox_agent/system-prompt-appendix.ts` | `5a27eb85072f` | `d8bd15d551087139` | YES |
| mount_guidance | `services/runner/src/engines/sandbox_agent/agent-mount-guidance.ts` | `c725a9780c4c` | `9839eee8a8499710` | YES |
| engine_errors | `api/oss/src/core/workflows/change_set.py` | `5fa2537536ee` | `da0577034a1f06ef` | YES |
| guidance_skill | `.agents/skills/build-agent/SKILL.md` | `` | `6c3bcbcbcf2e93f0` | no |
