# Design: organization credentials (M5)

## Context

The `secrets` table already allows an organization owner, and EE stores SSO secrets that way. M5 adds organization connections that an agent names by scope and slug, the EE project limit, value confinement and an organization access decision. Nothing is inherited or overridden automatically (owner decision, option B, 2026-10-26). Shared rules: CONTRACT.md sections 6, 8 and 12. Code facts: `research-organization-credentials.md`. The interface details are in `docs/design/sharing-program/interfaces/m5/`.

## Decisions

### D1. Owner model: one DTO over typed columns

Core uses `SecretOwner(kind, id)` (CONTRACT.md section 8). It is a frozen pydantic model, not a dataclass, because it rides in cached and serialized DTOs. There is one class, in `core/secrets/dtos.py`; the gateway's own `SecretOwner(kind, user_id)` is deleted and the gateway imports the core one. Storage keeps `project_id` and `organization_id` with their cascading foreign keys; the DAO maps the kind to the column. The check constraint `ck_secrets_single_owner` (`num_nonnulls(project_id, organization_id) = 1`) puts the existing DAO rule into the database. `SecretOwnerKind` (`organization`, `project`, `user`) moves to `core/secrets/enums.py`.

M7 adds `secrets.user_id`. A user row also carries `organization_id`, so M7 replaces the constraint and adds `AND user_id IS NULL` to the organization slug index.

### D2. Shareable kinds

`ORGANIZATION_SECRET_KINDS = {provider_key, custom_provider, subscription_provider}`; the gateway serves `ORGANIZATION_GATEWAY_KINDS = {provider_key, custom_provider}` only (see D9 for subscription logins). An organization `provider_key` must name an LLM provider family. A `custom_provider` whose deployment kind the gateway does not serve is refused at creation, at update and at resolution, because its value could reach a run only in plaintext. The served deployments are an explicit set, `LLM_GATEWAY_SERVED_DEPLOYMENT_KINDS`, pinned by a test against the passthrough auth table; today Bedrock and SageMaker are not served. `custom_secret` (plaintext by design) and the feature-owned kinds stay project-owned. `sso_provider` stays organization-only and is never shared. Every organization DAO operation filters `kind IN ORGANIZATION_SECRET_KINDS`, so an SSO id answers 404 on every organization route.

An organization credential value (the primary value and every credential extras value) is stripped of surrounding whitespace and must then be at least 8 characters (`MIN_SCANNED_CREDENTIAL_LENGTH`), so the gateway's echo scan covers every organization value. The passthrough adapter scans every value of an organization secret, not only the injected auth headers.

### D3. Values never leave the API

The LLM gateway resolves organization connections in process, and the sandbox receives only a gateway-audience credential. HTTP reads treat organization rows as follows:

- `GET /secrets/` lists project rows, as today. With `include_organization=true` it adds the organization rows available to the project, without values and without previews. A request with the `secret-resolve` grant never receives organization rows; the parameter is ignored for it.
- `GET /secrets/{id}`, `PUT` and `DELETE /secrets/{id}` answer a project caller exactly as before. They reach an organization row only for an owner or admin of the organization (route section).
- An organization row never returns a value or a partial value (no key preview), also to owners. Admins replace values; they do not read them back.
- `POST /providers/probe` tests an organization connection as saved for any member of a project it is available to (`secret_scope = organization`); a probe that changes a stored field needs the organization access decision. The value goes from the API to the provider only.
- Every model that holds a value sets `hide_input_in_errors`, and the secrets DAO raises domain errors without SQL parameters, so no value reaches a log.

So the plaintext paths (the SDK vault fallback and the `VaultMiddleware` of legacy completion and chat apps, the prompt playground and AI evaluators) see only project rows, for every SDK version.

### D4. Resolution by scope and slug

An agent names its connection with a scope: `project` (the default, also for agents saved before M5) or `organization`.

