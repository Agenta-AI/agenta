# Meter scope delta

## ADDED Requirements

### Requirement: Meter scope is organization, project, user
`MeterScope` SHALL have the dimensions `organization_id`, `project_id` and `user_id`, with `project_id` requiring `organization_id` and `user_id` requiring `project_id`. `compute_meter_id` SHALL NOT include a workspace part. Entitlements SHALL have no workspace scope.

#### Scenario: Plan override that names the workspace scope
- **WHEN** an operator plan sets `scope: "workspace"` on a quota
- **THEN** Agenta SHALL load it as organization scope and log one warning.

#### Scenario: Per-user daily quota
- **WHEN** a user retrieves traces in a project
- **THEN** the `TRACES_RETRIEVED` meter SHALL be scoped to organization, project and user.

### Requirement: Re-keying keeps every count
The switch step SHALL re-key every meter row that has a workspace through `compute_meter_id`. When no row has the new id, it SHALL update the row and clear `workspace_id`. When a row has the new id, it SHALL add `value` and `synced` into that row and delete the old row. The stop-reading step SHALL run the same fold before readers stop filtering on `meters.workspace_id`. Both runs SHALL be idempotent. Both SHALL be `core_ee` revisions.

#### Scenario: Plain re-key
- **WHEN** a `TRACES_RETRIEVED` row for user U on day D has `value = 40` and a workspace
- **THEN** after the re-key one row for U on day D SHALL exist with `value = 40`, the same `synced`, and no workspace.

#### Scenario: Fold after the rollout
- **WHEN** an old pod wrote a row with a workspace and `value = 3` during the switch rollout, and the re-keyed row has `value = 40`
- **THEN** the stop-reading-step fold SHALL leave one row with `value = 43` and `synced` equal to the sum of both rows.

#### Scenario: Row written by an old pod after the re-key
- **WHEN** an accept-step pod writes a `TRACES_RETRIEVED` row with a workspace after the switch migration ran
- **THEN** switch-step pods SHALL NOT read it as the current row, SHALL mark it synced by its stored id, and the stop-reading-step fold SHALL add it into the re-keyed row.

#### Scenario: Report during the re-key
- **WHEN** a usage report runs when the switch migration starts
- **THEN** the migration SHALL wait for it to end, no report SHALL start until the re-key ends, and every count and `synced` value SHALL stay exact.

#### Scenario: Workspace-only meter row
- **WHEN** the switch migration finds a meter row that has a workspace and no project
- **THEN** it SHALL stop before it changes any row.

#### Scenario: Billed meter unaffected
- **WHEN** the re-key runs
- **THEN** no organization-scope meter row, including `TRACES_INGESTED`, SHALL change, and the next Stripe report SHALL send the same delta.
