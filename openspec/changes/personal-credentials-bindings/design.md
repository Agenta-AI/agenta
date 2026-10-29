# Design: personal credentials and connection bindings (M7)

## Context

M7 starts after M1, M2, M3 and M5 and uses the names in CONTRACT.md. It does not wait for M6, and it ships only after M9b (CONTRACT.md section 14). The principal model is the M2 one: `human | api_key | installation`. When M6a ships, a personal API key acts as its human, and a service key and a channel installation act as a service account. Code evidence: `research-personal-credentials-bindings.md`.

Owner decisions that shape this design (2026-10-26 and 2026-10-28):

- M5 is option B: an agent uses exactly the connection it picked, from the project or from the organization. Nothing is inherited or overridden by name. M7 builds on that named reference.
- MCP servers, Composio connections and custom secrets each belong to a person or to a project. For each agent and item, the builder picks "Each person's own account" or "The project's shared account". "One fixed account" is not in the first step. Agenta is multiplayer, so the first step covers the two choices that a shared agent needs.
- Personal MCP servers are in M7.
- Personal and organization custom secrets wait for hidden secrets (the sandbox gets a placeholder; the real value is added outside the sandbox).
- Organization subscription logins ship in M5. Personal subscription logins stay in M7.
- The organization level for MCP servers, Composio connections and custom secrets is optional: only if it is easy.
- A channel turn uses the linked user's own account for a `caller_account` connection. A channel turn from an unlinked user is refused at run time with a short note, never when a binding is saved, and never uses the account of the person who created the channel connection (2026-10-28).
- Personal MCP servers use the new reference scope `user` (2026-10-28).
- The edit rule for durable work is D10 (2026-10-28).
- M7 does not wait for M6. Until M6a exists, every API-key run has no person, so it is refused on `caller_account` connections (2026-10-28).
- No checks at save time (CONTRACT.md section 15).

## Decisions

### D1. Storage: M5 typed columns plus `user_id`

M7 keeps M5's typed storage (CONTRACT.md section 8) and adds a typed `user_id` column.

- `secrets`: a user row has `organization_id` and `user_id`, and no `project_id`. In the first step only `provider_key`, `subscription_provider` and `oauth_grant` can be user rows. `custom_secret` user rows come with hidden secrets (D11).
- `gateway_connections`: a project row keeps `project_id` only. A user row has `organization_id` and `user_id`, and no `project_id`. So `project_id` becomes nullable and the primary key becomes `(id)`.
- `mcps_endpoints`: a project row keeps `project_id` only (today). A user row (a personal MCP server) has `organization_id` and `user_id`, and no `project_id`. So `project_id` becomes nullable and the primary key becomes `(id)`. The slug is unique per owner. The per-user sign-in to a project's server stays a user-owned `oauth_grant` secret.

The core uses only the M5 DTO `SecretOwner(kind, id)`, for secrets, gateway connections and MCP servers. The DAO maps `kind = user` to `user_id`, always with the organization scope of the run's project (CONTRACT.md section 6). M7 removes the second `SecretOwner(kind, user_id)` in `core/gateways/policy/dtos.py`.

The Composio entity is computed from the owner columns: `str(project_id)` for a project row (unchanged), `org:<organization_id>:user:<user_id>` for a user row. Nothing is stored in `data`, so there is no data migration.

### D2. One personal account per service