- Project scope, with a slug: today's resolution over the project's rows only (custom endpoint row, builtin, provider family, a slugged `provider_key` row), in one pass (`_resolve_slug_target`). It never reaches an organization row.
- No connection: the project's candidates for the provider, with the existing tie rules. An organization row is never a candidate. Agents saved before M5 keep this behavior with no data change.
- Organization scope: only the shareable organization row with that slug that is available to the project, from the organization the project row names. Otherwise a typed `connection_not_found` (with the scope and slug), so a later "needs configuration" state can use it. It resolves to the gateway namespace `organization` (`/gateways/llms/organization/{slug}/v1/...`): a `provider_key` routes like a standard endpoint of its family, a `custom_provider` builds its target from the row (no endpoint row is written). Both are pinned to the row, and the target carries it, so the relay reads nothing more.
- `BoundSecretRef` (an id) carries `owner_kind` (default `project`). A project reference keeps today's read; an organization reference answers only that row while it is available. Never a substitute.
- Only the LLM plane reads organization rows. The resolver is built per plane (`SecretsResolver(plane=LLM|MCP)`); the MCP plane is project-only.
- Project and organization rows are two slug spaces (`uq_secrets_project_id_slug`, `uq_secrets_organization_id_slug`). No write checks one against the other, so no write needs a `SERIALIZABLE` transaction.

`ResolvedSecret.owner` reports the real owner for audit and usage labels.

### D5. Fail closed across versions

An organization connection is saved as `{"mode": "agenta", "scope": "organization", "namespace": "organization", "slug": ...}`. The SDK `Connection` model fills the namespace when it is omitted, and the commit check refuses an incomplete one (`invalid_agent_connection`). A services image older than M5 does not know the `organization` namespace and refuses the connection instead of reading the slug as a project connection. Without the gateway, the SDK refuses an organization connection (`organization_connection_unavailable`) and never reads the vault for it. The runner holds no provider key in gateway mode, so its version does not matter here.

Every save path writes the connection explicitly: the `/m` model picker and the agent create path write `{"mode": "agenta", "scope": "project"}` for the project default, and the template compiler writes it when the base revision names none. A save never checks whether a named item exists or is usable (owner decision, 2026-10-26); a `self_managed` connection commits with or without a slug, as on v0.125.0, and the runner decides at run time.

### D6. EE project limit

`secrets.availability` is `all_projects` (default) or `selected_projects`, with the join table `secret_projects`. The explicit mode avoids "no rows means every project": when the last selected project is deleted, the credential reaches no project. OSS has the same schema and filter, but refuses `selected_projects`. EE allows it with the `Flag.RBAC` entitlement (`ProjectLimitsInterface`: OSS `NoProjectLimits`, EE `EntitlementProjectLimits`). `all_projects` is always allowed.

A new connection starts with `all_projects`. Organization create, update and availability change each run in one transaction: row, availability and `secret_projects` (same-organization projects only). Any refusal leaves no change. Cache invalidation runs after the commit.

### D7. One cache entry per project

A project's rows and the organization rows available to it live in ONE cache entry (namespace `effective_secrets`, key holding the full project id, value carrying the project id and the project row's organization), read through today's `get_cache` path and filled by one statement. There is no separate organization entry, so every existing path costs what today's project vault read costs. The entry stays in the request memo for the rest of the request. Organization writes delete each project entry of the organization after the commit; project writes keep today's project-wide invalidation.

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

### D9. Organization subscription logins (owner decision, 2026-10-26)

An organization may hold a ChatGPT or Claude subscription login. It is created and signed in only by an organization owner or admin (`POST /secrets/` with `scope = organization`, then the `login-attempts` and `subscription-token` routes on the row, behind the organization decision), named with its owner ("ChatGPT (Organization)") and available to all projects by default. An agent uses it only when it names it: `{"mode": "self_managed", "scope": "organization", "namespace": "organization", "slug": ...}`.

A subscription login is the one organization value that leaves the API, because the harness authenticates itself with it. Once released to a run, it behaves exactly like a project subscription login of the same provider, on the same engines (owner decision, 2026-10-27). A project ChatGPT login already runs on the `inprocess`, `daytona` and `local` engines, and a project Claude setup-token travels as an environment credential; an organization login does the same. An earlier draft kept organization logins on the `inprocess` engine only and refused organization Claude logins. The owner removed both limits.

Where each check runs, given runner and services version skew:

