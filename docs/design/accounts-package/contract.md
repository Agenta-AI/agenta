# Accounts package: contract

Status: draft for review, 2026-10-29. This file is the one source that builders A to E code against. Where it differs from the spec (`spec.md`), this file wins. Section 13 lists every place where it differs, with the reason.

Base: `origin/main` at `a77e503782`. Every name below was checked on that commit ("main"), on the personal credentials build (`origin/feat/m7-*`, "the build") or on the Needs setup build (`origin/feat/agent-needs-setup`, "7887"). Paths start at `api/oss/src/` unless they start with `api/`, `sdks/`, `services/`, `clients/` or `web/`.

Package branch: `feat/accounts-package`, cut from `origin/main`. Every pull request targets it.

## 1. Order of work

| Step | Builder | Pull request | Starts | Must land before |
| --- | --- | --- | --- | --- |
| 1 | A | A1, storage: all migrations, DBEs, DAOs, and the person-owner methods of the vault and connection services | now | C1, A2 |
| 2 | B | B1, automations: the editor becomes the run person | now | D1 (D edits two trigger files after B1) |
| 3 | C | C1, MCP sign-in per person | now; codes against the interfaces of A1 and A2 and rebases when they land | lands after A2 |
| 4 | E | E1 and later, screens | now; codes against this contract and wires to the real routes when A2, C1 and D1 land | |
| 5 | A | A2, account choices and the run path | after A1 lands | D1 |
| 6 | D | D1, Needs setup on the package branch | after A2 and B1 land | |

"Lands" means the conductor merges the pull request into `feat/accounts-package`. Builders never merge. A builder rebases on the package branch when it moves.

A file has one owner at a time (section 10). When section 10 says "after X", the second builder edits the file only after X is in the package branch, and the first builder makes no more changes to it.

## 2. Names

The spec section 7 glossary applies. The names that every layer uses:

| Concept | Database | Python | Route and JSON | Interface label (draft unless approved) |
| --- | --- | --- | --- | --- |
| Account source | none | `AccountSource` (SDK, `Literal["agent", "user"]`) | item field `account_source` | the drawer's "Account" select |
| Owner | `project_id`, `organization_id`, `user_id` | `SecretOwner`, `SecretOwnerKind` | request field `scope` (`project`, `organization`, `user`) on `/secrets` and `/tools/connections`; `owner_kind` on MCP `connect` | "Yours", the project name, the organization name |
| Default | `gateway_connections.is_default` | `is_default` | `is_default`; `POST /tools/connections/{connection_id}/make-default` | "Default", "Make default", "Make it my default for every agent" |
| Account choice | table `account_choices` | `AccountChoice`, `AccountChoiceDBE` | `/account-choices`, `account_choice` | the account picked under "Change" (spec 5.1) |
| Item key | `account_choices.item_key` | `item_key` | `item_key`; equals the Needs setup `requirement.key` | not shown |
| User item | none | `UserItem` (SDK); its `item_key` equals the Needs setup `AgentRequirement.key` | none | none |
| Item account | none | `ItemAccount` | `item_accounts` | the "When you run it: ..." line |
| Match | none | `AccountMatch` | `match`: `choice`, `default`, `sign_in` | the "When you run it" texts of spec 5.1 |
| Run person | none | `run_person_id(envelope)` | none | none |
| Run accounts | none | `RunAccount`, `RequestAccess.run_accounts` | claim `run_accounts` | none |
| Sign-in | `secrets` rows of kind `OAUTH_GRANT` and `MCP_TOKEN` | `SecretKind.MCP_TOKEN`, `grant_slug`, `token_slug` | `owner_kind=user` on `connect`; `account_source=user` on the MCP gateway route; `user_sign_in` on the MCP endpoint response | the MCP texts of spec 5.1 and 5.4 |
| Deployment switch | none | `env.access.personal_accounts_enabled` | environment variable `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED` | none |

The interface labels come from spec section 5 and `UX-DECISIONS.md`; this column only points to them.

Words not to use in new code: `binding` (for the account source), `credential` (as the product term), `caller_account`, `project_default`, `gateway_bindings`, `caller_user_id`, `personal_credentials`.

## 3. Database

### 3.1 The migration chain

One chain in `api/oss/databases/postgres/migrations/core_oss/versions/`. Builder A writes every revision, in pull request A1. No other builder adds a revision. A builder that needs a schema change asks the conductor, and A adds it.

The head of `core_oss` on main is `oss000000053` (its `down_revision` is `oss000000054`). `find_head.py` also prints `oss000000038` and `oss000000032`; these are false heads, because its pattern misses two annotation styles. The package chain:

| Revision | File | `down_revision` | Content |
| --- | --- | --- | --- |
| `oss000000055` | `oss000000055_add_mcp_token_secret_kind.py` | `oss000000053` | `ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'MCP_TOKEN'`, inside `op.get_context().autocommit_block()` |
| `oss000000056` | `oss000000056_add_personal_secrets.py` | `oss000000055` | section 3.2 |
| `oss000000057` | `oss000000057_add_personal_gateway_connections.py` | `oss000000056` | section 3.3 |
| `oss000000058` | `oss000000058_add_account_choices.py` | `oss000000057` | section 3.4 |
| `oss000000059` | `oss000000059_add_mcps_oauth_attempts_owner_kind.py` | `oss000000058` | section 3.5 |

Other open pull requests on main also use `oss000000055` and higher. The final numbers are set when the package goes into a release. Every package pull request says so in its body.