A user owns at most one credential per service in one organization. Service: the provider kind (provider keys, subscription logins), `(provider_key, integration_key)` (Composio), the server slug (personal MCP servers), the server id (MCP grants to a project's server). User rows get canonical slugs, so partial unique indexes enforce the rule. The subscription duplicate check compares rows of the same owner only.

### D3. Reference shape and binding semantics

Each agent connection reference (`Connection`, `GatewayConnectionRef`, `MCPGatewayConnection`) gets a `binding` next to the M5 named reference (scope and slug):

```text
binding: caller_account | project_default
```

| Binding | UI label | Meaning |
| --- | --- | --- |
| `caller_account` | Each person's own account | The run uses the credential of the human behind the run principal (D4). |
| `project_default` | The project's shared account | The run uses the M5 named reference: the connection with that scope and slug, from the project or from the organization, exactly as the builder picked it. Without a slug, the M5 default for the service. It never selects a user-owned row. |

- The `specific` binding of CONTRACT.md section 8 ("One fixed account") is not in the first step. The server refuses a revision that sets it.
- A stored revision without `binding` reads as `project_default` with its stored named reference, which is its M5 meaning. No revision is rewritten or reclassified.
- MCP references also carry the M5 scope. With scope `project`, `caller_account` means the project's server with each person's own sign-in. With scope `user`, the reference names a personal MCP server by slug, and only `caller_account` is valid: each person's own server with that slug.

| Connection kind | `caller_account` | `project_default` |
| --- | --- | --- |
| Model, `agenta` (provider key) | yes | yes |
| Model, `self_managed` with a slug (subscription login) | yes (personal login) | yes (project login; organization login per M5) |
| Tool, Composio | yes | yes, with a slug |
| MCP, project server with OAuth | yes (caller's own sign-in) | yes (project sign-in, today) |
| MCP, project server with other auth modes | no | yes (today) |
| MCP, personal server (scope `user`) | yes (caller's own server) | no |
| Custom secret | later step (D11) | yes (today) |

`self_managed` without a slug (the runner operator's login) is not an Agenta credential and does not change. A path that delivers a value into the sandbox refuses an organization-owned credential (CONTRACT.md section 8).

### D4. The caller

`caller_account` uses the person behind the run. The run principal decides who that is:

| Run principal | Person |
| --- | --- |
| `human` | `principal.id` |
| `installation` (a channel turn) | `RunAuthority.linked_user_id`, the linked user whose role the turn already uses (CONTRACT.md section 4); none when the channel user is not linked |
| `api_key` | none |

After M6a, a personal key is a `human` principal and acts as its human. A service key and an installation are `service_account` principals. An installation turn still takes its person from `linked_user_id`; a service key has none.

The origin does not matter: a schedule carries its executing principal (CONTRACT.md section 5), and a door child run inherits its parent's principal (CONTRACT.md section 10). A user-owned credential is valid in every project of its organization, so a door child run can use it.

A run with a person uses that person's credential or is refused. A run with no person is refused on every `caller_account` connection. The first step has no agent account. It never uses a project credential in place of a person's own account, and it never uses the account of the binding creator or of the person who created the channel connection.

### D5. Signed binding claims

`_prepare_invoke` derives the bindings from the resolved revision and signs them into the run credential as `gateway_bindings` (`{connection_key, binding}`). `issue_gateway_credentials` copies the claim, as it copies `gateway_tools`. Gateway lookups and vault reads with a run credential apply it. A lookup with no claim for its key resolves as `project_default` with the named reference it carries, and never as `caller_account`. This also covers credentials minted before M7.

### D6. Shared-session guard and sticky mark

The rule applies to the selected credential, not to the binding (CONTRACT.md section 8). A human in a shared session who reaches `caller_account` is refused, and the system does not switch to another account.

When the selected credential is user-owned and the run has a session, before the value is released or the provider is called, one transaction:

1. locks the session row (`SELECT ... FOR UPDATE` on `session_streams`);
2. refuses if the session is shared (project-visible, any grant, or a channel session), except for a channel turn (D7);
3. otherwise sets `personal_credentials_used_at` if null, and commits.

M3 sharing writes lock the same row and refuse a marked session, so sharing and first personal use cannot interleave. A marked session can never become shared, so a set mark needs no lock. A run without a session has no other reader.

### D7. Channel turns

A channel turn uses the linked user's own account on a `caller_account` connection (D4). A channel turn from an unlinked user is refused on that connection when it runs, with a short note that asks the user to link their account. `ChannelsService.create_agent` and `edit_agent` do not check bindings: saving or activating a channel binding is never refused because the agent has a `caller_account` connection (CONTRACT.md section 15).

A channel session is shared (D6), but a channel turn of a linked user still uses that user's own account. This is the one exception to the shared-session rule (CONTRACT.md section 4). The guard does not refuse the channel turn and does not mark the channel session. A web turn in a channel session follows D6 and is refused.

### D8. Per-run account record

`run_credential_uses` stores, per run and connection key, the binding, owner kind, owner id, credential id and display name. No value, no provider email. It joins to the turn by `RunContext.run_id`.

### D9. Lifecycle and EE policy

- Only the owner lists, reads metadata of, refreshes, uses or deletes a user-owned credential or a personal MCP server. Organization owners and EE no-RBAC shortcuts do not change this.
- When a user leaves an organization (M1 `remove_member`, EE SSO deprovisioning), one service call deletes the user's rows there, including personal MCP servers. Composio revocation is best effort.
- Deleting a project's MCP server deletes its user grants.
- EE: `OrganizationFlags.allow_personal_credentials` (default `True`). `False` refuses new user-owned credentials and every selection of one. OSS ignores it. Changes are audit events.

### D10. Edit rule for durable work

CONTRACT.md sections 5 and 6 assign this rule to M7 (owner decision 4, option 3, 2026-10-22). Personal credentials make it necessary: without it, Bob could edit Alice's schedule and make her Gmail send mail.

- Durable work: a trigger schedule, a trigger subscription, an evaluation run. Each stores its executing principal (M2).
- Only the executing principal may change what the work executes: the target agent or environment reference, the input, and for an evaluation run its configuration (target revisions, testset, evaluators).
- Others with the capability (`EDIT_TRIGGERS`, `EDIT_EVALUATION_RUNS`) may pause, stop, archive or delete it. These actions never change the executing principal.
- A rerun or a copy is new work. Its executing principal is the person who starts it.
- The check runs in the trigger and evaluation services, after the capability check, and compares the request principal with the stored principal. A refusal names the person the work runs as.
- Work that runs as an API key can be changed only with that same key. After M6a, work that runs as a service account can be changed only by that same service account.

### D11. Later steps

- Custom secrets: when hidden secrets exist (the sandbox gets a placeholder; the value is added outside the sandbox), `custom_secret` gets user rows and the `caller_account` binding. Organization custom secrets come with the same work. Until then, custom secrets stay project rows and keep today's behavior.
- `specific` ("One fixed account"): a later step adds it with the rules of CONTRACT.md section 8 (an exact credential id, never user-owned, never substituted).
- Organization-owned MCP servers and Composio connections: only if easy; they use the M5 organization owner and project allow-list.
- Out of scope: agent-owned accounts, tool settings per role, hosted MCP servers.

## Data structures

All revisions go in `core_oss`.

| Table | Change |
| --- | --- |
| `secrets` | `user_id` (FK `users.id`, cascade). The single-owner check allows a project row, an organization row, or a user row (`organization_id` and `user_id`). Check: `user_id IS NULL OR kind IN ('provider_key','subscription_provider','oauth_grant')`. Recreate `uq_secrets_organization_id_slug` with `AND user_id IS NULL`. Partial unique `(organization_id, user_id, slug) WHERE user_id IS NOT NULL`. |
| `gateway_connections` | `organization_id`, `user_id` (FKs, cascade). `project_id` nullable. Check: project row or user row. Primary key `(id)`; keep unique `(project_id, id)` for the `trigger_subscriptions` FK. Partial unique `(organization_id, user_id, provider_key, integration_key) WHERE user_id IS NOT NULL`. Partial index on `(organization_id, user_id, (data ->> 'connected_account_id'))` for the callback. |
| `mcps_endpoints` | `organization_id`, `user_id` (FKs, cascade). `project_id` nullable. Check: project row or user row. Primary key `(id)`; keep unique `(project_id, id)`. Keep `uq_mcps_endpoints_project_slug` for project rows; partial unique `(organization_id, user_id, slug) WHERE user_id IS NOT NULL`. |
| `mcps_oauth_attempts` | `grant_user_id` nullable. Set: the callback writes a user grant; it must equal the attempt's `user_id`. |
| `session_streams` | `personal_credentials_used_at timestamptz NULL`. |
| `run_credential_uses` (new) | `project_id`, `run_id`, `connection_key`, `binding`, `owner_kind`, `owner_id`, `credential_id` (no FK), `credential_name`, `created_at`. Primary key `(project_id, run_id, connection_key)`; `ON CONFLICT DO NOTHING`. |

## Interfaces

Core (`api/oss/src/core/credentials/`):

```python
class Binding(str, Enum):
    CALLER_ACCOUNT = "caller_account"
    PROJECT_DEFAULT = "project_default"

@dataclass(frozen=True)
class ConnectionKey:
    kind: Literal["model", "subscription", "tool", "mcp"]
    service: str                  # provider kind | "composio:<integration>" | MCP server slug
    scope: Literal["project", "organization", "user"]
    slug: str | None

@dataclass(frozen=True)
class BindingClaim:
    key: ConnectionKey
    binding: Binding

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

class PersonalCredentialsService:
    async def list_mine(self, *, organization_id: UUID, user_id: UUID) -> list[PersonalCredentialView]: ...
    async def delete_mine(self, *, organization_id: UUID, user_id: UUID, credential_id: UUID) -> None: ...
    async def end_for_member(self, *, organization_id: UUID, user_id: UUID) -> int: ...

class DurableWorkEditPolicy:
    def check_change(self, *, principal: PrincipalRef, stored: PrincipalRef,
                     change: Literal["execution", "lifecycle"]) -> None: ...
        # D10: "execution" requires principal == stored; "lifecycle" (pause, stop, archive, delete) does not
```

Changed seams:

- `SecretsResolverInterface.resolve` calls `CredentialBindingService.select`. `SecretMode` is removed.
- DAOs: owner-scoped reads and deletes for user rows; `SessionStreamsDAOInterface.guard_personal_use(project_id, session_id)` runs the D6 transaction; every reader of organization or project rows filters `user_id IS NULL`.
- MCP: the MCP gateway resolves a scope `user` reference to the caller's personal server; the server list in `/m` shows "Mine" next to the project's servers.
- Composio: `initiate_connection` takes `owner: SecretOwner`; the OAuth state signs the owner; initiate, refresh, runs, discovery, legacy `/tools/call` and the MCP adapter use the computed entity.
- `SecretsTokenStorage` takes `owner: SecretOwner`. Refresh still reads the client registration from the server's project.
- Triggers and evaluations: edit routes call `DurableWorkEditPolicy.check_change` (D10).
- Routes: create accepts `owner: "project" | "user"`. New `GET /credentials/mine` and `DELETE /credentials/mine/{id}`.

## Migration and mixed-version behavior

One expand release (A) adds the schema. No backfill: every existing row has `user_id` null, and stored revisions keep their meaning.

| Work type | Old pods, new schema | New pods, old data |
| --- | --- | --- |
| Secret reads | Old M5 code reads organization rows by `organization_id AND project_id IS NULL`, so it would read a user row as an organization credential. Gated. | Same as M5. |
| Gateway connections | Reads by `project_id`; never sees a user row. | Same entity ids as today. |
| MCP servers | Reads by `project_id`; never sees a user row. | Every reference without scope reads as scope `project`. |
| MCP OAuth attempts | An old pod would write a user attempt's grant to the project. Gated. | Null means project grant. |
| Session sharing | Old M3 code ignores the mark. Gated. | No session is marked. |
| Durable work edits | Old pods allow any edit with the capability, as in M2. The rule is enforced once every pod runs release A. | Every row has a stored principal from M2. |
| Run credentials, queued work, parked approvals | Minted without `gateway_bindings`. | Missing claim resolves as `project_default` (D5). No drain needed. |
| Agent revisions | Old SDKs reject new fields on the tool and MCP references (`extra="forbid"`) and ignore them on `Connection`. Gated. | No `binding` reads as `project_default`. |

Gate: user rows, user OAuth attempts and `caller_account` binding writes stay refused until every API pod runs release A (rollback floor set) and the runner SDK parses bindings. Then a per-organization flag enables them. Flag off refuses every selection of a user-owned credential and never falls back.

## Risks

- A past turn can carry personal data into a session; the mark stops later sharing only. Accepted.
- Per-user Composio entities: check Composio cost and rate limits before launch.
- MCP consent is per server, so a user consents again in another project. Accepted.
- A gateway credential keeps its bindings for its lifetime; a binding change applies from the next run.
- An unlinked channel user gets a refusal, not an answer, when a turn reaches a `caller_account` connection.
- A linked user's channel turn acts with that user's own account, and the result is in a channel session that other people read (D7).
- Until M6a, a script that calls an agent with an API key is refused on every `caller_account` connection.
- A teammate cannot fix a colleague's broken schedule in place after D10. They copy it, and the copy runs as them.

## Open questions

1. `gateway_connections` and `mcps_endpoints` primary keys become `(id)` with a nullable `project_id` (one-way door). Recommendation: accept.
2. Composio entity format `org:<organization_id>:user:<user_id>` lives at Composio; changing it means reconnecting every personal account. Recommendation: accept.
3. How does the server refuse a run on a self-hosted runner whose SDK predates bindings? Recommendation: the runner reports its SDK version at run start, and `_prepare_invoke` refuses a revision with a non-default binding (fail closed).
4. One personal account per service blocks two Gmail accounts. Recommendation: accept for M7.
