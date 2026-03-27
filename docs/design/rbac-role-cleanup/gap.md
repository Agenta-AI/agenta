# Gap Analysis: Current State vs Proposed State

## Gap 1: The role taxonomy is not minimal or consistent

### Current

- backend canonical roles are `owner`, `viewer`, `editor`, `evaluator`, `workspace_admin`, `deployment_manager`
- tests and run tooling already use `admin` in some places

### Desired

- one minimal role set with one canonical name per concept
- `owner`, `admin`, `manager`, `evaluator`, `auditor`

### Required change

- update every role enum, literal, description, and comparison
- replace `workspace_admin` with `admin` consistently

## Gap 2: API key access is assigned to the wrong roles

### Current

- `viewer`, `evaluator`, and `deployment_manager` can see API keys
- `editor` and `workspace_admin` can edit API keys
- `deployment_manager` cannot edit API keys

### Desired

- API key management is limited to `owner`, `admin`, and `manager`
- `evaluator` and `auditor` should not see API keys
- API keys owned by users who end up as `evaluator` or `auditor` are deleted during migration

### Required change

- update `Permission.default_permissions(role)` in the RBAC source of truth
- add migration cleanup for disallowed existing API keys
- review downstream tests that assume current visibility/edit behavior

## Gap 3: Frontend authorization is too narrow

### Current

- only invite/role-management flows use a frontend role helper
- the settings sidebar always shows `API Keys`
- the API Keys page always renders its list/create/delete UI

### Desired

- frontend can answer project-scoped permission questions with a reusable helper
- API Keys UI is hidden or disabled for roles without permission

### Required change

- add a generic permission helper in the web app
- use it in settings navigation, settings routing, and the API Keys page

## Gap 4: Role data is duplicated across persistence layers

### Current

- the same role value exists in workspace membership rows, project membership rows, and invitation rows
- workspace roles are mirrored into projects
- multiple flows still default to `viewer` or `editor`

### Desired

- all persisted role strings are normalized to the new names
- sync and invite flows only emit canonical values
- API key data is cleaned up so downgraded roles do not retain usable keys created under the old policy

### Required change

- data migration for `workspace_members`, `project_members`, and `project_invitations`
- data migration or cleanup step for API keys owned by future `evaluator`/`auditor` users
- update defaults such as demo-role assignment and invitation defaults

## Gap 5: `workspace_admin` has hidden behavior beyond naming

### Current

- `workspace_admin` is not just a label; it is part of permission checks and operational behavior
- workspace-admin notifications and member-management checks compare directly against `workspace_admin`

### Desired

- those behaviors should work through `admin` after the cleanup

### Required change

- replace hard-coded `workspace_admin` checks in backend and frontend helpers
- review operational flows such as workspace admin email notifications

## Gap 6: Test and tooling assets are already drifting

### Current

- test tooling uses a mix of `admin`, `editor`, and `viewer`

### Desired

- the implementation code and test assets speak the same role language as the backend
- clients should move directly to canonical role names with no backward-compatibility layer

### Required change

- update markers, CLI flags, fixtures, and test tags

## Gap 7: Runtime effect differs from rollout scope

### Current

- when RBAC entitlement is disabled, many permission checks broadly allow access for non-demo members

### Desired

- apply the role, migration, and frontend changes in all environments
- be explicit that the access-control effect will only materially change behavior where RBAC is actually enforced
- avoid confusing rollout scope with runtime authorization effect

### Required change

- document this runtime distinction clearly
- avoid assuming that a role rename alone changes access everywhere

## Gap 8: Direct cutover requires coordinated updates

### Current

- persisted rows, scripts, and invites may still send old role strings

### Desired

- a strict cutover where only new canonical role names are accepted
- no runtime aliasing for old role strings
- one single release that lands code, migration, and UI changes together

### Required change

- update all callers in the same release
- rely on data migration and direct code updates, not API-side aliasing or client-side compatibility shims
