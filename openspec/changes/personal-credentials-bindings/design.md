# Design: personal credentials and connection bindings (M7)

## Context

M7 starts after M1, M2, M3, M5, M6 and M9 and uses the names in CONTRACT.md. The principal model is the post-M6 one: `human | service_account`. A personal API key acts as its human. A service key and a channel installation act as a service account. Code evidence: `research-personal-credentials-bindings.md`.

## Decisions

### D1. Storage: M5 typed columns plus `user_id`

M7 keeps M5's typed storage (CONTRACT.md section 8) and adds a typed `user_id` column.

- `secrets`: a user row has `organization_id` and `user_id`, and no `project_id`. Only `provider_key`, `subscription_provider` and `oauth_grant` can be user rows.
- `gateway_connections`: a project row keeps `project_id` only. A user row has `organization_id` and `user_id`, and no `project_id`. So `project_id` becomes nullable and the primary key becomes `(id)`.
- `mcps_endpoints`: no change. The per-user part is the grant, a user-owned secret.

The core uses only the M5 DTO `SecretOwner(kind, id)`, for secrets and for gateway connections. The DAO maps `kind = user` to `user_id`, always with the organization scope of the run's project (CONTRACT.md section 6). M7 removes the second `SecretOwner(kind, user_id)` in `core/gateways/policy/dtos.py`.

The Composio entity is computed from the owner columns: `str(project_id)` for a project row (unchanged), `org:<organization_id>:user:<user_id>` for a user row. Nothing is stored in `data`, so there is no data migration.

### D2. One personal account per service

A user owns at most one credential per service in one organization. Service: the provider kind (provider keys, subscription logins), `(provider_key, integration_key)` (Composio), the endpoint id (MCP grants). User rows get canonical slugs, so partial unique indexes enforce the rule. The subscription duplicate check compares rows of the same owner only.

### D3. Reference shape and binding semantics

Each agent connection reference (`Connection`, `GatewayConnectionRef`, `MCPGatewayConnection`) gets:

```text
binding: caller_account | project_default | specific
slug: str | None              # project_default: the M5 named reference
credential_id: UUID | None    # specific: the exact credential
agent_account_id: UUID | None # caller_account: exact credential for runs without a human
```

- `project_default` is M5 resolution: with a slug, the project row, then the organization row with that slug; without a slug, the M5 default for the service. It never selects a user-owned row.
- `specific` is the exact binding of CONTRACT.md section 8: a project-owned credential of the run's project, or an organization-owned one available to that project. If it is gone or unavailable, the call is refused.
- `caller_account` selects the caller's user-owned credential (D4). `agent_account_id` follows the `specific` rules.
- `specific` and `agent_account_id` never name a user-owned credential.
- A stored revision without `binding` reads as `project_default` with its stored slug, which is its M5 meaning. No revision is rewritten or reclassified.
- An exact binding is a database id, so it is not portable. M6 refuses to move an agent whose `specific` binding names a source-project credential.

