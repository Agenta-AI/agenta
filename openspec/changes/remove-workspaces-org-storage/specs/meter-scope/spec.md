# Meter scope delta

## ADDED Requirements

### Requirement: Meter scope is organization, project, user
`MeterScope` SHALL have the dimensions `organization_id`, `project_id` and `user_id`, with `project_id` requiring `organization_id` and `user_id` requiring `project_id`. `compute_meter_id` SHALL NOT include a workspace part. Entitlements SHALL have no workspace scope.

#### Scenario: Per-user daily quota
- **WHEN** a user retrieves traces in a project
- **THEN** the `TRACES_RETRIEVED` meter SHALL be scoped to organization, project and user.

### Requirement: Re-keying keeps every count
The switch step SHALL re-key every meter row that has a workspace through `compute_meter_id`. When no row has the new id, it SHALL update the row and clear `workspace_id`. When a row has the new id, it SHALL add `value` and `synced` into that row and delete the old row. The contract step SHALL run the same fold before it drops `meters.workspace_id`. Both runs SHALL be idempotent. Both SHALL be `core_ee` revisions.

#### Scenario: Plain re-key
- **WHEN** a `TRACES_RETRIEVED` row for user U on day D has `value = 40` and a workspace
- **THEN** after the re-key one row for U on day D SHALL exist with `value = 40`, the same `synced`, and no workspace.

#### Scenario: Fold after the rollout
- **WHEN** an old pod wrote a row with a workspace and `value = 3` during the switch rollout, and the re-keyed row has `value = 40`
- **THEN** the contract-step fold SHALL leave one row with `value = 43` and `synced` equal to the sum of both rows.

#### Scenario: Billed meter unaffected
- **WHEN** the re-key runs
- **THEN** no organization-scope meter row, including `TRACES_INGESTED`, SHALL change, and the next Stripe report SHALL send the same delta.
