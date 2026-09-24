# One-shot config editing — 2026-08-06T19:34:26Z

threshold 95% one-shot · deployment `http://144.76.237.122:8580` · HEAD `16677fa02a24`

## One-shot rate by cell and scenario

| cell | read-01-escalation-code | read-02-list-skills | edit-01-replace-sentence | edit-02-add-a-line | skill-01-add-inline | skill-02-edit-body | skill-03-remove | skill-04-rename | list-01-remove-mcp | list-02-add-mcp | list-03-nested-file-entry | import-01-skill-from-folder | conflict-01-stale-base | multi-01-read-then-remove-section | multi-02-two-changes-one-ask | fm-01-invented-marker | fm-02-stale-recitation | fm-03-harness-skills-folder | fm-04-gateway-without-connection | fm-05-recovery-from-correctable-refusal | one-shot | eventual | cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| claude-haiku-local | 2/2 | 2/2 | 0/2 | 0/2 | 1/2 | 1/2 | 1/2 | 1/2 | 2/2 | 2/2 | 1/2 | 1/2 | 0/2 | 0/2 | 0/2 | 0/2 | 0/2 | 0/2 | SKIP | 0/2 | 37% | 53% | $1.22 |

`n/m` is one-shot passes over measured trials. `!` marks a cell where a hard-fail instrument fired. `SKIP` is untested, never a pass.

## Scenario totals across cells

| scenario | class | one-shot | eventual | gap | top failure |
|---|---|---|---|---|---|
| read-01-escalation-code | read | 100% | 100% | +0% |  |
| read-02-list-skills | read | 100% | 100% | +0% |  |
| edit-01-replace-sentence | edit_text | 0% | 0% | +0% | stored_not_contains |
| edit-02-add-a-line | edit_text | 0% | 0% | +0% | stored_matches |
| skill-01-add-inline | skills | 50% | 100% | +50% |  |
| skill-02-edit-body | skills | 50% | 100% | +50% |  |
| skill-03-remove | skills | 50% | 100% | +50% |  |
| skill-04-rename | skills | 50% | 100% | +50% | item_rename_not_allowed |
| list-01-remove-mcp | list_entries | 100% | 100% | +0% |  |
| list-02-add-mcp | list_entries | 100% | 100% | +0% |  |
| list-03-nested-file-entry | list_entries | 50% | 100% | +50% |  |
| import-01-skill-from-folder | import | 50% | 100% | +50% |  |
| conflict-01-stale-base | conflict | 0% | 0% | +0% | stored_contains |
| multi-01-read-then-remove-section | multistep | 0% | 0% | +0% | stored_not_contains |
| multi-02-two-changes-one-ask | multistep | 0% | 0% | +0% | stored_contains |
| fm-01-invented-marker | failure_mode | 0% | 0% | +0% | stored_matches |
| fm-02-stale-recitation | failure_mode | 0% | 0% | +0% | turn_tool_called |
| fm-03-harness-skills-folder | failure_mode | 0% | 0% | +0% | stored_present |
| fm-04-gateway-without-connection | | SKIP | SKIP | | |
| fm-05-recovery-from-correctable-refusal | failure_mode | 0% | 0% | +0% | stored_count |

`gap` is the error-then-fix rate: work the model got right only after a refusal. The goal drives it to zero, not just `eventual` to 100%.

## Protocol version stamps

The instruction surfaces these numbers measure. A results file read against different text is a different measurement.

| surface | path | commit | sha256 | dirty |
|---|---|---|---|---|
| tool_descriptions | `sdks/python/agenta/sdk/agents/platform/op_catalog.py` | `a588103fa4fe` | `7d39c5d962945c54` | YES |
| platform_guidance | `services/runner/src/engines/sandbox_agent/platform-guidance.ts` | `e795381104c4` | `92da411be0b09e83` | YES |
| guidance_composer | `services/runner/src/engines/sandbox_agent/system-prompt-appendix.ts` | `6db80ce93260` | `d8bd15d551087139` | YES |
| mount_guidance | `services/runner/src/engines/sandbox_agent/agent-mount-guidance.ts` | `b4a0a1f99807` | `9839eee8a8499710` | YES |
| engine_errors | `api/oss/src/core/workflows/change_set.py` | `a588103fa4fe` | `e9b003b365c0636d` | YES |
| guidance_skill | `.agents/skills/build-agent/SKILL.md` | `` | `6c3bcbcbcf2e93f0` | no |
