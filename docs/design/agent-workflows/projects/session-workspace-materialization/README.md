# Pi session resources and continuity

This workspace plans a launch-safe fix for two failures caused by Pi's temporary per-run agent
directory: skill paths become invalid after cold resume, and native transcripts can be deleted
while Agenta still treats their session IDs as resumable. The immediate gate verifies native loads
and falls back to the canonical transcript replay. The filesystem follow-up uses append-only skill
snapshots and durable private transcript storage without deleting workspace files.

## Files

- `context.md` - Problem, goals, non-goals, and terminology.
- `research.md` - Current Agenta behavior and Pi 0.80.6 discovery rules.
- `design.md` - Proposed cwd ownership and materialization contract.
- `plan.md` - Phased implementation sequence.
- `qa.md` - Unit, integration, lifecycle, and security verification.
- `status.md` - Current decisions, open questions, and next steps.
