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

The contracts in `contracts/` are the source of truth for every slice. The two tracks
(API, runner) run in parallel but are NOT fully disjoint: the import slices touch
runner approval and parked-state code that the lifecycle slices later refactor. The
sequencing below respects that: import authorization (S3b) lands before the coordinator
extraction (S6) rebases it, or waits for it, whichever is ready first; the team lead
sequences the merge order at that point.

One ordering rule stands above the table: ordered operations do not become
model-visible in the catalog until `read_config` exists. An agent that can be told
"read, then edit" but cannot read would fail every conflict retry.

| Slice | Content | Blocked by |
|---|---|---|
| S1a | The pure engine and the operation schemas, per `contracts/change-set.md` §12's prototype changes. No catalog exposure. | nothing |
| S1b | The commit transaction per `contracts/commit-transaction.md`: one transaction, base check, validation, canonical equality over all persisted fields, no-change response. | product calls 1, 2, 12 |
| S2 | `read_config` per `contracts/read-config.md`, including the editable-scope policy. | product calls 10, 11 for the scope section |
| S3a | The import codec and workspace readers per `contracts/workspace-import.md`. Pure, both platforms. | nothing |
| S3b | The single-use execution authorization per `contracts/execution-authorization.md`, wired into the approval gate. | product call 4 |
| S3c | The approval card: manifest, sizes, digests, diff, executable flags. Minimal frontend. | S3b |
| S4 | The ephemeral `description` on builder tool-call envelopes, shown on tool cards. | nothing |
| S5 | Runner safety + applied-state identity (lifecycle migration steps 1-2). | nothing |
| S6 | Coordinator extraction + shadow routing (steps 3-4). | S5 |
| S7a | Lifecycle extraction into units (step 5), behavior unchanged. | S6 |
| S7b | In-place routes for workspace files and model (step 6, first half). | S7a |
| S7c | Tool-catalog routes with the trusted acknowledgement channel per `contracts/adapter-matrix.md`. | S7a, spike S2 verdicts |
| S7d | MCP reopen with positive native-history verification. | S7a |
| S7e | Credential and provider reconciliation, including the Daytona creation-identity split (steps 8-9). | S7a |

QA gates: the qa teammate tests each slice when it lands (unit suites plus live stories
on the dev stack). A regression blocks the slice until fixed.

### Rollout and compatibility

- **Deployment order:** API first (it accepts both delta forms), then the SDK catalog
  (it advertises the new schema), then runner images. Each step is backward-compatible
  with the previous one.
- **Kill switch:** one API-side setting disables the ordered delta form and
  `value_from` acceptance; the catalog reads it and falls back to advertising the
  legacy schema. The runner needs no switch of its own: without the catalog schema, no
  model emits the new form.
- **Legacy DTO compatibility:** `extra="forbid"` applies to the new operations form
  only. The legacy `set`/`remove` form keeps its current tolerance, so old playbooks
  and stored callers do not start failing.
- **Cross-language fixtures:** the canonical tool key and the canonical JSON
  serialization get golden fixtures shared by the Python engine and the TypeScript
  runner, so the two implementations cannot drift silently.

## Phase 3: finalization

Codex code review over the full diff; fix findings. `/write-pr-description` for each
lane PR. Each teammate adds inline PR comments explaining their work. All prose in
simple technical English (ASD-STE100). `/keep-docs-in-sync` for the changed contracts:
the op catalog, the commit endpoint, the runner behavior. Hand the stack to Mahmoud.

## Task list mapping

The shared task list mirrors this plan: task 1 = this workspace and the draft PR;
tasks 2-3 = spikes; task 4 = the phase 1 exit gate; tasks 5-11 = slices 1-7;
task 12 = QA; task 13 = finalization.
