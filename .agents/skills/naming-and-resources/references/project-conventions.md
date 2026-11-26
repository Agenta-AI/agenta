# Agenta conventions

Read from `origin/main` at `a77e503782` (2026-10-29). Each row gives the convention, where it
lives, and the generic rule it overrides. When a row says "no rule", the code is mixed: the
spec must choose and record the choice. Re-check a row against the release branch before you
cite it in a finding; code moves.

Project conventions win. A finding must never ask to move a name toward a generic rule that
a row here overrides. Generic rules (Google AIP and others) fill gaps only where no row
exists.

## Columns and DTO fields

| Concept | Agenta convention | Where | Overrides |
| --- | --- | --- | --- |
| Identifier | `id`, UUID v7 | `IdentifierDBA` in `api/oss/src/dbs/postgres/shared/dbas.py`; `Identifier` in `sdks/python/agenta/sdk/models/shared.py` | AIP `name` as the resource name |
| Address | `slug`, URL-safe (`URL_SAFE_SLUG`), unique per owner | `SlugDBA`; `Slug` validator in `sdks/python/agenta/sdk/models/shared.py` | AIP resource name path |
| Display text | `name`, `description` | `HeaderDBA`; `Header` | AIP `display_name` |
| Lifecycle times | `created_at`, `updated_at`, `deleted_at` | `LifecycleDBA` in `api/oss/src/dbs/postgres/shared/dbas.py`; `Lifecycle` DTO | AIP `create_time`, `update_time`, `delete_time` |
| Lifecycle authors | `created_by_id`, `updated_by_id`, `deleted_by_id` | `LifecycleDBA`; `Lifecycle` | AIP has no author fields |
| Owner columns | `organization_id`, `project_id`, `user_id` (`workspace_id` is legacy) | `OrganizationScopeDBA`, `ProjectScopeDBA`, `UserScopeDBA`, `ScopeDBA` | AIP parent in the resource name |
| Owner kind enum | values `organization`, `project`, `user` | `SecretOwnerKind` in `api/oss/src/core/secrets/enums.py` | none |
| Boolean state | keys named `is_<adjective>` inside the JSONB `flags` column | `FlagsDBA`; `WorkflowArtifactFlags` (`is_application`, `is_evaluator`) in `api/oss/src/core/workflows/dtos.py`; connection flags `is_active`, `is_valid` read in `api/oss/src/core/gateway/connections/dtos.py` | AIP drops the `is_` prefix |
| Boolean column | no rule. Precedents: `projects.is_default` (`api/oss/src/models/db_models.py`, legacy), `active` (`api/ee/src/dbs/postgres/subscriptions/dbas.py`), `dispatch_claimed` (`api/oss/src/dbs/postgres/sessions/inputs/dbes.py`) | as listed | none |
| Other metadata | `tags` (JSONB), `meta` (JSON), `data` (JSON), `status` (JSONB); the DTO groups `flags`, `tags`, `meta` as `Metadata` | `TagsDBA`, `MetaDBA`, `DataDBA`, `StatusDBA`; `Metadata` | none |
| Catalog keys | a string id that comes from a catalog ends in `_key`: `provider_key`, `integration_key`, `action_key`, `template_key`, `preset_key`. The `_key` name holds inside the catalog's own API. When the same value also plays a role shared by several item kinds (for example the service an account is for), the shared layer (selection, indexes that sibling tables share, new references) uses the glossary term and maps the catalog key in one place | `api/oss/src/apis/fastapi/tools/router.py`, `api/oss/src/apis/fastapi/workflows/router.py`, `api/oss/src/core/gateway/connections/dtos.py` | none |
| Kind discriminator | `kind` on vault rows (`SecretKind`); `type` on agent config items | `api/oss/src/core/secrets/enums.py`; agent config | no single rule |

## Tables, constraints, enums

| Concept | Agenta convention | Where |
| --- | --- | --- |
| Table name | snake_case. Mostly `<singular domain>_<plural entity>`: `workflow_revisions`, `trigger_subscriptions`, `channel_connections`, `evaluation_runs`, `secret_projects`, `gateway_connections`. A plain plural when the domain is the entity: `secrets`, `folders`, `events`, `mounts`. Exceptions with a plural prefix: `llms_endpoints`, `mcps_endpoints`, `mcps_oauth_attempts` | `__tablename__` in `api/oss/src/dbs/postgres/**/dbes.py` |
| Constraint and index names | `uq_<table>_<columns>`, `ix_<table>_<columns>`, `ck_<table>_<rule>`, `fk_<table>_<column>`, `pk_<table>`. Column parts are spelled out in some names (`uq_secrets_project_id_slug`) and shortened in others (`uq_gateway_connections_project_provider_integration_slug`): no rule | `api/oss/src/dbs/postgres/secrets/dbes.py`, `api/oss/src/dbs/postgres/gateway/connections/dbes.py` |
| Project-owned tables | composite primary key `(project_id, id)` | `gateway_connections`, `mcps_endpoints` |
| Single owner rule | a check constraint on the owner columns, for example `ck_secrets_single_owner`: `num_nonnulls(project_id, organization_id) = 1` | `api/oss/src/dbs/postgres/secrets/dbes.py` |
| Enums | `class X(str, Enum)`, upper-case members, lower snake_case values; Postgres type named `<name>_enum` (`secretkind_enum`) | `api/oss/src/core/secrets/enums.py`, `api/oss/src/dbs/postgres/secrets/dbas.py` |
| Archive | revisioned entities archive with `deleted_at` and `deleted_by_id`, not hard deletes; queries respect `include_archived` | `api/AGENTS.md` (Scope, lifecycle, and archival rules) |
| Schema changes | a column rename or type change fails the migration gate; use expand and contract | `api/AGENTS.md` (Migration gate) |

