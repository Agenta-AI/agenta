# Execution plan

The work runs in three phases: spikes, then vertical slices, then finalization. Each
slice lands as a QA-able increment on its own GitButler lane, stacked in dependency
order. PR bases follow the stack; the bottom lane targets the current release branch,
never main.

## Team

- **team-lead** (this session): plans, reviews, integrates, keeps these docs current,
  runs external design and code reviews through Codex at the highest reasoning setting.
- **engine-spike** (Opus): change-set engine prototype, then the API-side slices.
- **runner-spike** (Opus): runner-side spikes, then the runner slices.
- **qa** (Sonnet, joins at slice 1): per-slice tests and live QA on the dev stack.

Spikes run in throwaway worktrees. Slice work lands on GitButler lanes in the main
working directory, one lane per slice, coordinated by the team lead so two agents never
edit one lane at the same time.

## Phase 1: spikes (running)

| Spike | Owner | Question |
|---|---|---|
| Engine prototype | engine-spike | Does the ordered-operations engine hold up in code? What did the spec leave undecided? |
| value_from proof | runner-spike | Can the runner confine a workspace path, convert a folder to a skill, and inject the value into the commit call? |
| Tools discovery | runner-spike | Can a live harness discover a changed tool list (MCP list_changed), per harness? |
| Lifecycle characterization | runner-spike | Tests that pin today's fingerprint, teardown, and approval-repark behavior. |

Exit gate: team lead reviews both spike reports, resolves the implicit decisions they
surface (product calls go to Mahmoud), updates the design docs to final, and runs a
Codex review of the finalized design.

## Phase 2: vertical slices

Slices 1 to 4 are API-and-frontend work (engine-spike). Slices 5 to 7 are runner work
(runner-spike). The two tracks run in parallel; they touch disjoint files.

| Slice | Content | User stories served |
|---|---|---|
| 1 | Change-set engine + commit wrapper: ordered operations, base check atomic with the insert (409 with both ids), commit validation, unique names, strict DTOs, catalog schema. | US-1, US-2, US-4, US-7 |
| 2 | `read_config` tool: self-bound revision read, partial reads, revision id + draft flag in the response, shaped output. | US-5, US-7 retry loop |
| 3 | `value_from` workspace path end to end: runner resolution, folder-to-skill codec, frozen approval content, minimal approval card (name, file list, diff). | US-3 |
| 4 | Optional agent-written `description` on builder tool calls, shown on tool cards. | R12 |
| 5 | Runner safety fixes + applied-state identity (lifecycle migration steps 1 and 2): revision id out of the fingerprint, teardown stops instead of deleting where safe, environment owns applied state, approval-stale-config bug structurally dead. | US-8 |
| 6 | Coordinator extraction + shadow routing (migration steps 3 and 4). Behavior unchanged; the new router runs in shadow and logs disagreements. | US-8 |
| 7 | Lifecycle split + in-place routes (migration steps 5 to 8): workspace refresh with deletions, setModel, Codex mode, session reopen for Claude/Codex tool changes, runtime restart for Pi tool changes, credential refresh so Daytona keys never rebuild. | US-8 |

QA gates: the qa teammate tests each slice when it lands (unit suites plus live stories
on the dev stack). A regression blocks the slice until fixed.

## Phase 3: finalization

Codex code review over the full diff; fix findings. `/write-pr-description` for each
lane PR. Each teammate adds inline PR comments explaining their work. All prose in
simple technical English (ASD-STE100). `/keep-docs-in-sync` for the changed contracts:
the op catalog, the commit endpoint, the runner behavior. Hand the stack to Mahmoud.

## Task list mapping

The shared task list mirrors this plan: task 1 = this workspace and the draft PR;
tasks 2-3 = spikes; task 4 = the phase 1 exit gate; tasks 5-11 = slices 1-7;
task 12 = QA; task 13 = finalization.