- The API releases the login only to the run's own credential (`secret-resolve` grant) of a project it is available to, from `GET /secrets/{slug}?scope=organization`. The plaintext vault list never carries it.
- The SDK puts the login in its own wire field, `organizationSubscription`, and puts the marker `{"fence": "organization"}` in `subscription`. A runner older than M5 does not read `organizationSubscription`; it reads the marker as an unusable subscription and refuses the run (`SUBSCRIPTION_INVALID_MESSAGE`), so it never runs the login and never falls back to an operator login. An M5 runner accepts the marker only beside `organizationSubscription`.
- The runner checks the shape when it builds the run plan (Pi with a ChatGPT login, runtime-provided credentials, no project `subscription` on the same run) and refuses otherwise. On every engine it then builds the same plan as for a project login, owned by the organization.
- An organization Claude login resolves in the SDK like a project one: its setup-token travels as an environment credential. A runner older than M5 that receives it uses that token, which is the login the agent named.

Upkeep writes the organization row: the runner sends refreshes and failures with `?scope=organization`, and the API checks that the login is available to the run's project. A device login attempt carries `organizationId` instead of `projectId`, and its outcome names exactly one owner.

## Routes

Organization rows use the `/secrets/` routes (owner decision, 2026-10-27: no copied routes):

- `POST /secrets/` with `scope = organization` creates one, with optional `availability` and `project_ids`. Create accepts an optional slug; without one the server derives `<name>-<12 hex>`.
- `GET /secrets/?scope=organization` lists every connection of the organization.
- `GET`, `PUT` and `DELETE /secrets/{secret_id}`, `PUT /secrets/{secret_id}/subscription-token` and the `login-attempts` routes take `?scope=organization` for an organization row (owner or admin); without it they are the project routes, as before.
- `PUT /secrets/{secret_id}/projects` sets the EE limit.
- `GET /secrets/{slug}?scope=organization` with the run's own credential (`secret-resolve` grant) releases an organization subscription login to the run.
- `GET /projects/?scope=organization` lists every project of the organization for the project choice.

Every organization route and lookup requires `MANAGE_ORGANIZATION_SECRETS`, except the release read, which needs the run's own credential. Responses on organization rows carry `owner`, `availability` and `selected_project_ids`.

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
    async def get_organization_connection(self, *, organization_id, project_id, slug) -> SecretResponseDTO | None: ...
    async def get_connection_secret_by_id(self, *, organization_id, project_id, secret_id, owner_kind) -> SecretResponseDTO | None: ...
    async def list_project_and_organization_secrets(self, *, organization_id, project_id) -> tuple[list[SecretResponseDTO], list[SecretResponseDTO]]: ...
    # plus list/fetch/create/update/delete_organization_secret and set_organization_secret_availability
```

`SecretsDAOInterface` methods take `owner: SecretOwner` and gain `load_effective` (one statement) and the organization operations. `SecretResponseDTO` gains `owner`, `availability` and `selected_project_ids`; the fail-closed validator forces `write_only=True` for organization rows. `SecretsResolver` takes a `plane`; only the LLM instance answers `organization_connection`. Keyword arguments let M7 add the principal's user without changing callers. EE SSO callers keep their current service parameters.

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
| Old SDK or runner, new API | No change: without `include_organization`, responses are today's responses plus the additive `owner` field. An agent saved with an organization connection fails on a services image older than M5 (D5). |

M5 adds no durable work type.

## Risks

- An agent must name an organization connection to use it: a team that wants every agent on the company key edits each agent (or picks it when the agent is created).
- Organization connections do not work for Bedrock or SageMaker, or in legacy completion and chat apps, the prompt playground and AI evaluators (every `VaultMiddleware` workflow) (D3).
- The scope and slug are stored in each agent config: renaming an organization connection's slug breaks the agents that name it (a typed `connection_not_found`).

## Decided questions

1. Legacy completion and chat apps, the prompt playground and AI evaluators (every `VaultMiddleware` workflow) cannot use organization credentials (owner, 2026-10-25). Revisit when they route through the gateway.
2. An agent uses exactly the connection it picked, by scope and slug; nothing is inherited or overridden (owner, option B, 2026-10-26). This replaces the earlier override-by-slug decision.
3. Organization owners and admins manage organization credentials, in both editions, with one rule (owner, 2026-10-25).
4. The EE project limit is gated by `Flag.RBAC`; no new plan flag (owner, 2026-10-25).
