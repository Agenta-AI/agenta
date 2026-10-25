# Design: organization credentials (M5)

## Context

The `secrets` table already allows an organization owner, and EE stores SSO secrets that way. M5 adds inheritance, override, the EE project limit, value confinement and an organization access decision. Shared rules: CONTRACT.md sections 6, 8 and 12. Code facts: `research-organization-credentials.md`. The interface details are in `docs/design/sharing-program/interfaces/m5/`.

## Decisions

### D1. Owner model: one DTO over typed columns

Core uses `SecretOwner(kind, id)` (CONTRACT.md section 8). It is a frozen pydantic model, not a dataclass, because it rides in cached and serialized DTOs. There is one class, in `core/secrets/dtos.py`; the gateway's own `SecretOwner(kind, user_id)` is deleted and the gateway imports the core one. Storage keeps `project_id` and `organization_id` with their cascading foreign keys; the DAO maps the kind to the column. The check constraint `ck_secrets_single_owner` (`num_nonnulls(project_id, organization_id) = 1`) puts the existing DAO rule into the database. `SecretOwnerKind` (`organization`, `project`, `user`) moves to `core/secrets/enums.py`.

M7 adds `secrets.user_id`. A user row also carries `organization_id`, so M7 replaces the constraint and adds `AND user_id IS NULL` to the organization slug index.

### D2. Inheritable kinds

`INHERITABLE_KINDS = {provider_key, custom_provider}`. An organization `provider_key` must name an LLM provider family. A `custom_provider` whose deployment kind the gateway does not serve is refused at creation, at update and at resolution, because its value could reach a run only in plaintext. The served deployments are an explicit set, `LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS`, pinned by a test against the passthrough auth table; today Bedrock and SageMaker are not served. `custom_secret` (plaintext by design), `subscription_provider` (not supported for organizations) and the feature-owned kinds stay project-owned. `sso_provider` stays organization-only and is never inherited. Every organization DAO operation filters `kind IN INHERITABLE_KINDS`, so an SSO id answers 404 on every organization route.

An organization credential value (the primary value and every credential extras value) is stripped of surrounding whitespace and must then be at least 8 characters (`MIN_SCANNED_CREDENTIAL_LENGTH`), so the gateway's echo scan covers every organization value. The passthrough adapter scans every value of an organization secret, not only the injected auth headers.

### D3. Values never leave the API

The LLM gateway resolves inherited credentials in process, and the sandbox receives only a gateway-audience credential. HTTP reads treat inherited rows as follows:

- `GET /secrets/` lists project rows, as today. With `include_inherited=true` it adds inherited rows, without values. A request with the `secret-resolve` grant never receives inherited rows; the parameter is ignored for it.
- `GET /secrets/{id_or_slug}`, `PUT` and `DELETE /secrets/{id}` stay project-only.
- `/organization-secrets/*` never returns a value or a partial value (no key preview), also to owners. Admins replace values; they do not read them back.
- Every model that holds a value sets `hide_input_in_errors`, and the secrets DAO raises domain errors without SQL parameters, so no value reaches a log.

So the plaintext paths (the SDK vault fallback and the `VaultMiddleware` of legacy completion and chat apps, the prompt playground and AI evaluators) see only project rows, for every SDK version. Only `/m` sends `include_inherited`, so existing clients see no change.

### D4. Resolution

In-process readers use one effective set: project rows, then available inheritable organization rows whose slug no project row uses.

- Slug reference: project row, else organization row, else the existing not-found error. M7 keeps this meaning (CONTRACT.md section 8).
- No name: the project's candidates for the provider first; organization candidates only when the project has none. The existing tie rules apply inside the group. The API makes this choice in gateway mode, so the SDK does not change.
- `BoundSecretRef` (an id) carries `owner_kind` (default `project`). A project reference keeps today's read; an organization reference answers only that row while it is available. Never a substitute.
- Inheritance uses the organization that the project row names. A request whose organization differs inherits nothing.
- Only the LLM plane reads organization rows. The resolver is built per plane (`SecretsResolver(plane=LLM|MCP)`); the MCP plane is today's project-only code.
- The resolve path for a bare slug runs one pass (`_resolve_slug_target`): custom target, builtin, provider family, then a slugged `provider_key` row. It gives today's answers with fewer reads.
- A project row may shadow an inherited slug only with the same kind and, for `provider_key`, the same provider family. The rule is checked in SQL against the database on every write that can create the pair, in `SERIALIZABLE` transactions with one retry, then 409.
- `uq_secrets_organization_id_slug` makes organization slugs unique. SSO rows have no slug.

