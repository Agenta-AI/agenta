# One-shot config editing — 2026-08-06T22:28:03Z

threshold 95% one-shot · deployment `http://144.76.237.122:8580` · HEAD `360fbbd323fb`

## One-shot rate by cell and scenario

| cell | skill-01-add-inline | skill-02-edit-body | skill-03-remove | skill-04-rename | list-03-nested-file-entry | import-01-skill-from-folder | fm-03-harness-skills-folder | one-shot | excl. harness | eventual | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| codex-luna-local | 1/3 | 1/3 | 3/3 | 1/3 | 3/3 | 2/3 | 3/3 | 67% | 76% | 86% | $0.00 |

`n/m` is one-shot passes over measured trials. `!` marks a cell where a hard-fail instrument fired. `SKIP` is untested, never a pass.

**`excl. harness`** forgives trials that would have been one-shot but for a runtime failure carrying no error code — a malformed tool-input serialization, an EISDIR. `one-shot` is what a user experiences; `excl. harness` is what an instruction change can actually move, and the distance between them is a plumbing bug worth its own fix. Runs recorded before this column existed show the two as equal.

## Scenario totals across cells

| scenario | class | one-shot | eventual | gap | top failure |
|---|---|---|---|---|---|
| skill-01-add-inline | skills | 33% | 67% | +33% | stored_len |
| skill-02-edit-body | skills | 33% | 67% | +33% | stored_not_contains |
| skill-03-remove | skills | 100% | 100% | +0% |  |
| skill-04-rename | skills | 33% | 100% | +67% |  |
| list-03-nested-file-entry | list_entries | 100% | 100% | +0% |  |
| import-01-skill-from-folder | import | 67% | 67% | +0% | stored_contains |
| fm-03-harness-skills-folder | failure_mode | 100% | 100% | +0% |  |

`gap` is the error-then-fix rate: work the model got right only after a refusal. The goal drives it to zero, not just `eventual` to 100%.

## Failure shapes

Two cells can score the same and need opposite fixes, so a failure is labelled by SHAPE. `described_no_action` (knew the mechanism, never reached for it) wants directive guidance; `attempt_refused` (reached for it and got the details wrong) wants a mechanical correction; `wrong_surface` (did the job in the workspace and reported success) wants a location sentence. A wording change that moves one and not the others is only visible here.

| cell | described_no_action | no_action | wrong_surface | attempt_refused | committed_wrong | unsettled |
|---|---|---|---|---|---|---|
| codex-luna-local | 0 | 0 | 2 | 0 | 1 | 0 |

| scenario | shape | trials |
|---|---|---|
| skill-01-add-inline | wrong_surface | 1 |
| skill-02-edit-body | wrong_surface | 1 |
| import-01-skill-from-folder | committed_wrong | 1 |

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
