# One-shot config editing — 2026-08-06T21:20:04Z

threshold 95% one-shot · deployment `http://144.76.237.122:8580` · HEAD `e2a0a3d1f7f1`

## One-shot rate by cell and scenario

| cell | read-01-escalation-code | read-02-list-skills | edit-01-replace-sentence | edit-02-add-a-line | skill-01-add-inline | skill-02-edit-body | skill-03-remove | skill-04-rename | list-01-remove-mcp | list-02-add-mcp | list-03-nested-file-entry | import-01-skill-from-folder | conflict-01-stale-base | multi-01-read-then-remove-section | multi-02-two-changes-one-ask | fm-01-invented-marker | fm-02-stale-recitation | fm-03-harness-skills-folder | fm-04-gateway-without-connection | fm-05-recovery-from-correctable-refusal | one-shot | excl. harness | eventual | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| pi-haiku-local | 3/3 | 1/3 | SKIP | 0/2 | 0/3 | 0/3 | 0/3 | 0/3 | SKIP | SKIP | 0/3 | 2/3 | 3/3 | 0/3 | SKIP | 0/3 | 0/3 | 0/3 | SKIP | 3/3 | 27% | 75% | 82% | $0.87 |

`n/m` is one-shot passes over measured trials. `!` marks a cell where a hard-fail instrument fired. `SKIP` is untested, never a pass.

**`excl. harness`** forgives trials that would have been one-shot but for a runtime failure carrying no error code — a malformed tool-input serialization, an EISDIR. `one-shot` is what a user experiences; `excl. harness` is what an instruction change can actually move, and the distance between them is a plumbing bug worth its own fix. Runs recorded before this column existed show the two as equal.

## Scenario totals across cells

| scenario | class | one-shot | eventual | gap | top failure |
|---|---|---|---|---|---|
| read-01-escalation-code | read | 100% | 100% | +0% |  |
| read-02-list-skills | read | 33% | 100% | +67% |  |
| edit-01-replace-sentence | | SKIP | SKIP | | |
| edit-02-add-a-line | edit_text | 0% | 100% | +100% |  |
| skill-01-add-inline | skills | 0% | 100% | +100% |  |
| skill-02-edit-body | skills | 0% | 0% | +0% | stored_not_contains |
| skill-03-remove | skills | 0% | 100% | +100% |  |
| skill-04-rename | skills | 0% | 100% | +100% | item_rename_not_allowed |
| list-01-remove-mcp | | SKIP | SKIP | | |
| list-02-add-mcp | | SKIP | SKIP | | |
| list-03-nested-file-entry | list_entries | 0% | 0% | +0% | stored_matches |
| import-01-skill-from-folder | import | 67% | 100% | +33% |  |
| conflict-01-stale-base | conflict | 100% | 100% | +0% |  |
| multi-01-read-then-remove-section | multistep | 0% | 100% | +100% |  |
| multi-02-two-changes-one-ask | | SKIP | SKIP | | |
| fm-01-invented-marker | failure_mode | 0% | 100% | +100% |  |
| fm-02-stale-recitation | failure_mode | 0% | 100% | +100% |  |
| fm-03-harness-skills-folder | failure_mode | 0% | 33% | +33% | stored_present |
| fm-04-gateway-without-connection | | SKIP | SKIP | | |
| fm-05-recovery-from-correctable-refusal | failure_mode | 100% | 100% | +0% |  |

`gap` is the error-then-fix rate: work the model got right only after a refusal. The goal drives it to zero, not just `eventual` to 100%.

## Failure shapes

Two cells can score the same and need opposite fixes, so a failure is labelled by SHAPE. `described_no_action` (knew the mechanism, never reached for it) wants directive guidance; `attempt_refused` (reached for it and got the details wrong) wants a mechanical correction; `wrong_surface` (did the job in the workspace and reported success) wants a location sentence. A wording change that moves one and not the others is only visible here.

| cell | described_no_action | no_action | wrong_surface | attempt_refused | committed_wrong | unsettled |
|---|---|---|---|---|---|---|
| pi-haiku-local | 0 | 1 | 5 | 2 | 0 | 0 |

| scenario | shape | trials |
|---|---|---|
| skill-02-edit-body | wrong_surface | 3 |
| list-03-nested-file-entry | wrong_surface | 2 |
| fm-03-harness-skills-folder | attempt_refused | 2 |
| list-03-nested-file-entry | no_action | 1 |

## Protocol version stamps

The instruction surfaces these numbers measure. A results file read against different text is a different measurement.

| surface | path | commit | sha256 | dirty |
|---|---|---|---|---|
| tool_descriptions | `sdks/python/agenta/sdk/agents/platform/op_catalog.py` | `a4b888e0f530` | `7d39c5d962945c54` | YES |
| platform_guidance | `services/runner/src/engines/sandbox_agent/platform-guidance.ts` | `1bc4102479e3` | `cda38f6ff5d31334` | YES |
| guidance_composer | `services/runner/src/engines/sandbox_agent/system-prompt-appendix.ts` | `5a27eb85072f` | `d8bd15d551087139` | YES |
| mount_guidance | `services/runner/src/engines/sandbox_agent/agent-mount-guidance.ts` | `c725a9780c4c` | `9839eee8a8499710` | YES |
| engine_errors | `api/oss/src/core/workflows/change_set.py` | `a4b888e0f530` | `e9b003b365c0636d` | YES |
| guidance_skill | `.agents/skills/build-agent/SKILL.md` | `` | `6c3bcbcbcf2e93f0` | no |