`ResolvedSecret.owner` reports the real owner for audit and usage labels.

### D5. Inherited custom providers have no endpoint row

The custom target lookup is one statement (`LLMEndpointsDAO.fetch_custom_target_by_slug`): the project endpoint row with the slug, else the available, unshadowed inherited `custom_provider` with that slug of the project row's organization. The gateway builds the target from the inherited row with `map_custom_provider_secret_to_endpoint`, pinned to its id, and carries the row so the relay reads nothing more. No endpoint row is written, so nothing fans out to every project or drifts. A project endpoint row with the same slug wins. The tenancy rule `check_secret_is_owned_by_project` does not change.

### D6. EE project limit

`secrets.availability` is `all_projects` (default) or `selected_projects`, with the join table `secret_projects`. The explicit mode avoids "no rows means every project": when the last selected project is deleted, the credential reaches no project. OSS has the same schema and filter, but refuses `selected_projects`. EE allows it with the `Flag.RBAC` entitlement (`ProjectLimitsInterface`: OSS `NoProjectLimits`, EE `EntitlementProjectLimits`). `all_projects` is always allowed.

Organization create, update and availability change each run in one transaction: conflict check, row, availability and `secret_projects` (same-organization projects only). Any refusal leaves no change. Cache invalidation runs after the commit.

### D7. One cache entry per project

