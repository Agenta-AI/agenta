# Design: organization credentials (M5)

## Context

The `secrets` table already allows an organization owner, and EE stores SSO secrets that way. M5 adds inheritance, override, the EE project limit, value confinement and an organization access decision. Shared rules: CONTRACT.md sections 6, 8 and 12. Code facts: `research-organization-credentials.md`.

## Decisions

### D1. Owner model: one DTO over typed columns

Core uses `SecretOwner(kind, id)` (CONTRACT.md section 8). Storage keeps `project_id` and `organization_id` with their cascading foreign keys; the DAO maps the kind to the column. The check constraint `ck_secrets_single_owner` (`num_nonnulls(project_id, organization_id) = 1`) puts the existing DAO rule into the database. `SecretOwnerKind` moves to `core/secrets/enums.py`.

M7 adds `secrets.user_id`. A user row also carries `organization_id`, so M7 replaces the constraint and adds `AND user_id IS NULL` to the organization slug index.

### D2. Inheritable kinds

`INHERITABLE_KINDS = {provider_key, custom_provider}`. A `custom_provider` that the gateway does not serve (today Bedrock) is refused at creation, because its value could reach a run only in plaintext. `custom_secret` (plaintext by design), `subscription_provider` (not supported for organizations) and the feature-owned kinds stay project-owned. `sso_provider` stays organization-only and is never inherited.

### D3. Values never leave the API

The LLM gateway resolves inherited credentials in process, and the sandbox receives only a gateway-audience credential. HTTP reads treat inherited rows as follows:

- `GET /secrets/` lists project rows, as today. With `include_inherited=true` it adds inherited rows, without values. A request with the `secret-resolve` grant never receives inherited rows.
- `GET /secrets/{id_or_slug}`, `PUT` and `DELETE /secrets/{id}` stay project-only.
- `/organization-secrets/*` never returns a value, also to owners. Admins replace values; they do not read them back.

So the plaintext paths (the SDK vault fallback and the legacy vault middleware) see only project rows, for every SDK version. Only `/m` sends `include_inherited`, so existing clients see no change.

### D4. Resolution

In-process readers use one effective set: project rows, then available inheritable organization rows whose slug no project row uses.

- Slug reference: project row, else organization row, else the existing not-found error. M7 keeps this meaning (CONTRACT.md section 8).
- No name: the project's candidates for the provider first; organization candidates only when the project has none. The existing tie rules apply inside the group. The API makes this choice in gateway mode, so the SDK does not change.
- `BoundSecretRef` (an id): only that row, while it is available. Never a substitute.
- A project row may shadow an inherited slug only with the same kind and, for `provider_key`, the same provider family.
- `uq_secrets_organization_id_slug` makes organization slugs unique. SSO rows have no slug.

`ResolvedSecret.owner` reports the real owner for audit and usage labels.

### D5. Inherited custom providers have no endpoint row

When `_namespace_of_slug` finds no project endpoint row for a custom slug, the gateway looks for an available inherited `custom_provider` with that slug and builds the target with `map_custom_provider_secret_to_endpoint`, pinned to its id. No endpoint row is written, so nothing fans out to every project or drifts. A project endpoint row with the same slug wins. The tenancy rule `check_secret_is_owned_by_project` does not change.

### D6. EE project limit

`secrets.availability` is `all_projects` (default) or `selected_projects`, with the join table `secret_projects`. The explicit mode avoids "no rows means every project": when the last selected project is deleted, the credential reaches no project. OSS has the same schema and filter, but refuses `selected_projects`. EE allows it with the `Flag.RBAC` entitlement.

### D7. One effective-list method

`VaultService.list_effective_secrets(organization_id, project_id)` and its by-id and by-slug forms serve every in-process reader. The organization list has its own cache entry (namespace `list_organization_secrets`, key `{organization_id}`), invalidated by organization writes and limit changes. The merge runs in memory.

### D8. Organization access decision

M5 owns organization-scoped decisions (CONTRACT.md section 6).

```python
class OrganizationAction(str, Enum):
    MANAGE_ORGANIZATION_SECRETS = "manage_organization_secrets"

async def decide_organization(*, principal: PrincipalRef, credential: RequestCredential,
                              authority: RunAuthority | None, organization_id: UUID,
                              action: OrganizationAction) -> Decision: ...
# RequestCredential: bearer_session | api_key | run_credential, set by the auth middleware
```