| Connection kind | `caller_account` | `project_default` | `specific` |
| --- | --- | --- | --- |
| Model, `agenta` (provider key) | yes | yes | yes |
| Model, `self_managed` with a slug (subscription login) | yes | yes (project logins only) | yes (project-owned only) |
| Tool, Composio | yes | yes, with a slug | yes |
| MCP, custom OAuth endpoint | yes (caller's grant) | yes (project grant, today) | no |
| MCP, other auth modes | no | yes (today) | no |

`self_managed` without a slug (the runner operator's login) is not an Agenta credential and does not change. A path that delivers a value into the sandbox refuses an organization-owned credential (CONTRACT.md section 8), also through `specific` or `agent_account_id`.

### D4. The caller

`caller_account` uses `principal.id` when the run principal is `human`, and finds no caller when it is `service_account`. The origin does not matter: a schedule carries its executing principal (CONTRACT.md section 5), and a door child run inherits its parent's principal (CONTRACT.md section 10). A user-owned credential is valid in every project of its organization, so a door child run can use it.

A run with a human uses that human's credential or is refused. A run without a human uses `agent_account_id` or is refused. The agent account is never used because a human has no account.

### D5. Signed binding claims

`_prepare_invoke` derives the bindings from the resolved revision and signs them into the run credential as `gateway_bindings` (`{connection_key, binding, credential_id?, agent_account_id?}`). `issue_gateway_credentials` copies the claim, as it copies `gateway_tools`. Gateway lookups and vault reads with a run credential apply it. A lookup with no claim for its key resolves as `project_default` with the slug it names, and never as `caller_account`. This also covers credentials minted before M7.

### D6. Shared-session guard and sticky mark

The rule applies to the selected credential, not to the binding (CONTRACT.md section 8). So a Slack channel session works with a project-owned agent account. A human in a shared session who reaches `caller_account` is refused, and the system does not switch to the agent account.

When the selected credential is user-owned and the run has a session, before the value is released or the provider is called, one transaction:

1. locks the session row (`SELECT ... FOR UPDATE` on `session_streams`);
2. refuses if the session is shared (project-visible, any grant, or a channel session);
3. otherwise sets `personal_credentials_used_at` if null, and commits.

M3 sharing writes lock the same row and refuse a marked session, so sharing and first personal use cannot interleave. A marked session can never become shared, so a set mark needs no lock. A run without a session has no other reader.

### D7. Installation check

`ChannelsService.create_agent` and `edit_agent` refuse a binding when a `caller_account` connection has no agent account, and list those connections. The binding can follow a moving reference, so D4 also refuses at run time.

### D8. Per-run account record

`run_credential_uses` stores, per run and connection key, the binding, owner kind, owner id, credential id and display name. No value, no provider email. It joins to the turn by `RunContext.run_id`.

### D9. Lifecycle and EE policy

- Only the owner lists, reads metadata of, refreshes, uses or deletes a user-owned credential. Organization owners and EE no-RBAC shortcuts do not change this.
- When a user leaves an organization (M1 `remove_member`, EE SSO deprovisioning), one service call deletes the user's rows there. Composio revocation is best effort.
- Deleting an MCP endpoint deletes its user grants.
- EE: `OrganizationFlags.allow_personal_credentials` (default `True`). `False` refuses new user-owned credentials and every selection of one. OSS ignores it. Changes are audit events.

## Data structures

All revisions go in `core_oss`.

| Table | Change |
| --- | --- |
| `secrets` | `user_id` (FK `users.id`, cascade). The single-owner check allows a project row, an organization row, or a user row (`organization_id` and `user_id`). Check: `user_id IS NULL OR kind IN ('provider_key','subscription_provider','oauth_grant')`. Recreate `uq_secrets_organization_id_slug` with `AND user_id IS NULL`. Partial unique `(organization_id, user_id, slug) WHERE user_id IS NOT NULL`. |
| `gateway_connections` | `organization_id`, `user_id` (FKs, cascade). `project_id` nullable. Check: project row or user row. Primary key `(id)`; keep unique `(project_id, id)` for the `trigger_subscriptions` FK. Partial unique `(organization_id, user_id, provider_key, integration_key) WHERE user_id IS NOT NULL`. Partial index on `(organization_id, user_id, (data ->> 'connected_account_id'))` for the callback. |
| `mcps_oauth_attempts` | `grant_user_id` nullable. Set: the callback writes a user grant; it must equal the attempt's `user_id`. |
| `session_streams` | `personal_credentials_used_at timestamptz NULL`. |
| `run_credential_uses` (new) | `project_id`, `run_id`, `connection_key`, `binding`, `owner_kind`, `owner_id`, `credential_id` (no FK), `credential_name`, `created_at`. Primary key `(project_id, run_id, connection_key)`; `ON CONFLICT DO NOTHING`. |

## Interfaces

Core (`api/oss/src/core/credentials/`):

```python
class Binding(str, Enum):
    CALLER_ACCOUNT = "caller_account"
    PROJECT_DEFAULT = "project_default"
    SPECIFIC = "specific"

@dataclass(frozen=True)
class ConnectionKey:
    kind: Literal["model", "subscription", "tool", "mcp"]
    service: str                  # provider kind | "composio:<integration>" | endpoint id
    slug: str | None

@dataclass(frozen=True)
class BindingClaim:
    key: ConnectionKey
    binding: Binding
    credential_id: UUID | None
    agent_account_id: UUID | None

@dataclass(frozen=True)
class SelectedCredential:
    owner: SecretOwner            # M5 DTO
    credential_id: UUID
    name: str

class CredentialBindingService:
    async def select(self, *, authority: RunAuthority, context: RunContext,
                     session_id: str | None, key: ConnectionKey,
                     claim: BindingClaim | None) -> SelectedCredential: ...
        # D3, D4, D6 guard, EE policy; records the use (D8)
    def binding_claims_for_revision(self, *, revision_data: dict) -> list[BindingClaim]: ...
    def installation_gaps(self, *, revision_data: dict) -> list[ConnectionKey]: ...

class PersonalCredentialsService:
    async def list_mine(self, *, organization_id: UUID, user_id: UUID) -> list[PersonalCredentialView]: ...
    async def delete_mine(self, *, organization_id: UUID, user_id: UUID, credential_id: UUID) -> None: ...
    async def end_for_member(self, *, organization_id: UUID, user_id: UUID) -> int: ...
```

Changed seams:

- `SecretsResolverInterface.resolve` calls `CredentialBindingService.select`. `SecretMode` is removed.
- DAOs: owner-scoped reads and deletes for user rows; `SessionStreamsDAOInterface.guard_personal_use(project_id, session_id)` runs the D6 transaction; every reader of organization rows filters `user_id IS NULL`.
- Composio: `initiate_connection` takes `owner: SecretOwner`; the OAuth state signs the owner; initiate, refresh, runs, discovery, legacy `/tools/call` and the MCP adapter use the computed entity.
- `SecretsTokenStorage` takes `owner: SecretOwner`. Refresh still reads the client registration from the endpoint's project.
- Routes: create accepts `owner: "project" | "user"`. New `GET /credentials/mine` and `DELETE /credentials/mine/{id}`.

## Migration and mixed-version behavior

One expand release (A) adds the schema. No backfill: every existing row has `user_id` null, and stored revisions keep their meaning.

| Work type | Old pods, new schema | New pods, old data |
| --- | --- | --- |
| Secret reads | Old M5 code reads organization rows by `organization_id AND project_id IS NULL`, so it would read a user row as an organization credential. Gated. | Same as M5. |
| Gateway connections | Reads by `project_id`; never sees a user row. | Same entity ids as today. |
| MCP OAuth attempts | An old pod would write a user attempt's grant to the project. Gated. | Null means project grant. |
| Session sharing | Old M3 code ignores the mark. Gated. | No session is marked. |
| Run credentials, queued work, parked approvals | Minted without `gateway_bindings`. | Missing claim resolves as `project_default` (D5). No drain needed. |
| Agent revisions | Old SDKs reject new fields on the tool and MCP references (`extra="forbid"`) and ignore them on `Connection`, so a `specific` model reference would become the default. Gated. | No `binding` reads as `project_default`. |

Gate: user rows, user OAuth attempts and non-default binding writes stay refused until every API pod runs release A (rollback floor set) and the runner SDK parses bindings. Then a per-organization flag enables them. Flag off refuses every selection of a user-owned credential and never falls back.

## Risks

- A past turn can carry personal data into a session; the mark stops later sharing only. Accepted.
- Per-user Composio entities: check Composio cost and rate limits before launch.
- MCP consent is per endpoint, so a user consents again in another project. Accepted.
- A gateway credential keeps its bindings for its lifetime; a binding change applies from the next run.

## Open questions

1. `gateway_connections` primary key becomes `(id)` with a nullable `project_id` (one-way door). Recommendation: accept.
2. Composio entity format `org:<organization_id>:user:<user_id>` lives at Composio; changing it means reconnecting every personal account. Recommendation: accept.
3. How does the server refuse a run on a self-hosted runner whose SDK predates bindings? Recommendation: the runner reports its SDK version at run start, and `_prepare_invoke` refuses a revision with a non-default binding (fail closed).
4. One personal account per service blocks two Gmail accounts. Recommendation: accept for M7.