## Folders and modules

| Concept | Agenta convention | Where |
| --- | --- | --- |
| Domain layout | `apis/fastapi/<domain>/` (`router.py`, `models.py`, `utils.py`), `core/<domain>/` (`dtos.py` or `types.py`, `interfaces.py`, `service.py`), `dbs/postgres/<domain>/` (`dbes.py`, `dbas.py`, `dao.py`, `mappings.py`). Example to copy: `workflows` | `api/AGENTS.md` (Standard domain folder structure) |
| Domain folder number | mostly plural (`workflows`, `secrets`, `sessions`, `triggers`, `webhooks`, `testsets`, `gateways`). Singular: `access`, `auth`, `git`, `sharing`, `tracing`, `gateway`. No written rule | `git ls-tree origin/main api/oss/src/core/` |
| API folder against route | the folder name and the route prefix usually match. Known mismatch: `apis/fastapi/vault/` serves `/secrets/` | `api/oss/src/apis/fastapi/vault/router.py` |
| Layer direction | Router, Service, DAO interface, DAO implementation, DB. DTO and DBE mapping in `dbs/postgres/*/mappings.py`. No DBE leaves the DAO | `api/AGENTS.md` (Layering and dependency direction) |
| Frontend entities | `web/packages/agenta-entities/src/<entity>/`, singular camelCase (`mcpEndpoint`, `gatewayTool`, `secret`, `workflow`) | `web/packages/agenta-entities/src/` |

## Routes and responses

| Concept | Agenta convention | Where |
| --- | --- | --- |
| Standard routes | `POST /` create, `GET /{<entity>_id}` fetch, `PUT /{<entity>_id}` edit, `POST /query` filter, `POST /{id}/archive` and `/unarchive` | `api/oss/src/apis/fastapi/workflows/router.py`; `api/AGENTS.md` (Endpoint design conventions) |
| Revisioned routes | `/revisions/retrieve`, `/revisions/commit`, `/revisions/log` | `api/AGENTS.md` |
| Custom actions | `POST /{<entity>_id}/<verb>`: `archive`, `unarchive`, `refresh`, `revoke`, `cancel`, `connect` | workflows, tools and MCP routers |
| Path parameters | `{<entity>_id}` (`{workflow_id}`, `{secret_id}`, `{connection_id}`, `{endpoint_id}`); catalog items by `{<thing>_key}` | as above |
| Operation ids | `<verb>_<entity>`, set on every route. The verb set differs by domain: workflows `create`, `fetch`, `edit`, `archive`, `query`; tools `create`, `fetch`, `delete`, `query`, `refresh`, `revoke`; vault `create`, `list`, `read`, `update`, `delete`, `set`; MCP `create`, `list`, `query`, `fetch`, `edit`, `delete`, `connect`, `disconnect`. No single verb set: copy the domain you extend, and the `workflows` set for a new domain | `router.py` of each domain |
| Responses | `count` plus the payload under a named field (`connection` or `connections`; `api/AGENTS.md` calls it the `item` and `items` style) | `api/oss/src/apis/fastapi/tools/models.py` |
| Pagination | cursor windowing with `Windowing` (`next`, `limit`, `order`, `newest`, `oldest`); never page numbers | `api/AGENTS.md`; `Windowing` in `sdks/python/agenta/sdk/models/shared.py` |
| Signatures | keyword-only parameters after `*`, groups separated by `#` lines | `api/AGENTS.md` (Router and function style conventions) |
| Errors | domain exceptions in `core/<domain>/types.py` or `dtos.py`; agent-facing errors are `{code, message, retryable, next_step, details}` with a lower snake_case `code` | `api/AGENTS.md` (Domain-level exceptions) |

## Agent configuration references

| Concept | Agenta convention | Where |
| --- | --- | --- |
| Connection reference | an agent names a connection by `scope` and `slug`; `scope` is `project` (the default) or `organization` and says which slug list the slug is in. Nothing is inherited | `api/AGENTS.md` (Organization-scoped decisions and organization credentials) |

Known problem (owner, 2026-10-29): this `scope` does not mean access scope or whose account a
run uses; it names the owner of the slug list. It is a shipped exception, not a convention to
copy. A target that adds `scope` to a new reference type, or shows it to users as "scope",
breaks `naming-rules.md` 4.

## Labels

| Concept | Agenta convention | Where |
| --- | --- | --- |
| Entity display name | the artifact's `name`, then its `slug`; a variant label from the variant; never `revision.name` | `web/AGENTS.md` (Entity display names) |
| Error text | users are not technical; error detail goes to logs, not the UI | owner rule |

## Using the table

- Cite a row by its concept when a finding depends on it ("project conventions:
  Lifecycle times").
- A "no rule" row is not a finding by itself. It becomes one when the spec adds a new name
  without choosing.
- When the spec chooses a rule for a "no rule" row, propose adding it here.