`VaultService.list_effective_secrets(organization_id, project_id)` and its by-id and by-slug forms serve every in-process reader. The effective set of a project lives in ONE cache entry (namespace `effective_secrets`, key holding the full project id, value carrying the project id and the project row's organization), read through today's `get_cache` path and filled by one statement that also reads the available organization rows. There is no separate organization entry, so every cache mode costs what today's project vault read costs. The entry stays in the request memo for the rest of the request. Organization writes delete each project entry of the organization after the commit; project writes keep today's project-wide invalidation. The merge runs in memory.

### D8. Organization access decision

M5 owns organization-scoped decisions (CONTRACT.md section 6).

```python
class OrganizationAction(str, Enum):
    MANAGE_ORGANIZATION_SECRETS = "manage_organization_secrets"

async def decide_organization(*, access: RequestAccess | None, organization_id: UUID,
                              action: OrganizationAction) -> Decision: ...
# RequestAccess (M2): principal, authority, credential_kind, acting_user_id, envelope
```

Rule, in order:
1. `credential_kind` is `bearer_session`, the request has no run envelope, the principal is a human and it is the acting user, else `missing_capability`. So every API key (including an M6 personal key, whose principal is a human) and every run credential is refused (CONTRACT.md section 6). An unknown credential or no request access is refused. A Bearer request carries an authority built from the session (M2 code), so the run marker is the envelope, not the authority.
2. The human has an `organization_members` row in the organization (read uncached), else `not_member`.
3. The organization role is `owner` or `admin`, else `missing_capability`. M1 guarantees the owner an `owner` row.

The rule is the same in OSS and EE. It reads no entitlement, project row, project role or custom role, so the EE no-RBAC bypass and the owner shortcut of project RBAC do not apply. It lives in `api/oss/src/core/access/organizations.py` and returns M2's `Decision`. Routes read `get_request_access()` and `request.state.organization_id`.

## Routes

`/organization-secrets/`: `POST /`, `GET /`, `GET /{secret_id}`, `PUT /{secret_id}` (keeps the value when omitted), `DELETE /{secret_id}`, and `PUT /{secret_id}/projects` (EE limit). Every route requires `MANAGE_ORGANIZATION_SECRETS`. The separate prefix avoids clashes with `GET /organizations/{organization_id}` and `GET /secrets/{secret_id_or_slug}`. Create accepts an optional slug; without one the server derives `<name>-<12 hex>`. Responses carry `owner`, `availability` and `selected_project_ids`.

## Data structures

| Change | Notes |
| --- | --- |
| `secrets.availability VARCHAR NOT NULL DEFAULT 'all_projects'` | read only for organization rows; `ck_secrets_availability` |
| `ck_secrets_single_owner` | `NOT VALID`, then validated after the orphan cleanup |
| `uq_secrets_organization_id_slug` on `(organization_id, slug) WHERE project_id IS NULL AND slug IS NOT NULL` | concurrent |
| `ix_secrets_organization_id` on `organization_id WHERE project_id IS NULL` | concurrent |
| `secret_projects(secret_id, project_id)` | PK on both, cascading FKs, index on `project_id`; the DAO refuses a project of another organization |

## Interfaces

```python
# api/oss/src/core/secrets/
class SecretOwnerKind(str, Enum):
    ORGANIZATION = "organization"
    PROJECT = "project"
    USER = "user"                 # M7; no rows in M5

class SecretOwner(BaseModel):     # frozen
    kind: SecretOwnerKind
    id: UUID

class SecretAvailability(str, Enum):
    ALL_PROJECTS = "all_projects"
    SELECTED_PROJECTS = "selected_projects"

class VaultService:
    async def list_effective_secrets(self, *, organization_id, project_id) -> list[SecretResponseDTO]: ...
    async def get_effective_secret_by_id(self, *, organization_id, project_id, secret_id, owner_kind) -> SecretResponseDTO | None: ...
    async def get_effective_secret_by_slug(self, *, organization_id, project_id, slug) -> SecretResponseDTO | None: ...
    async def list_inherited_secrets(self, *, organization_id, project_id) -> list[InheritedSecret]: ...
    # plus list/fetch/create/update/delete_organization_secret and set_organization_secret_availability
```

`SecretsDAOInterface` methods take `owner: SecretOwner` and gain `load_effective` (one statement) and the organization operations. `SecretResponseDTO` gains `owner`, `availability` and `selected_project_ids`; the fail-closed validator forces `write_only=True` for organization rows. `SecretsResolver` takes a `plane`; the LLM instance reads through the effective methods. Keyword arguments let M7 add the principal's user without changing callers. EE SSO callers keep their current service parameters.

Audit: `gateways.called` gains `secret_owner_kind`; organization writes publish `organization_secrets.changed` with ids and kinds only.

## Migration and mixed-version behavior

One `core_oss` revision, `oss000000054`; EE runs it, so there is no `core_ee` copy. No step needs the destructive label.

1. Add `availability` with its server default and its check (`NOT VALID`); create `secret_projects`.
2. Delete rows with both owner columns NULL; log the count.
3. Stop with a message if a row names both owners or duplicate organization slugs exist (none expected). The stop rolls the delete back.
4. Add `ck_secrets_single_owner` `NOT VALID`.
5. Create both indexes concurrently in an autocommit block (an invalid leftover of an interrupted run is dropped and built again), then validate both constraints.

| Case | Behavior |
| --- | --- |
| Old API pods on the new schema | They read organization rows by id only, ignore the new column and table, and never return an organization value. A gateway call that an old pod serves does not see organization credentials, so a run can fail with "no key" until the rollout ends. Their project writes clear every cache entry of the project, the new one included. |
| New pods on old data | Not possible: the migration runs before new pods start. |
| Old SDK or runner, new API | No change: without `include_inherited`, responses are today's responses plus the additive `owner` and `availability` fields. |

M5 adds no durable work type.

## Risks

- A project that adds its own key stops using the organization key for unnamed calls (the intended override; the UI marks the inherited row).
- Organization credentials do not work without the gateway, for Bedrock or SageMaker, or in legacy completion and chat apps, the prompt playground and AI evaluators (every `VaultMiddleware` workflow) (D3).
- `SERIALIZABLE` writes can abort under concurrency; one internal retry, then 409.
- One-way: the override key is the slug.

## Decided questions

1. Legacy completion and chat apps, the prompt playground and AI evaluators (every `VaultMiddleware` workflow) cannot use organization credentials (owner, 2026-10-25). Revisit when they route through the gateway.
2. The override key is the slug, not the display name (owner).
3. Organization owners and admins manage organization credentials, in both editions, with one rule (owner, 2026-10-25).
4. The EE project limit is gated by `Flag.RBAC`; no new plan flag (owner, 2026-10-25).