Rules for every revision (from `api/AGENTS.md` and the build's 055):

- Add a constraint `NOT VALID` under `SET LOCAL lock_timeout = '5s'`, then validate it in an autocommit block.
- Build an index `CONCURRENTLY` in an autocommit block, and check that it is valid.
- No `NOT NULL` column without a `server_default`.
- Run `uv run api/scripts/migration_gate.py <file>` on each file.
- The enum stores the upper-case names (`'CUSTOM_SECRET'`, `'MCP_TOKEN'`), so a check rule lists upper-case names.

### 3.2 `secrets` (revision 056)

Reuse the build's `oss000000055_add_personal_secrets.py`, with these changes:

| Change | Exact form |
| --- | --- |
| Column | `user_id UUID NULL` |
| Foreign key | `fk_secrets_user_id`: `(user_id) REFERENCES users (id) ON DELETE CASCADE` |
| Check (replaced) | `ck_secrets_single_owner`: `(project_id IS NOT NULL AND organization_id IS NULL AND user_id IS NULL) OR (project_id IS NULL AND organization_id IS NOT NULL)` |
| Check (new) | `ck_secrets_user_kinds`: `user_id IS NULL OR kind IN ('CUSTOM_SECRET', 'SUBSCRIPTION_PROVIDER', 'OAUTH_GRANT', 'MCP_TOKEN')`. The build's list had `PROVIDER_KEY` and no `CUSTOM_SECRET`; both change. |
| Index (rebuilt) | `uq_secrets_organization_id_slug` on `(organization_id, slug) WHERE project_id IS NULL AND user_id IS NULL AND slug IS NOT NULL` |
| Index (new) | `uq_secrets_user_slug` on `(organization_id, user_id, slug) WHERE user_id IS NOT NULL` |
| Unchanged | `uq_secrets_project_id_slug`, `ix_secrets_organization_id`, `ck_secrets_availability` |

An organization row of kind `custom_secret` needs no schema change. It is an application rule: add `SecretKind.CUSTOM_SECRET` to `ORGANIZATION_SECRET_KINDS` in `core/secrets/enums.py`.

ORM: `SecretsDBA` (`dbs/postgres/secrets/dbas.py`) adds `user_id`. `SecretsDBE` (`dbs/postgres/secrets/dbes.py`) adds the foreign key, the checks and the index.

### 3.3 `gateway_connections` (revision 057)

Reuse the build's `oss000000057_add_personal_gateway_connections.py`, with these changes:

| Change | Exact form |
| --- | --- |
| Columns | `organization_id UUID NULL`, `user_id UUID NULL` |
| Column (new) | `is_default BOOLEAN NOT NULL DEFAULT false` |
| Foreign keys | `fk_gateway_connections_organization_id` to `organizations (id) ON DELETE CASCADE`; `fk_gateway_connections_user_id` to `users (id) ON DELETE CASCADE` |
| Primary key | from `(project_id, id)` to `pk_gateway_connections (id)`. `uq_gateway_connections_project_id_id UNIQUE (project_id, id)` stays for `fk_trigger_subscriptions_connection`. `project_id` becomes nullable. As in the build. |
| Check | `ck_gateway_connections_single_owner` (the build named it `ck_gateway_connections_owner`): `(project_id IS NOT NULL AND organization_id IS NULL AND user_id IS NULL) OR (project_id IS NULL AND organization_id IS NOT NULL)` |
| Check (new) | `ck_gateway_connections_default_user`: `NOT is_default OR user_id IS NOT NULL` |
| Index (the build's, not added) | `uq_gateway_connections_user_integration` |
| Index (new) | `uq_gateway_connections_user_provider_integration_slug` on `(organization_id, user_id, provider_key, integration_key, slug) WHERE user_id IS NOT NULL` |
| Index (new) | `uq_gateway_connections_organization_provider_integration_slug` on `(organization_id, provider_key, integration_key, slug) WHERE project_id IS NULL AND user_id IS NULL` |
| Index (new) | `uq_gateway_connections_user_default` on `(organization_id, user_id, provider_key, integration_key) WHERE is_default AND user_id IS NOT NULL` |
| Index (kept from the build) | `ix_gateway_connections_user_account` on `(organization_id, user_id, (data ->> 'connected_account_id')) WHERE user_id IS NOT NULL` |
| Unchanged | `uq_gateway_connections_project_provider_integration_slug`, `ix_gateway_connections_project_provider_integration`, `ix_gateway_connections_flags` |

Existing rows get `is_default = false`. `is_active` and `is_valid` stay keys in `flags` (JSONB); SQL reads them as `(flags ->> 'is_active')::boolean`.

The trigger subscription foreign key `(project_id, connection_id)` to `gateway_connections (project_id, id)` already keeps a person's connection (with no `project_id`) out of a trigger subscription (spec section 3.8, rule 4). B adds one test for it; no new check.

ORM: `ConnectionDBE` (`dbs/postgres/gateway/connections/dbes.py`) adds the columns, the new primary key and the constraints.

### 3.4 `account_choices` (revision 058, new table)

| Column | Type | Rule |
| --- | --- | --- |
| `id` | `UUID NOT NULL` | primary key `pk_account_choices`; uuid7 from `IdentifierDBA` |
| `project_id` | `UUID NOT NULL` | `fk_account_choices_project_id` to `projects (id) ON DELETE CASCADE` |
| `artifact_id` | `UUID NOT NULL` | `fk_account_choices_artifact`: `(project_id, artifact_id) REFERENCES workflow_artifacts (project_id, id) ON DELETE CASCADE` |
| `user_id` | `UUID NOT NULL` | `fk_account_choices_user_id` to `users (id) ON DELETE CASCADE` |
| `item_key` | `VARCHAR NOT NULL` | section 5.2 |
| `secret_id` | `UUID NULL` | `fk_account_choices_secret_id` to `secrets (id) ON DELETE CASCADE` |
| `gateway_connection_id` | `UUID NULL` | `fk_account_choices_gateway_connection_id` to `gateway_connections (id) ON DELETE CASCADE` |
| `created_at`, `updated_at`, `deleted_at`, `created_by_id`, `updated_by_id`, `deleted_by_id` | from `LifecycleDBA` | rows are deleted, never archived |

Constraints and indexes:

- `ck_account_choices_single_account`: `num_nonnulls(secret_id, gateway_connection_id) = 1`
- `uq_account_choices_project_id_artifact_id_user_id_item_key`: unique `(project_id, artifact_id, user_id, item_key)`. The run-start read uses it.
- `ix_account_choices_user_id` on `(user_id)`
- `ix_account_choices_secret_id` on `(secret_id) WHERE secret_id IS NOT NULL` and `ix_account_choices_gateway_connection_id` on `(gateway_connection_id) WHERE gateway_connection_id IS NOT NULL`, for the cascades and the "Used by" line.

ORM: `AccountChoiceDBE(Base, ProjectScopeDBA, IdentifierDBA, LifecycleDBA)` in `dbs/postgres/account_choices/dbes.py`, with `artifact_id`, `user_id`, `item_key`, `secret_id` and `gateway_connection_id`. Precedents: `AgentAccessDBE` for the artifact foreign key, `SessionGrantDBE` for the user foreign key (both in `dbs/postgres/sharing/dbes.py`).

### 3.5 `mcps_oauth_attempts` (revision 059)

- Column `owner_kind VARCHAR NOT NULL DEFAULT 'project'`.
- Check `ck_mcps_oauth_attempts_owner_kind`: `owner_kind IN ('project', 'user')`.
- ORM: `MCPOAuthAttemptDBA` (`dbs/postgres/gateways/mcps/dbas.py`) adds `owner_kind`. A adds it in A1; C owns the file after A1.

## 4. Module layout

### 4.1 The `account_choices` domain (new, builder A)

`core/accounts/` exists on main (the platform admin accounts service, with its own `AccountRef`) and is not used.

| File | Content |
| --- | --- |
| `core/account_choices/__init__.py` | empty |
| `core/account_choices/dtos.py` | `AccountMatch`, `AccountChoice`, `AccountChoiceUpsert`, `AccountChoiceQuery`, `ItemAccount`, `RunAccount` |
| `core/account_choices/interfaces.py` | `AccountChoicesDAOInterface` |
| `core/account_choices/service.py` | `AccountChoicesService` |
| `core/account_choices/items.py` | `run_person_id`, `user_items_of_revision` (the API side of the item reader) |
| `core/account_choices/claims.py` | `run_accounts_claim`, `run_accounts_from_claim`, `run_account`, `sign_run_accounts` |
| `core/account_choices/policy.py` | `personal_accounts_enabled()`, `PersonalAccountsDisabled` |
| `core/account_choices/lifecycle.py` | `AccountsLifecycle.end_for_member` (from the build's `core/credentials/lifecycle.py`). `MembershipsService.remove_member` (`core/memberships/service.py`) calls it through an optional hook, `set_member_removed_hook(hook)` (default none; the constructor does not change), which `api/entrypoints/routers.py` sets once the vault and connections services exist. So both paths that remove a member (`routers/workspace_router.py` and the admin path in `core/accounts/service.py`) delete the person's accounts. |
| `core/account_choices/exceptions.py` | `AccountNotYours`, `AccountNotForItem`, `ChoiceNotSupported` |
| `dbs/postgres/account_choices/{__init__,dbes,dao,mappings}.py` | `AccountChoiceDBE`, `AccountChoicesDAO` |
| `apis/fastapi/account_choices/{__init__,models,router}.py` | `AccountChoicesRouter`, the request and response models |
| `sdks/python/agenta/sdk/agents/accounts.py` | `AccountSource`, `UserItemKind`, `UserItem`, `user_item_key`, `read_user_items` (the SDK side of the item reader) |

The build folder `core/credentials/` is not copied (section 11).

### 4.2 Public interface

SDK (`sdks/python/agenta/sdk/agents/accounts.py`). The SDK is the one place that builds item keys, because the API (Needs setup already imports `agenta.sdk.agents.requirements`) and the services both need them.

```python
AccountSource = Literal["agent", "user"]
UserItemKind = Literal["app_connection", "mcp_server", "secret", "subscription"]

class UserItem(BaseModel):            # frozen
    item_key: str                     # "app_connection:user/gmail"
    kind: UserItemKind
    match_text: str                   # integration, MCP slug, variable name, or login kind
    paths: List[str]                  # "agent.tools[0].connection", as in Needs setup

def user_item_key(*, kind: UserItemKind, match_text: str) -> str: ...  # f"{kind}:user/{match_text}"

def read_user_items(parameters: Optional[dict]) -> List[UserItem]: ...
    # Never raises. Reads parameters["agent"]. One entry per item key: two Gmail tools
    # share one key, and their paths merge. Maps the model provider to the login kind:
    # "anthropic" -> "claude", "openai-codex" -> "chatgpt" (the only place that does it).
```

API (`core/account_choices/`):

```python
class AccountMatch(str, Enum):
    CHOICE = "choice"
    DEFAULT = "default"
    SIGN_IN = "sign_in"

class ItemAccount(BaseModel):
    item_key: str
    match: Optional[AccountMatch] = None          # None: no account matched
    secret_id: Optional[UUID] = None
    gateway_connection_id: Optional[UUID] = None
    name: Optional[str] = None                    # the account's name, for the interface
    is_ready: bool = False
    candidates: int = 0                           # the person's accounts that fit the item

class RunAccount(BaseModel):                      # one entry of the claim
    item_key: str
    secret_id: Optional[UUID] = None              # exactly one of the two ids is set
    gateway_connection_id: Optional[UUID] = None

def run_person_id(envelope: Optional[RunEnvelope]) -> Optional[UUID]: ...
    # None when there is no envelope or when envelope.context.origin is RunOrigin.CHILD
    # (a child keeps its parent's authority, so the authority alone cannot tell).
    # Otherwise the principal's id when the principal kind is HUMAN, and None for an
    # API key or an installation. Replaces the build's caller_user_id and drops its
    # installation branch (spec section 3.1). Every boundary uses this one function. A route (not a run) gets its envelope from
    # request_run_envelope(request) (middlewares/auth.py), which builds one for a browser
    # request; RequestAccess.envelope is None there and must not be passed.

def user_items_of_revision(revision_data: Optional[dict]) -> List[UserItem]: ...
    # read_user_items on the revision's parameters.

class AccountChoicesService:
    def __init__(self, *, account_choices_dao: AccountChoicesDAOInterface): ...

    async def resolve(
        self, *, organization_id: UUID, project_id: UUID, artifact_id: UUID,
        user_id: Optional[UUID], items: Sequence[UserItem],
    ) -> List[ItemAccount]: ...
        # One ItemAccount per item, in the order given. No read when items is empty or
        # user_id is None (then every item has match None and candidates 0). Exactly one
        # SQL statement otherwise. Never raises for a missing account. No upstream call.

    async def upsert(self, *, organization_id: UUID, project_id: UUID, user_id: UUID,
                     choice: AccountChoiceUpsert) -> AccountChoice: ...
    async def fetch(self, *, project_id: UUID, user_id: UUID,
                    account_choice_id: UUID) -> Optional[AccountChoice]: ...
    async def query(self, *, project_id: UUID, user_id: UUID, query: AccountChoiceQuery,
                    windowing: Optional[Windowing] = None) -> List[AccountChoice]: ...
    async def delete(self, *, project_id: UUID, user_id: UUID,
                     account_choice_id: UUID) -> bool: ...
```

`resolve` rules (spec sections 3.2 and 3.3):

| Kind | 1. Choice | 2. Automatic match | Ready when | `candidates` counts |
| --- | --- | --- | --- | --- |
| `app_connection` | the chosen connection | the person's connection with `is_default`, `provider_key = 'composio'` and `integration_key = match_text` | `flags.is_active` and `flags.is_valid` are true | the person's connections of the integration |
| `mcp_server` | never | the project's `mcps_endpoints` row with `slug = match_text`; then the person's `secrets` row at `grant_slug(endpoint id)` (kind `OAUTH_GRANT`) when `auth_mode` is `oauth`, or at `token_slug(endpoint id)` (kind `MCP_TOKEN`) when it is `api_key` | a token row always; a grant unless it is expired and has no refresh token | 0 or 1 |
| `secret` | the chosen secret | none | always, when found | the person's `custom_secret` rows |
| `subscription` | never in this package (section 13, item 3) | none | never | 0 |

Every matched row must have `organization_id` = the agent's organization and `user_id` = the run person. A choice whose account fails this is ignored, as if absent. The SQL builds `grant_slug` and `token_slug` with the rule of `get_slug_from_name_and_id` (`<name>-<last 12 hex digits of the id>`). A unit test checks that the SQL and the Python helpers give the same text.

Claims (`core/account_choices/claims.py`):

```python
def run_accounts_claim(item_accounts: Sequence[ItemAccount]) -> List[dict]: ...
    # Only the ready accounts, as the spec says (section 3.3, step 3).
def run_accounts_from_claim(value: Any) -> Tuple[RunAccount, ...]: ...
    # Refuses a malformed claim with InvalidRunClaims.
def run_account(access: Optional[RequestAccess], item_key: str) -> Optional[RunAccount]: ...
    # None when the run has no entry for the key.
async def sign_run_accounts(*, envelope: RunEnvelope, revision_data: Optional[dict],
                            artifact_id: UUID) -> Optional[List[dict]]: ...
    # The one function that resolves the accounts of a new run (section 6.1). Returns
    # None when the revision has no "user" items.
```

Vault, for builder C (`VaultService` in `core/secrets/services.py`, written by A in A1):

```python
async def get_personal_secret_by_slug(self, *, organization_id: UUID, user_id: UUID,
                                      slug: str) -> Optional[SecretResponseDTO]: ...
async def put_personal_secret(self, *, organization_id: UUID, user_id: UUID,
                              create_secret_dto: CreateSecretDTO) -> SecretResponseDTO: ...
    # Creates the row, or replaces the data of the row at the same slug and kind.
async def delete_personal_secret_by_slug(self, *, organization_id: UUID, user_id: UUID,
                                         slug: str) -> bool: ...
async def get_personal_secret_by_id(self, *, organization_id: UUID, user_id: UUID,
                                    secret_id: UUID) -> Optional[SecretResponseDTO]: ...
    # The relay's read of a person's sign-in (section 6.3).
async def list_personal_sign_ins(self, *, organization_id: UUID, user_id: UUID,
                                 slugs: Sequence[str]) -> List[SecretResponseDTO]: ...
    # The person's OAUTH_GRANT and MCP_TOKEN rows at these slugs, in one statement,
    # with no values (for user_sign_in on a list of servers).
async def delete_sign_ins(self, *, organization_id: UUID, project_id: UUID,
                          slugs: Sequence[str]) -> int: ...
    # Deletes the rows of kind OAUTH_GRANT or MCP_TOKEN at these slugs, for the project
    # and for every person in the organization, in one statement. Returns the count.
```

The build's `list_personal_secrets` and `delete_personal_secret` (by id) stay. The build's `create_personal_secret` changes: it creates a `custom_secret` with the slug the caller gives (the build's rule "one per provider, the slug is the provider" goes). The build's `personal_secret_for_service` belongs to the deleted selection code and is not copied.

MCP slugs (`core/gateways/mcps/oauth/storage.py`; A adds `token_slug` in A1, and C owns the file after):

```python
def grant_slug(endpoint_id: UUID) -> str: ...  # main: get_slug_from_name_and_id("oauth-grant", endpoint_id)
def token_slug(endpoint_id: UUID) -> str: ...  # new:  get_slug_from_name_and_id("mcp-token", endpoint_id)
```

Composio connections (`ConnectionsService` in `core/gateway/connections/service.py`, A): the build's `query_personal_connections` and `delete_personal_connections`, plus:

```python
async def make_default(self, *, organization_id: UUID, user_id: UUID,
                       connection_id: UUID) -> Optional[Connection]: ...
    # One transaction: clear the old default of that integration, set the new one.
```

`Connection` (`core/gateway/connections/dtos.py`) adds `is_default: bool = False`, `organization_id: Optional[UUID] = None` and `user_id: Optional[UUID] = None`. The build's `entity_for(*, owner, project_id)` stays: it gives `org:<organization id>:user:<user id>` for a person.

## 5. Agent items

### 5.1 Item JSON

The shape of spec section 2.7, with these SDK models (builder A):

| SDK model (file) | Fields added | Rule |
| --- | --- | --- |
| `Connection` (`sdks/python/agenta/sdk/agents/connections/models.py`) | `account_source: Optional[AccountSource] = None` | `"user"` only with `mode = "self_managed"` and no `slug`. `"user"` with `mode = "agenta"` is a validation error. |
| `GatewayConnectionRef` (`sdks/python/agenta/sdk/agents/tools/models.py`) | `account_source: Optional[AccountSource] = None`; `slug` becomes `Optional[str]` | `"user"` requires no slug. `"agent"` or none requires a slug, as today. |
| `MCPGatewayConnection` (`sdks/python/agenta/sdk/agents/mcp/models.py`, `extra="forbid"`) | `account_source: Optional[AccountSource] = None` | `"user"` only with `namespace = "custom"`; the slug stays required. |
| `SandboxSecretReference` (`sdks/python/agenta/sdk/agents/dtos.py`, `extra="forbid"`) | `account_source: Optional[AccountSource] = None`; `namespace: Optional[Literal["organization"]] = None`; `slug` becomes `Optional[str]` | `"user"` requires no slug and no namespace. Otherwise a slug is required. |
| `_SandboxSecretReferenceSchema` (`sdks/python/agenta/sdk/utils/types.py`) | the same three fields | the schema twin that the interface reads |

Omitted `account_source` means `"agent"`. The build's `binding` field is not added anywhere. Code tool secrets (`tools[].secrets`) do not change.

`namespace: "organization"` on a secret reference maps to the vault's `scope=organization` in one place, `platform/secrets.py` (A): the SDK reads it with `GET /secrets/{slug}?scope=organization`. Today that route, with a run credential, releases only a subscription login (`_release_organization_subscription` in `apis/fastapi/vault/router.py`) and answers `404` for any other kind. A changes it to also release a `custom_secret` that is available to the run's project, with its value (spec section 9, item 1). An omitted namespace reads the project's list, as today. `sandbox_credentials.py` keeps `(namespace, slug)` as the address when it removes duplicates and looks up results.

### 5.2 Item keys

`<kind>:user/<match_text>`, built only by `user_item_key`:

| Kind | Example | `match_text` |
| --- | --- | --- |
| `app_connection` | `app_connection:user/gmail` | `tools[].connection.integration` |
| `mcp_server` | `mcp_server:user/linear` | `mcps[].connection.slug` |
| `secret` | `secret:user/GITHUB_TOKEN` | `sandbox.credentials[].binding.name` |
| `subscription` | `subscription:user/claude` | the login kind, from the model provider |

The route models accept an item key only if it matches `^(app_connection|mcp_server|secret|subscription):user/\S+$`. `UserItem.item_key` and the Needs setup `AgentRequirement.key` of the same item are the same text. Code reads the account source from the `:user/` part, never by splitting the key into an integration and a slug. The Needs setup kind `mcp_sign_in` keeps its shipped key rewrite (`mcp_sign_in:user/linear`); no choice uses that key.

## 6. Run path

### 6.1 Run start (builder A)

A run credential is first minted in two places, and both call `sign_run_accounts` (section 4.2), so every run resolves accounts the same way:

- `WorkflowsService._prepare_invoke` (`core/workflows/service.py`), next to the existing `acting_user_id` call: the runs the API proxies (a resume, a trigger fire).
- `POST /access/permissions/check` (`apis/fastapi/access/router.py`), when the request carries no run credential yet: the playground and chat turns, which go straight to the agent service and never pass `_prepare_invoke` (see the docstring near `core/workflows/service.py:3684`). It reads the revision that the request names. When the request already carries a run credential, it only carries `run_accounts` on (section 6.2).

`sign_run_accounts` does:

1. `items = user_items_of_revision(revision_data)`.
2. If `items` is empty: no read and no claim. A run of an agent without `"user"` items makes exactly the same database and network calls as on main. A count test proves it.
3. Otherwise: `item_accounts = await account_choices_service.resolve(organization_id=..., project_id=..., artifact_id=..., user_id=run_person_id(envelope), items=items)`. One SQL statement. A count test proves it.
4. Sign `run_accounts_claim(item_accounts)` into the run credential as `run_accounts`.

With the deployment switch off, step 3 is skipped and the claim is empty, so every `"user"` item is left out.

### 6.2 The claim `run_accounts`

```json
"run_accounts": [
  {"item_key": "app_connection:user/gmail", "gateway_connection_id": "0193...a1"},
  {"item_key": "mcp_server:user/linear", "secret_id": "0193...b2"}
]
```

- It lists only the ready accounts (spec section 3.3). Each path knows from its own request that an item is `"user"` (section 6.3), so a `"user"` item with no entry is "not found", and never falls back to the agent's account.
- The claim has no value, no name and no person id. The run person comes from the credential's authority.
- Signing: `sign_secret_token(...)` in `middlewares/auth.py` takes `run_accounts: Optional[List[dict]] = None` and writes `auth_context["run_accounts"]` when it is set. It is not an envelope claim: `ENVELOPE_CLAIM_KEYS` in `core/access/principals.py` does not change. The build carried `gateway_bindings` the same way.
- Verify: the auth middleware sets `request.state.run_accounts = run_accounts_from_claim(auth_context.get("run_accounts"))`, which is the input of `_build_request_access_from_state` (`middlewares/auth.py`), and `RequestAccess` (`core/access/dtos.py`) gets `run_accounts: Tuple[RunAccount, ...] = ()`. `request.state` has one writer (the middleware) and one reader (that builder). Every other reader calls `run_account(get_request_access(), item_key)`.
- Re-mint: three routes mint a new credential from a run credential and carry `run_accounts` unchanged: `apis/fastapi/access/router.py` (A), `apis/fastapi/gateways/credentials_router.py` (A) and `apis/fastapi/gateways/mcps/router.py` (C). A adds `run_accounts(request) -> List[dict]` to `core/gateways/run_claims.py`, next to `gateway_run_id` and `gateway_tools`, with the same signature as its siblings; it serializes `request.state.run_accounts` (`model_dump(mode="json", exclude_none=True)`). Each route passes it to `sign_secret_token`.

### 6.3 How each path reads it

Each path fetches the row by id, checks that its owner is still the run person (`run_person_id(access.envelope)`; these paths always carry a run credential, so the envelope is set) in the run's organization, and reads the value as today. A failed check is "not found". An `"agent"` item goes through the path's code on main, unchanged.

| Path | Owner | Key | `"agent"` item | `"user"` item |
| --- | --- | --- | --- | --- |
| Tools service: `POST /tools/resolve` and `POST /tools/call` (`core/tools/service.py`) | A | `app_connection:user/<integration>` | the connection slug | The request says `"user"`: on resolve, a reference with `account_source: "user"` and no slug; on call, `ToolCallContext` (`core/tools/dtos.py`) gets `account_source: Optional[AccountSource] = None`, which the runner copies from the resolved reference, with `connection` null. A null `connection` without `account_source: "user"` is still refused, as today. The service reads `gateway_connection_id` from the claim. No entry: on resolve with `omit_unavailable: true`, the connection is in `unavailable_connections`; on call, `404`. |
| MCP gateway: `/gateways/mcps/custom/{slug}/...` (`core/gateways/mcps/service.py`, proxy in `apis/fastapi/gateways/mcps/proxy.py`) | C | `mcp_server:user/<slug>` | `mcps_endpoints.secret_id` | The request says `"user"` with the query parameter `account_source=user`, which the SDK adds to the gateway URL of a `"user"` MCP item (`_gateway_mcp_route` in `sdks/python/agenta/sdk/agents/mcp/resolver.py`, C). Without it, the request is `"agent"`, as today. With it, the relay uses the claim entry's `secret_id` as `BoundSecretRef(secret_id=..., owner_kind=SecretOwnerKind.USER)`. Today `core/gateways/policy/resolution.py` reads nothing for a user reference; C adds the user branch there, which reads the row with `get_personal_secret_by_id` for the run person in the run's organization. The relay refreshes a grant with the shipped `refresh_grant` for the person owner. No entry: `404`, and the runner does not register the server. |
| Vault: `POST /secrets/resolve` (new, section 7.2) | A | `secret:user/<variable>` | `GET /secrets/{slug}` | The SDK sends every `"user"` item key of the sandbox credentials in one call, in parallel with the slug reads. The route returns the values of the keys that have an entry. A missing value leaves the variable out; it never raises `SandboxCredentialError`. |
| Model gateway (`core/gateways/llms/`) | none | none | unchanged | Never `"user"`. A `"user"` subscription login is a missing model (section 13, item 3). |

Round trips: zero added for an agent without `"user"` items. With `"user"` items: one SQL statement at run start, and at most one vault call, in parallel with the secret reads of today. The tools and MCP paths read by id where they read by slug today.

### 6.4 The SDK and the runner (builder A, except MCP)

- `sdks/python/agenta/sdk/agents/sandbox_credentials.py`: split the credentials into slug items and `"user"` items. Read the slug items as today. Read the `"user"` items with `resolve_user_secrets(item_keys)` in `platform/secrets.py`, which calls `POST /secrets/resolve`. Leave out a `"user"` item with no value.
- `sdks/python/agenta/sdk/agents/platform/gateway.py`: send `omit_unavailable: true` (ported from 7887) and `account_source` on `"user"` tool references.
- `sdks/python/agenta/sdk/agents/platform/connections.py`: a `self_managed` connection with `account_source: "user"` resolves as "no login", which the handler turns into `agent_needs_setup` (D, section 8.3). It never falls back to the runner operator's login.
- The runner (`services/runner/`) copies `account_source` from the resolved tool reference into the call context. That runner change is A's.

## 7. Routes

Errors use the shipped shape: `{"detail": {"code": "<code>", "message": "<text a person can read>"}}`. Request bodies never carry `user_id`. Every route acts for the caller in the request's project, as every project route does today.

Three checks that the tables below name:

- **Person.** The caller's principal is a human, the request carries no run envelope, and the request has an organization (the build's `require_person`, in `apis/fastapi/shared/personal.py`). Otherwise `403`, code `user_required`.
- **Switch.** With `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED` off, every route that reads or writes a person's rows or account choices answers `403`, code `personal_accounts_disabled`. The screens read the switch from that answer (section 12), the same way `organizationConnectionsAccessAtom` reads organization access today. Rows created while the switch was on stay stored, hidden and unused, until it is on again or the person leaves the organization.
- **May run the agent.** `Permission.RUN_SESSIONS` on the project, and `allow_agent(request, action=Permission.RUN_SESSIONS, artifact_id=workflow_id)` (`apis/fastapi/sharing/utils.py`). A hidden or unknown agent answers `404`, code `not_found`.

### 7.1 Account choices (new, builder A)

`AccountChoicesRouter` (`apis/fastapi/account_choices/router.py`), mounted in `api/entrypoints/routers.py` with `prefix="/account-choices"`, tag `Account Choices`.

| Method and path | Operation id | Checks | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| `POST /account-choices/` | `upsert_account_choice` | Person, Switch, May run the agent | `AccountChoiceUpsertRequest` | `200` `AccountChoiceResponse` | `400` `account_not_yours`, `account_not_for_item`, `choice_not_supported`; `403` `user_required`, `personal_accounts_disabled`; `404` `not_found`; `422` validation |
| `GET /account-choices/{account_choice_id}` | `fetch_account_choice` | Person, Switch | none | `200` `AccountChoiceResponse` (`count` 0 when not found) | `403` `user_required`, `personal_accounts_disabled` |
| `POST /account-choices/query` | `query_account_choices` | Person, Switch | `AccountChoiceQueryRequest` | `200` `AccountChoicesResponse` | `403` `user_required`, `personal_accounts_disabled` |
| `DELETE /account-choices/{account_choice_id}` | `delete_account_choice` | Person, Switch | none | `204`, also when not found | `403` `user_required`, `personal_accounts_disabled` |
| `POST /account-choices/resolve` | `resolve_account_choices` | Person, Switch, May run the agent | `AccountChoicesResolveRequest` | `200` `ItemAccountsResponse` | `403` `user_required`, `personal_accounts_disabled`; `404` `not_found`; `422` validation |

```json
// AccountChoiceUpsertRequest: exactly one of secret_id and gateway_connection_id
{"account_choice": {"workflow_id": "0193...", "item_key": "secret:user/GITHUB_TOKEN",
                    "secret_id": "0193..."}}

// AccountChoiceResponse
{"count": 1, "account_choice": {"id": "0193...", "workflow_id": "0193...",
  "item_key": "secret:user/GITHUB_TOKEN", "secret_id": "0193...",
  "gateway_connection_id": null, "created_at": "2026-10-29T21:00:00Z",
  "updated_at": null}}

// AccountChoiceQueryRequest: every filter is optional
{"account_choice": {"workflow_id": "0193...", "item_key": "secret:user/GITHUB_TOKEN",
                    "secret_ids": ["0193..."], "gateway_connection_ids": ["0193..."]},
 "windowing": {"limit": 50}}

// AccountChoicesResponse
{"count": 1, "account_choices": [ ... ], "windowing": null}

// AccountChoicesResolveRequest: exactly one of workflow_revision_ref and parameters,
// the rule of the Needs setup route
{"workflow_id": "0193...", "workflow_revision_ref": {"id": "0193..."}, "parameters": null}

// ItemAccountsResponse
{"count": 2, "item_accounts": [
  {"item_key": "app_connection:user/gmail", "match": "default",
   "gateway_connection_id": "0193...", "name": "Gmail (main)", "is_ready": true,
   "candidates": 2},
  {"item_key": "mcp_server:user/linear", "match": null, "is_ready": false,
   "candidates": 0}]}
```

Upsert checks, in this order:

1. Person, then Switch.
2. May run the agent `workflow_id`.
3. The item key is not `mcp_server:` or `subscription:`. Otherwise `400`, `choice_not_supported`.
4. The account is the caller's own row in the agent's organization. Otherwise `400`, `account_not_yours`, message "Pick one of your own accounts."
5. The account fits the key: a `custom_secret` for `secret:`; a Composio connection whose `integration_key` is the key's match text for `app_connection:`. Otherwise `400`, `account_not_for_item`.

The upsert does not check that the item key is in the agent's current revision. A choice for an item that is not there is never read.

`resolve` finds the caller with `run_person_id(request_run_envelope(request))`, the same rule as Needs setup. `resolve` with `parameters` reads a draft configuration (an unsaved item in the editor), with the same shape as the Needs setup route. `resolve` never writes.

The "Used by" line on the Secrets page calls `query` with `secret_ids`, in the current project.

### 7.2 Vault (builder A)

The vault router is mounted without a prefix, so the paths are `/secrets/...`. `/vault/v1/...` is a deprecated second mount that is not in the schema. The spec's `/vault/v1/secrets/` means `/secrets/`.

| Method and path | Change |
| --- | --- |
| `POST /secrets/` (`create_secret`) | The body field `scope` accepts `"user"` (Person, Switch). With `"user"`, only `kind: "custom_secret"`; another kind answers `400`, `kind_not_supported`. The slug is the one the caller gives, unique per person. With `"organization"`, `custom_secret` becomes allowed. |
| `GET /secrets/` (`list_secrets`) | Query `scope=user` lists the caller's own rows in the organization (Person, Switch). Rows of kind `oauth_grant` and `mcp_token` are never listed. |
| `GET /secrets/{secret_id_or_slug}`, `PUT /secrets/{secret_id}`, `DELETE /secrets/{secret_id}` | Query `scope=user` acts on the caller's own row (Person, Switch). These routes keep the shipped vault pattern, where `scope` goes on every route, because `GET` also takes a slug. |
| `POST /secrets/resolve` (new, `resolve_secrets`) | A run credential only; a request without `run_accounts` gets an empty list. Body `{"item_keys": ["secret:user/GITHUB_TOKEN"]}`, at most 100 keys. Response `{"count": 1, "item_secrets": [{"item_key": "secret:user/GITHUB_TOKEN", "secret": <the object that GET /secrets/{secret_id_or_slug} returns>}]}`. Only keys that start with `secret:user/` and have an entry in the claim come back. One SQL statement. |

The router type `Scope` (`apis/fastapi/vault/router.py`) becomes `Literal["project", "organization", "user"]`. The router maps `scope` and the caller to `SecretOwner` in one place.

### 7.3 Composio connections (builder A)

`ToolsRouter` (`apis/fastapi/tools/router.py`), prefix `/tools`.

| Method and path | Change |
| --- | --- |
| `POST /tools/connections/query` (`query_tool_connections`), `POST /tools/connections/` (`create_tool_connection`) | Query `scope: Literal["project", "user"] = "project"`. `user` needs Person and Switch. With `user`, query lists the caller's connections in the organization, with the existing `provider_key` and `integration_key` filters. |
| `GET /tools/connections/{connection_id}` (`fetch_tool_connection`), `DELETE /tools/connections/{connection_id}` (`delete_tool_connection`), `POST .../refresh` (`refresh_tool_connection`), `POST .../revoke` (`revoke_tool_connection`) | No `scope`. An id names one row, so the route reads the row and allows it when its `user_id` is the caller (Person, Switch) or its `project_id` is the request's project (today's permission). Otherwise `404`. |
| `GET /tools/connections/callback` (`callback_tool_connection`) | Reads the owner from the signed state (`state_payload["owner"] == "user"`), as in the build. |
| `POST /tools/connections/{connection_id}/make-default` (new, `make_default_tool_connection`) | No body and no `scope`, like the other by-id routes; it acts only on the caller's own connection (Person, Switch). Response `200` `ToolConnectionResponse`. Not the caller's: `404`, `not_found`. |
| `POST /tools/resolve` | Request `omit_unavailable: bool = False` and response `unavailable_connections`, ported from 7887; `account_source` on `"user"` references (section 6.3). |

`ToolConnection` responses add `is_default: bool`.

Defaults: a person's first connection for an integration is created with `is_default = true`. When the unique index refuses it (two creates at once), the create retries once with `is_default = false`. When the person already has connections for the integration and none is the default, a new connection is not the default. Deleting the default promotes nothing.

### 7.4 MCP endpoints (builder C)

Router in `apis/fastapi/gateways/mcps/router.py`, prefix `/gateways/mcps`.

| Method and path | Change |
| --- | --- |
| `POST /gateways/mcps/endpoints/{endpoint_id}/connect` (`connect_mcp_endpoint`) | Query `owner_kind: Literal["project", "user"] = "project"`. `project`: today's behavior and permission (`EDIT_MCP_ENDPOINTS`); a token server is still refused. `user`: Person, Switch and `Permission.RUN_SESSIONS` on the project. There is no agent id, because one sign-in serves every agent of the project. |
| the same route, `owner_kind=user`, OAuth server | Body `MCPConnectRequest{scopes}`, as today. Never writes the server row. If the server has no stored discovery data: `409`, `server_not_discovered`, message "A project admin must connect this server once first." The attempt stores `owner_kind = 'user'`. |
| the same route, `owner_kind=user`, token server (`auth_mode = api_key`) | Body field `token: Optional[str]` (write-only, never logged). Writes the caller's `MCP_TOKEN` row at `token_slug(endpoint_id)` with `put_personal_secret`. Response `MCPConnectResponse` with `count: 1` and no `redirect_url`. A token for an OAuth server: `400`, `token_not_expected`. No token for a token server: `400`, `token_required`. |
| `DELETE /gateways/mcps/endpoints/{endpoint_id}/connect` (`disconnect_mcp_endpoint`) | Query `owner_kind`. `user` deletes the caller's row at the slug that `auth_mode` selects. Idempotent. |
| `GET` and `DELETE /gateways/mcps/endpoints/{endpoint_id}/connect/attempts/{attempt_id}` (`fetch_mcp_connect_attempt`, `cancel_mcp_connect_attempt`) | Today they need `EDIT_MCP_ENDPOINTS`. They also allow the caller when the attempt's `owner_kind` is `user` and its `user_id` is the caller (with `RUN_SESSIONS`), so a person who may only run agents can finish a sign-in. |
| `GET /gateways/mcps/connect/callback` (`mcp_connect_callback`) | Writes the grant for the attempt's stored `owner_kind`: for `project`, the project's grant and `mcps_endpoints.secret_id`, as today; for `user`, the grant of the person `attempt.user_id` at `grant_slug(endpoint_id)`, and never `secret_id`. It never infers the owner. |
| `GET /gateways/mcps/endpoints/`, `POST /gateways/mcps/endpoints/query`, `GET /gateways/mcps/endpoints/{endpoint_id}` | The endpoint response adds `user_sign_in: {"is_ready": bool} \| null`: the caller's own sign-in to that server. `null` means the caller has no sign-in row for it. The field is left out when the caller is no person or the switch is off. `is_ready` has the meaning of `ItemAccount.is_ready`. One added statement per request (`list_personal_sign_ins`), none per row. |
| `PUT /gateways/mcps/endpoints/{endpoint_id}` (`edit_mcp_endpoint`) | When `auth_mode` changes, delete the sign-ins of the old mode for every owner (`delete_sign_ins`), under the endpoint's `oauth_lock`, as today's grant release. |
| `DELETE /gateways/mcps/endpoints/{endpoint_id}` (`delete_mcp_endpoint`) | Delete the rows at `grant_slug` and `token_slug` for every owner (`delete_sign_ins`), under the endpoint's `oauth_lock`, as today's grant release. |

The OAuth client registration stays the project's. `SecretsTokenStorage` (`core/gateways/mcps/oauth/storage.py`) takes `owner: SecretOwner` in place of `project_id` for the grant. The registration stays project-scoped.

`MCPGatewayService` (which owns edit and delete) does not get the vault service today (`api/entrypoints/routers.py`). It reaches `delete_sign_ins` through its `oauth_refresher`, the OAuth service of `core/gateways/mcps/oauth/service.py`, which already holds the vault service. So C needs no wiring change.

### 7.5 Needs setup (builder D)

`POST /workflows/revisions/requirements/query` (`query_workflow_revision_requirements`, in `apis/fastapi/workflows/router.py`), from 7887. Request `{"workflow_revision_ref": Reference | null, "parameters": dict | null}`, exactly one. Response `AgentRequirements` (section 8).

### 7.6 Automations (builder B)

No route changes its shape. `PUT /triggers/schedules/{schedule_id}` (`edit_trigger_schedule`), `PUT /triggers/subscriptions/{subscription_id}` (`edit_trigger_subscription`), `PUT /evaluations/runs/{run_id}` and `PUT /simple/evaluations/{evaluation_id}` write the caller as the executing principal in the same write (section 9). The trigger responses already return `principal` (`TriggerSchedule.principal`, `TriggerSubscription.principal`), which the notice compares with the viewer.

## 8. Needs setup

### 8.1 Response shape

`core/agent_requirements/dtos.py` (7887), with these changes:

- `AgentRequirementReason` adds `NEEDS_PERSONAL_ACCOUNT = "needs_personal_account"`.
- `AgentRequirement` adds `account_source: AccountSource = "agent"` (the SDK type of section 4.2). The screens use it to pick the `"user"` items; they never parse the key.
- `AgentRequirement.key` of a `"user"` item is its item key.

```json
{"count": 2, "status": "needs_setup", "requirements": [
  {"key": "app_connection:user/gmail", "kind": "app_connection", "account_source": "user",
   "label": "gmail", "reference": {"provider": "composio", "integration": "gmail",
   "account_source": "user"}, "paths": ["agent.tools[0].connection"],
   "reason": "needs_personal_account", "blocks_run": false,
   "fix": {"can_edit_agent": false, "can_connect": true, "can_sign_in": false,
           "candidates": 2}},
  {"key": "mcp_sign_in:user/linear", "kind": "mcp_sign_in", "account_source": "user",
   "label": "linear", "reference": {"type": "gateway", "namespace": "custom",
   "slug": "linear", "account_source": "user"}, "paths": ["agent.mcps[0].connection"],
   "reason": "needs_sign_in", "blocks_run": false,
   "fix": {"can_edit_agent": false, "can_connect": false, "can_sign_in": true,
           "candidates": 1}}]}
```

### 8.2 Reasons for `"user"` items

`AgentRequirementsService.check` calls `user_items_of_revision`, then `AccountChoicesService.resolve` once for the asker (`run_person_id(request_run_envelope(request))`, which the route passes to the service), and maps each `ItemAccount`. It does no other lookup for `"user"` items.

One reader per item: 7887's `read_agent_references` (`sdks/python/agenta/sdk/agents/requirements.py`) skips every item with `account_source: "user"`, and `read_user_items` is the only reader of those items. Without this rule, a `"user"` MCP item (which keeps its slug) also gets an `"agent"` requirement for the project's sign-in. D adds a test for a `"user"` MCP item.

| State | `kind` | `reason` | `fix` | `blocks_run` |
| --- | --- | --- | --- | --- |
| `app_connection`, no match, `candidates` 0 | `app_connection` | `needs_personal_account` | `can_connect: true`, `candidates: 0` | false |
| `app_connection`, no match, `candidates` above 0 (no default) | `app_connection` | `needs_personal_account` | `can_connect: true`, `candidates: n` | false |
| `app_connection`, matched, not ready | `app_connection` | `needs_sign_in` | `can_sign_in: true` | false |
| `secret`, no match | `secret` | `needs_personal_account` | `can_connect: true`, `candidates: n` | false |
| `mcp_server`, no match | `mcp_server` | `needs_personal_account` | `can_sign_in: true` | false |
| `mcp_server`, matched, not ready | `mcp_sign_in` | `needs_sign_in` | `can_sign_in: true` | false |
| `subscription` | `subscription` | `needs_personal_account` | none | true |
| any kind, and the asker is no person | the item's kind | `needs_personal_account` | none | true only for `subscription` |

- A ready `"user"` item gives no requirement.
- For `"user"` items, `can_connect` and `can_sign_in` are true for anyone who may run the agent (`RUN_SESSIONS` and `allow_agent`), not only for people with the manage permission. `can_edit_agent` keeps its shipped rule. `ask` is left out.
- With the switch off, every `"user"` item is `needs_personal_account` with no fix.
- `check` adds one SQL statement, and only when the revision has `"user"` items. A count test proves it.

### 8.3 Run start and automations

- The SDK handler (`sdks/python/agenta/sdk/agents/handler.py`) raises `AgentNeedsSetupError` (`agent_needs_setup`, HTTP 422) for a missing model, as 7887 does. A `"user"` subscription login is a missing model.
- The turn-on check (`TriggersService._check_needs_setup` in `set_schedule_active` and `set_subscription_active`; `ChannelsService._check_needs_setup`) and the skipped deliveries (`tasks/asyncio/triggers/dispatcher.py`) stay as in 7887: model items only.

## 9. Automations (builder B)

Spec section 3.8, rules 1 to 6. The exact changes:

| File | Change |
| --- | --- |
| `core/triggers/interfaces.py` | `edit_subscription(..., principal: Optional[PrincipalRef] = None)` and `edit_schedule(..., principal: Optional[PrincipalRef] = None)` |
| `dbs/postgres/triggers/dao.py` | With a `principal`, write `principal_kind` and `principal_id` in the same update, with `_set_principal_and_target`. Without one, keep the row's principal. |
| `core/triggers/service.py` | `edit_subscription` and `edit_schedule` take `principal` and pass it to the DAO. |
| `apis/fastapi/triggers/router.py` | The two edit handlers pass `principal=_request_principal(request)`. |
| `core/evaluations/service.py`, `apis/fastapi/evaluations/router.py` | `PUT /evaluations/runs/{run_id}` passes `principal=_caller(request)` to the shipped `edit_run(..., principal)`. `SimpleEvaluationsService.edit` takes `principal` and passes it to `edit_run`; `PUT /simple/evaluations/{evaluation_id}` passes `_caller(request)`. |

- Pause and resume (`/start`, `/stop`), delete, archive and worker writes pass no principal, so they never change it.
- An edit by a principal that is not a human (an API key) still writes that principal. Such an automation has no run person (`run_person_id` returns None), so its `"user"` items are left out.
- Nothing from 7883 is copied. Tests: per edit route, the principal changes to the editor, including a save that changes only the name; a lifecycle action keeps it; a person's connection cannot be a subscription's event connection (the foreign key of section 3.3).
- `EvaluationsService.edit_run` and the evaluations DAO already take and write `principal` on main, so B changes only the evaluation service's `SimpleEvaluationsService.edit` and the router.

## 10. Builders and files

A file belongs to one builder. "After X" means that the builder edits the file only once X has landed. Tests belong to the owner of the code they test. Paths start at `api/oss/src/` unless stated.

### Builder A: accounts backend

| Area | Files |
| --- | --- |
| Migrations (A1) | `api/oss/databases/postgres/migrations/core_oss/versions/oss000000055` to `oss000000059` |
| Secrets (A1, A2) | `dbs/postgres/secrets/{dbas,dbes,dao,mappings}.py`; `core/secrets/{enums,dtos,services,types,redaction}.py`; `apis/fastapi/vault/{router,models}.py`. In `core/secrets/`: `MCP_TOKEN` in `SecretKind`, `ALWAYS_WRITE_ONLY_KINDS` and `CREDENTIAL_FIELDS`; its data shape reuses the custom secret shape, with one branch in `_validate_secret_data_based_on_kind`; `_name_and_slug_subscription_provider` drops the one-login-per-provider rule and gives a new login a unique slug from its name (spec section 2.4). |
| Composio connections (A1, A2) | `dbs/postgres/gateway/connections/{dbes,dao,mappings}.py`; `core/gateway/connections/{dtos,interfaces,service,utils}.py`; `core/tools/{dtos,service}.py`; `apis/fastapi/tools/{router,models}.py` |
| MCP storage (A1 only) | `dbs/postgres/gateways/mcps/dbas.py` (the `owner_kind` column only); `core/gateways/mcps/oauth/storage.py` (`token_slug` only). C owns both after A1. |
| Account choices (A2) | `core/account_choices/**`; `dbs/postgres/account_choices/**`; `apis/fastapi/account_choices/**` |
| Run credential (A2) | `core/workflows/service.py` (`_prepare_invoke` only); `core/tools/dtos.py` (`ToolCallContext.account_source`); `middlewares/auth.py`; `core/access/dtos.py` (`RequestAccess.run_accounts`); `core/gateways/run_claims.py`; `apis/fastapi/access/router.py`; `apis/fastapi/gateways/credentials_router.py` |
| Person routes and lifecycle (A1, A2) | `apis/fastapi/shared/personal.py` (new, from the build); `core/memberships/service.py` (the member-removed hook only); `utils/env.py` (the switch) |
| Wiring | `api/entrypoints/routers.py`, until A2 lands |
| SDK (A2) | `sdks/python/agenta/sdk/agents/accounts.py` (new); `agents/connections/models.py`; `agents/tools/models.py`; `agents/mcp/models.py`; `agents/dtos.py`; `utils/types.py`; `agents/sandbox_credentials.py`; `agents/platform/secrets.py`; `agents/platform/gateway.py`; `agents/platform/connections.py` |
| Runner | `services/runner/**` except `src/extensions/pi-mcp.ts`: the tools call context (section 6.4) |

A gives: the interfaces of section 4.2, the routes of sections 7.1 to 7.3 and the claim of section 6.2.

### Builder B: automations

| Area | Files |
| --- | --- |
| Triggers | `core/triggers/{interfaces,service}.py`; `dbs/postgres/triggers/dao.py`; `apis/fastapi/triggers/router.py`. D owns `core/triggers/service.py` and `apis/fastapi/triggers/router.py` after B1. |
| Evaluations | `core/evaluations/service.py`; `apis/fastapi/evaluations/router.py` |
| Tests | `api/oss/tests/pytest/unit/triggers/test_triggers_principal.py`, `test_triggers_lifecycle.py`, new edit tests in that folder; new evaluation edit tests. `test_triggers_dispatcher.py` is D's. |

B touches no file under `web/`. The notice is E's.

### Builder C: MCP sign-in per person

| Area | Files |
| --- | --- |
| OAuth | `core/gateways/mcps/oauth/{storage,service,types}.py` (`storage.py` after A1; `service.py` adds `delete_sign_ins` for the gateway service) |
| Gateway | `core/gateways/mcps/{service,dtos,types,interfaces}.py` (the relay reads `run_account`); `core/gateways/policy/{resolution,dtos}.py` (the user branch of the secret resolver) |
| Storage | `dbs/postgres/gateways/mcps/{dao,dbes,dbas,mappings}.py` (`dbas.py` after A1) |
| Routes | `apis/fastapi/gateways/mcps/{router,models,proxy}.py`, including the `run_accounts` re-mint line |
| SDK | `sdks/python/agenta/sdk/agents/mcp/resolver.py` (required: `account_source=user` on the gateway URL of a `"user"` item) |
| Runner | `services/runner/src/extensions/pi-mcp.ts`, only if needed |

C calls `VaultService.get_personal_secret_by_slug`, `get_personal_secret_by_id`, `put_personal_secret`, `delete_personal_secret_by_slug`, `list_personal_sign_ins` and `delete_sign_ins` (A1); `run_account`, `run_person_id` and `run_accounts(request)` (A2). C does not edit `api/entrypoints/routers.py`.

### Builder D: Needs setup backend

| Area | Files |
| --- | --- |
| Domain | `core/agent_requirements/{__init__,dtos,guard,service}.py` (new, from 7887) |
| Routes | `apis/fastapi/workflows/{router,models}.py`; `apis/fastapi/gateways/exceptions.py`; `apis/fastapi/channels/router.py` |
| Services | `core/workflows/{service,types}.py` (after A2); `core/gateways/llms/{service,types}.py`; `core/channels/service.py`; `core/triggers/service.py` and `apis/fastapi/triggers/router.py` (after B1; the turn-on check only); `tasks/asyncio/triggers/dispatcher.py` |
| Wiring | `api/entrypoints/routers.py` (after A2) |
| SDK | `sdks/python/agenta/sdk/agents/{requirements,handler}.py`; `agents/platform/{__init__,requirements}.py`; `decorators/routing.py`; `middlewares/running/normalizer.py`; `models/workflows.py`; `agents/sandbox_credentials.py` and `agents/platform/connections.py` (after A2, 7887's changes only) |
| Tests | `api/oss/tests/pytest/unit/agent_requirements/**`; the 7887 SDK tests and services tests (`services/oss/tests/pytest/unit/agent/`) |

D does not port 7887's tools changes (`core/tools/*`, `apis/fastapi/tools/*`, `agents/platform/gateway.py`): A ports them. D calls `user_items_of_revision`, `AccountChoicesService.resolve` and `run_person_id`.

### Builder E: screens

| Area | Files |
| --- | --- |
| Everything under `web/` | `web/mobile/**`, `web/packages/**`, `web/storybook/**` |
| API client | `web/packages/agenta-api-client/src/generated/**`, regenerated from an EE OpenAPI spec of the package branch head (`bash ./clients/scripts/generate.sh --language typescript --file <spec>`); `web/packages/agenta-sdk/src/resources.ts` (adds `getAccountChoicesClient` and `getGatewayMcpClient`) |
| Needs setup frontend | every `web/` file of 7887 (section 11.3) |

No other builder edits a file under `web/` or `clients/`. A, C and D give E the routes of section 7 and the shapes of section 8.

### File table

| Builder | Owns (summary) | Edits after another builder |
| --- | --- | --- |
| A | migrations; secrets and vault; Composio connections and tools; `account_choices`; run credential and claim; the `end_for_member` call in `core/memberships/service.py`; SDK item models, `accounts.py`, sandbox credentials, secrets, gateway and connections platform files; `api/entrypoints/routers.py` until A2 | none |
| B | triggers interfaces, service, DAO and router; evaluations service and router | none |
| C | `core/gateways/mcps/**`, `core/gateways/policy/{resolution,dtos}.py`, `dbs/postgres/gateways/mcps/**`, `apis/fastapi/gateways/mcps/**`, SDK `agents/mcp/resolver.py`, runner `pi-mcp.ts` | `oauth/storage.py` and `mcps/dbas.py` after A1 |
| D | `core/agent_requirements/**`; workflows routes; LLM gateway requirement; channels; trigger dispatcher; SDK requirements and handler | `core/workflows/service.py`, `api/entrypoints/routers.py`, SDK `sandbox_credentials.py` and `platform/connections.py` after A2; `core/triggers/service.py` and `apis/fastapi/triggers/router.py` after B1 |
| E | all of `web/`, the generated client and `resources.ts` | none |

## 11. Reuse and delete

### 11.1 From the build (`feat/m7-*`)

| Pull request (branch) | Fate | Who |
| --- | --- | --- |
| 7883 (`feat/m7-durable-work-edits`) | Not copied. `core/access/durable_work.py`, `apis/fastapi/shared/durable_work.py`, the edit sorting in `core/triggers/service.py` and `core/evaluations/service.py`, the DAO `check` callbacks, the `owner_only` message in `useAutomationDraft.ts` and `test_durable_work_edits.py` stay out. | B |
| 7884 (`feat/m7-bindings`) | Copy: migration 055 (changed, section 3.2), the secret owner DTOs and DAO changes, the `sign_secret_token` claim plumbing (renamed), the `run_claims.py` carry-through, the env switch (renamed). Do not copy: `binding`, `Binding`, `ConnectionKey`, `BindingClaim`, `selection.py`, the EE organization switch in `policy.py` (`allow_personal_credentials`) and in `api/ee/src/core/organizations/service.py`, the personal provider key path in `core/gateways/llms/service.py` and `apis/fastapi/gateways/llms/{proxy,router,models}.py`, `test_personal_provider_keys.py`. `bindings.py` becomes `core/account_choices/items.py` and `sdks/python/agenta/sdk/agents/accounts.py`; `caller_user_id` becomes `run_person_id`. | A |
| 7885 (`feat/m7-sessions`) | Not copied: migration 056, the guard, the session-row lock, `PERSONAL_CREDENTIALS` in `core/sharing/dtos.py`, the check in sharing writes. | none |
| 7886 (`feat/m7-personal-tools`) | Copy: migration 057 (changed, section 3.3), `apis/fastapi/shared/personal.py`, the tools router `scope`, the callback owner, `entity_for`, `query_personal_connections`, `delete_personal_connections`, `lifecycle.py` (moved to `core/account_choices/`; called from `MembershipsService.remove_member`, not from `routers/workspace_router.py`). Replace `_resolve_personal_connection` and the per-call personal branch in `core/tools/service.py` with the claim reader. | A |
| 7889 (`feat/m7-personal-mcp`) | Not copied: migration 058, `create_personal_endpoint`, `delete_personal_endpoints`, `_personal_endpoint`, the `scope="user"` MCP reference. Read its runner relay change (`pi-mcp.ts`) and copy it only if a person's sign-in on a project server needs it. | C |
| 7892 (`feat/m7-account-record`) | Not copied: migration 059, `uses.py`, `dbs/postgres/credentials/**`, the session route changes. | none |
| 7893 (`feat/m7-remove-secret-mode`) | Not in the package. It removes `SecretMode` from `core/gateways/policy/*` and edits `core/gateways/mcps/service.py` (C's) and `core/gateways/llms/service.py` (D's), and the accounts work does not need it. It can ship alone later, rebased on C's change to `resolution.py`. | none |

### 11.2 From Needs setup (`feat/agent-needs-setup`)

| Part | Who |
| --- | --- |
| The backend and SDK files listed for builder D in section 10 | D |
| Tools `omit_unavailable`: `core/tools/{dtos,service}.py`, `apis/fastapi/tools/{models,router}.py`, `sdks/python/agenta/sdk/agents/platform/gateway.py`, `test_resolve_tools_concurrency.py` | A |
| Every `web/` file | E |

### 11.3 The 7887 frontend files (E)

`web/mobile/src/features/chat/{Composer,ConfigPane,LiveConversation,ModelSetupNotice,ModelSetupStrip,RunErrorMessage,TurnRow}.tsx`, `setupFailureRefresh.ts`, `useOpenModelSetup.ts`; `web/packages/agenta-chat/src/components/{ChatComposer,ModelSetupBanner,RunFailureCallout}.tsx`, `src/hooks/useAgentModelSetup.ts`; `web/packages/agenta-entities/src/workflow/{api/requirements.ts,requirements.ts,state/agentRequirements.ts,index.ts}`; the Needs setup files in `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/`; `web/packages/agenta-automation-ui/src/{AutomationRunRow.tsx,automationModel.ts,runListView.ts,runModel.ts}`; `web/packages/agenta-playground-ui/src/components/AgentBuildPanel.tsx`; the two stories; the tests.

## 12. Screens and their data (builder E)

| Screen | Files today | Calls |
| --- | --- | --- |
| Integrations: "Yours", the project group, "Make default" in the row menu, the default in the second line | `web/packages/agenta-settings-ui/src/tools/GatewayToolsSection.tsx`; `shared/SettingsCatalog.tsx` (the group label needs a node slot for the switch); `web/mobile/src/features/settings/IntegrationsTab.tsx` | `POST /tools/connections/query?scope=user` and `?scope=project`; `POST /tools/connections/{connection_id}/make-default` |
| Connect drawer with "Who can use it" | `web/packages/agenta-entity-ui/src/gatewayTool/drawers/ConnectDrawer.tsx` | `POST /tools/connections/?scope=user` or `?scope=project` |
| AI providers: the project group and the organization group, tabs removed | `web/packages/agenta-settings-ui/src/providers/{AIProvidersPage,ProvidersPanel,OrganizationProvidersPanel}.tsx`; `web/mobile/src/features/settings/LlmProvidersTab.tsx` | `GET /secrets/` (project); the shipped organization list (`web/packages/agenta-entities/src/secret/api/organizationSecrets.ts`) |
| Provider drawer with "Who can use it" (Settings context only) | `web/packages/agenta-entity-ui/src/secretProvider/{ProviderDrawer,OrganizationProjectsSection}.tsx` | `POST /secrets/` with `scope` `project` or `organization` |
| Secrets: "Yours" with "Used by", the project group | `web/packages/agenta-settings-ui/src/secrets/NamedSecretTable.tsx`; `web/mobile/src/features/settings/SecretsTab.tsx` | `GET /secrets/?scope=user`; `POST /account-choices/query` with `secret_ids`; `POST /workflows/query` for the agent names |
| Create secret with "Who can use it" | `web/mobile/src/features/settings/SecretFormSheet.tsx` | `POST /secrets/` with `scope` `user` or `project` |
| MCPs: "Yours" sign-ins, the project table | `web/packages/agenta-settings-ui/src/mcp/McpServersSection.tsx`; `web/mobile/src/features/settings/McpServersTab.tsx` | `POST /gateways/mcps/endpoints/query` (`user_sign_in`); `POST` and `DELETE /gateways/mcps/endpoints/{endpoint_id}/connect?owner_kind=user` |
| Project switch in the group header | `web/mobile/src/features/nav/DrawerProjectSwitcher.tsx`; `web/packages/agenta-navigation-ui/src/ProjectOrgSwitcher.tsx` | none; the host tab passes it in as a node |
| Tool permission drawer: "Account" block | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/IntegrationPermissionDrawer.tsx` (`PermissionDrawerBody`, one optional slot above "Default permission"); `AgentTemplateControl.tsx` | `POST /tools/connections/query?scope=project` (the select); `POST /account-choices/resolve` (the line); `POST /tools/connections/query?scope=user` (Change); `POST /account-choices/`; `make-default`; `POST /tools/connections/?scope=user` |
| MCP drawer: "Account" block | `web/packages/agenta-entity-ui/src/mcpEndpoint/McpPermissionDrawer.tsx`; `.../agentTemplate/McpServersSectionBody.tsx` | `POST /account-choices/resolve`; `POST` and `DELETE .../connect?owner_kind=user` |
| Attach a secret: "Account" select (draft texts) | `web/packages/agenta-entity-ui/src/secret/AgentSecretAttachmentModal.tsx`; `.../agentTemplate/AgentSecretsSection.tsx` | `POST /account-choices/resolve`; `GET /secrets/?scope=user`; `POST /account-choices/` |
| Chat: "Connect your accounts" card | `web/packages/agenta-entity-ui/src/onboarding/{AgentSetupCard,AccountRow}.tsx`, `copy.ts`; a new hook beside `web/mobile/src/features/chat/useSessionSetupStep.ts`; `LiveConversation.tsx` | `POST /workflows/revisions/requirements/query` (the requirements with `account_source: "user"`); then the setup calls above |
| Needs setup tag and banner | the 7887 files (section 11.3) | `POST /workflows/revisions/requirements/query` |
| Automation notice | `web/packages/agenta-automation-ui/src/{AutomationSaveBar.tsx,useAutomationDraft.ts,AutomationDetailBody.tsx}` | the trigger response `principal`; `POST /workflows/revisions/resolve` (the revision that the references resolve to now); `POST /workflows/revisions/requirements/query` |
| Share dialog warning (spec section 9, item 5) | `web/packages/agenta-sessions-ui/src/sharing/SessionShareDialog.tsx` | none: shown when the agent configuration has an item with `account_source: "user"` |

The screens read the switch from `GET /secrets/?scope=user`, once per session, like `organizationConnectionsAccessAtom`: `403` with `personal_accounts_disabled` hides "Yours", "Only me" and the "each person" options. No other switch reaches the frontend.

Strings: use the approved texts of `UX-DECISIONS.md`. Every other text is a draft, listed in the pull request under "Copy for approval".

## 13. Where this contract differs from the spec

1. **Vault path.** The spec writes `/vault/v1/secrets/`. The schema path is `/secrets/`; `/vault/v1` is a deprecated mount.
2. **The MCP gateway route says `account_source=user`.** The spec does not say how the gateway tells a `"user"` request from an `"agent"` one on the same slug path. The request says so, and the claim keeps only the ready accounts, as in the spec.
3. **No `"user"` subscription login in this package.** No flow creates a person's login, and the services' login path does not read the claim. So `resolve` never matches one, the upsert refuses `subscription:` keys (`choice_not_supported`), the vault refuses `scope=user` for kinds other than `custom_secret`, and a `"user"` subscription login is a missing model. The table still allows the row (spec requirement 11).
4. **A new vault route, `POST /secrets/resolve`.** The SDK reads a sandbox secret by slug, and a `"user"` secret has no slug. One call serves all `"user"` secrets, in parallel with the slug reads.
5. **`make-default` has no `scope`.** Only a person has a default (owner decision R25), so the route acts only on the caller's own connection. The spec's "a project admin the project's" is dropped.
6. **`resolve` accepts `parameters`.** The editor shows the "When you run it" line for an unsaved item, as the Needs setup route allows.
7. **`AgentRequirement.account_source`.** One added field, so that the screens never parse item keys.
8. **`user_sign_in` on the MCP endpoint response.** The MCPs "Yours" group needs the caller's sign-in per server, and the slug format stays inside the API.
9. **One more check, `ck_gateway_connections_default_user`.** It keeps project and organization rows at `is_default = false` (spec section 2.5) in the database, not only in code.
10. **The token field `token`.** The spec says "the token in the body" and gives no name.
11. **The `mcp_token` enum value has its own revision**, because Postgres cannot use a new enum value in the transaction that adds it.
12. **The evaluation notice has no screen.** `/m` has no screen to edit an evaluation run, so only the API rule applies.
13. **No `scope` on the by-id tools routes.** Spec 4.5 puts `scope` on delete. An id names one row, so fetch, delete, refresh, revoke and `make-default` read the owner from the row. `scope` stays on create and query.
14. **More query filters and indexes.** `query` also filters by `secret_ids` and `gateway_connection_ids` (the "Used by" line), with two partial indexes for them and for the cascades.
15. **The switch hides every person route.** Spec 8.5 refuses person writes and account choices while the switch is off. The contract also refuses the reads, so the screens can read the switch from one answer.
16. **The share dialog warning reads the agent configuration.** Spec 9 item 5 says "when a turn used a `"user"` item". No per-turn record exists (7892 is deleted), so the warning shows when the agent has a `"user"` item.
17. **7893 is not in the package.** Spec 8.1 keeps it. It is an independent refactor that edits files of two other builders.
18. **Leaving the organization is handled in `MembershipsService.remove_member`.** The build called `end_for_member` from one route only; main has a second path (the admin accounts service) that removes members.
19. **Accounts resolve at both first mints of a run credential.** The spec names only `core/workflows/service.py`; playground and chat turns get their credential from `POST /access/permissions/check`.
20. **A child run has no run person, from the envelope's origin.** The spec says so (3.1); `run_person_id` reads the envelope because a child keeps its parent's authority.