Rule, in order:
1. The credential is `bearer_session`, `authority` is None, and the principal is a human, else `missing_capability`. So every API key (including an M6 personal key, whose principal is a human) and every run credential is refused (CONTRACT.md section 6). An unknown credential is refused.
2. The human has an `organization_members` row in the organization, else `not_member`.
3. The organization role is `owner` or `admin`, else `missing_capability`. M1 guarantees the owner an `owner` row.

The rule is the same in OSS and EE. It reads no entitlement, project row, project role or custom role, so the EE no-RBAC bypass and the owner shortcut of project RBAC do not apply. It lives in `api/oss/src/core/access/` and returns M2's `Decision`. Routes read `request.state.principal` and `request.state.authority` (M2), `request.state.credential`, and `request.state.organization_id`.

## Routes

`/organization-secrets/`: `POST /`, `GET /`, `GET /{secret_id}`, `PUT /{secret_id}` (keeps the value when omitted), `DELETE /{secret_id}`, and `PUT /{secret_id}/projects` (EE limit). Every route requires `MANAGE_ORGANIZATION_SECRETS`. The separate prefix avoids clashes with `GET /organizations/{organization_id}` and `GET /secrets/{secret_id_or_slug}`.

## Data structures

| Change | Notes |
| --- | --- |
| `secrets.availability VARCHAR NOT NULL DEFAULT 'all_projects'` | read only for organization rows |
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

@dataclass(frozen=True)
class SecretOwner:
    kind: SecretOwnerKind
    id: UUID

class SecretAvailability(str, Enum):
    ALL_PROJECTS = "all_projects"
    SELECTED_PROJECTS = "selected_projects"

class VaultService:
    async def list_effective_secrets(self, *, organization_id, project_id) -> list[SecretResponseDTO]: ...
    async def get_effective_secret_by_id(self, *, organization_id, project_id, secret_id) -> SecretResponseDTO | None: ...
    async def get_effective_secret_by_slug(self, *, organization_id, project_id, slug) -> SecretResponseDTO | None: ...
    # plus create/update/delete_organization_secret and set_organization_secret_availability
```

`SecretsDAOInterface` methods take `owner: SecretOwner` and gain `list_inheritable` and `set_availability`. `SecretResponseDTO` gains `owner` and `availability`; the fail-closed validator forces `write_only=True` for organization rows. `SecretsResolver` reads through the effective methods and adds `inherited_custom_provider_by_slug`. Keyword arguments let M7 add the principal's user without changing callers. EE SSO callers keep their current service parameters.

## Migration and mixed-version behavior

One `core_oss` revision; EE runs it, so there is no `core_ee` copy. No step needs the destructive label.

1. Add `availability` with its server default; create `secret_projects`.
2. Delete rows with both owner columns NULL; log the count.
3. Stop with a message if duplicate organization slugs exist (none expected).
4. Create both indexes concurrently in an autocommit block.
5. Add the check constraint `NOT VALID`, then validate it (reads and writes continue).

| Case | Behavior |
| --- | --- |
| Old API pods on the new schema | They read organization rows by id only, ignore the new column and table, and never return an organization value. A gateway call that an old pod serves does not see organization credentials, so a run can fail with "no key" until the rollout ends. |
| New pods on old data | Not possible: the migration runs before new pods start. |
| Old SDK or runner, new API | No change: without `include_inherited`, responses are today's responses. |

M5 adds no durable work type.

## Risks

- A project that adds its own key stops using the organization key for unnamed calls (the intended override; the UI marks the inherited row).
- Organization credentials do not work without the gateway, for Bedrock, or in legacy completion and chat apps (D3).
- One-way: the override key is the slug.

## Open questions

1. Legacy completion and chat apps cannot use organization credentials. Recommendation: accept for M5; revisit when they route through the gateway.
2. The override key is the slug, not the display name. Recommendation: slug (stable; names change).
3. Organization admins, not only owners, manage organization credentials, in OSS too. Recommendation: yes, one rule for both editions.
4. The EE project limit is gated by `Flag.RBAC`. Recommendation: reuse it; no new plan flag.
