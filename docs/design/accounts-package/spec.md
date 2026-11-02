# Accounts for agent items: spec draft v3

Status: approved by the owner, 2026-10-29. This is the one document for the accounts work. It replaces the account parts of the personal credentials change (`openspec/changes/personal-credentials-bindings`) and adds to the Needs setup change (pull request 7887). Code facts come from `main` at `a77e503782`, from the unmerged personal credentials build (pull requests 7883 to 7893, called "the build" below), and from the Needs setup build (pull request 7887).

## Summary

An agent needs things from outside Agenta: a model login or key, Composio tools, MCP servers and secret values. Each of these items says whose account fills it, with one field, `account_source`:

- `"agent"`: the account the agent was set up with. Every run uses it, including runs from Slack and Telegram users who have no Agenta account. This is today's behavior, and it is what an item without the field means.
- `"user"`: the own account of the person the run is for.

For a `"user"` item, Agenta finds the person's account with one fixed rule per item kind:

- A Composio tool uses the person's default connection for the integration (for example their default Gmail connection), unless the person chose another one for this agent.
- An MCP server uses the person's own sign-in to the same server. There is nothing to choose.
- A custom secret always uses the secret the person chose for this agent. Agenta asks once and stores the answer.

The stored answers live in one new table, `account_choices`: one row per person, agent and item. At run start the API reads every account the run needs in one query and signs the result into the run credential. The model gateway, the MCP gateway, the tools service and the vault then use only the accounts in the credential. A missing personal item never stops a run: the agent runs without it, and Needs setup asks the person to set it up. In the agent editor, the item's own drawer says whose account the item uses and, for the person who opens it, which of their accounts their runs use. The item rows do not change.

## Terms

The "Naming" section repeats these terms with the words to avoid and the name in every layer.

- **Item.** One thing an agent needs from outside Agenta. There are five item kinds: a provider key (an API key for a model provider such as OpenAI), a subscription login (a stored Claude or ChatGPT login that the harness signs in with), a Composio tool (a tool of an app such as Gmail, reached through Composio), an MCP server, and a custom secret (a value the sandbox gets as an environment variable, for example `GITHUB_TOKEN`).
- **Account.** One stored row that fills an item. Accounts live in two tables. `secrets` holds provider keys, subscription logins, custom secrets and MCP sign-ins. `gateway_connections` holds Composio connections.
- **Owner.** Who holds an account: a person (always inside one organization), a project, or an organization. In prose, "personal" and "your own" mean owned by a person. In code the owner kind is `user`.
- **Account source.** The item field `account_source`, with the values `"agent"` and `"user"`.
- **Run person.** The person a run is for. Some runs have none.
- **Sign-in.** The OAuth grant or pasted token of a person or a project for one MCP server. It is a `secrets` row. A `"user"` MCP item uses a sign-in that the person owns.
- **Default.** The one Composio connection that an owner marks for an integration. It is not the provider scan that picks a model's key when the model names no slug, which the shipped SDK text also calls a default.
- **Account choice.** A stored row that says: for this person, this agent and this item, use this account. Only `"user"` items have account choices.
- **Item key.** A short text that names one `"user"` item inside one agent, for example `secret:user/GITHUB_TOKEN`.
- **Match.** How Agenta found the account of a `"user"` item: from an account choice, from a default, or from a sign-in.
- **Run credential.** The signed token that a run presents to the Agenta API.
- **Automation.** A schedule, a trigger subscription or an evaluation run: work that runs an agent in the background.
- **Executing principal.** The identity an automation runs as, stored on its row: a person, an API key or a channel installation.
- **Needs setup.** The check that tells a person which items of an agent are not ready, and the run rule that leaves missing items out of a run (pull request 7887).
- **Builder.** The person, or the builder's AI agent, who edits the agent configuration.

## 1. Requirements

1. Each item says whose account fills it with one field, `account_source`, with the values `"agent"` and `"user"`. An item without the field is `"agent"`.
2. An `"agent"` item uses the account it names, for every run, as today. A project or an organization owns that account. Agenta does not check whether the run person is a project member.
3. A `"user"` item uses an account that the run person owns, and never a project or organization account.
4. A `"user"` Composio tool uses the person's default connection for the integration. A person who wants another connection for one agent chooses it, and the choice is stored for that agent only.
5. A `"user"` MCP server uses the person's own sign-in to the same server, found by the server's id. Agenta asks nothing.
6. A `"user"` custom secret uses the secret that the person chose for that agent. Agenta always asks, because a person can have several secrets with the same name.
7. A person can have several accounts for one app or provider, and so can a project. Nothing limits an owner to one account per service.
8. Defaults exist only where the item has a key that is the same for everyone: today that is the Composio integration. MCP servers and custom secrets have no such key and no defaults. A later Agenta MCP registry can give MCP servers a key and then a default.
9. A missing or unusable `"user"` account never stops a run. The item is left out, and the agent runs without it. Only a missing model stops a run.
10. Agenta reads the accounts of a run once, at run start. Every path that uses an account during the run uses only those accounts.
11. Provider keys are always `"agent"`. Subscription logins accept `"user"` in the data model. The flow that creates a person's own subscription login is out of scope for now.
12. Personal custom secrets are in scope in the data model, the API and the interface. Organization custom secrets are in scope in the data model and the API, with no interface for now.
13. The interface shows whose account an item uses inside the item's drawer, not on the item row. For a `"user"` item, the drawer shows the person which of their accounts their runs use, and lets them change it.
14. A person can set up a `"user"` item with only the permission to run the agent. A setup step never changes the agent configuration.

## 2. Data model

### 2.1 Where accounts are stored

No new account table is added. The accounts stay in the tables that hold them today:

| Item kind | Account row | Table |
| --- | --- | --- |
| Provider key | `kind = provider_key` (or `custom_provider`) | `secrets` |
| Subscription login | `kind = subscription_provider` | `secrets` |
| Custom secret | `kind = custom_secret` | `secrets` |
| MCP server, OAuth | the sign-in: `kind = oauth_grant` at the slug `grant_slug(server id)` | `secrets` |
| MCP server, token | a project: the custom secret that the server row names (`mcps_endpoints.secret_id`, today). A person: the sign-in, `kind = mcp_token` (new) at the slug `token_slug(server id)` | `secrets` |
| Composio tool | a Composio connection | `gateway_connections` |

The MCP server itself (a row in `mcps_endpoints`) is not an account. It stays owned by its project, as today. Only the sign-in to it can belong to a person.

Project and person sign-ins differ for token servers, and the spec keeps today's project rule:

- A project's token is the custom secret that the server row names by `secret_id`, set when the server is added or edited. Nothing changes.
- A person's token is a new kind, `mcp_token`, at the slug `token_slug(server id)`, written only by `connect` (section 4.4). A separate kind keeps a person's MCP tokens out of their custom secret lists, the secret picker and the account choice check with no extra rule, the same way the shipped kinds `channel_secret` and `webhook_provider` keep their rows apart. It costs one enum value (`ALTER TYPE secretkind_enum ADD VALUE`), one data shape that reuses the custom secret shape, one branch in the kind dispatch of `core/secrets/dtos.py`, and an entry in `CREDENTIAL_FIELDS` in `core/secrets/redaction.py`. Like `oauth_grant`, an `mcp_token` row is write-only: no API response returns its value, and only the MCP gateway reads it.
- `grant_slug(server id)` exists on main (`core/gateways/mcps/oauth/storage.py`). `token_slug(server id)` is a new helper in the same file, built the same way (`get_slug_from_name_and_id("mcp-token", server id)`). That file is the one place that owns both formats. The two slugs differ only in their name part, and each belongs to its own kind, so a custom secret with the same text cannot be taken for a sign-in.

### 2.2 How ownership is stored

`secrets` and `gateway_connections` each have three owner columns: `project_id`, `organization_id` and `user_id`. A check rule allows exactly three shapes:

| Owner | `project_id` | `organization_id` | `user_id` |
| --- | --- | --- | --- |
| Project | set | empty | empty |
| Organization | empty | set | empty |
| Person | empty | set | set |

A person's row also carries the organization, because a person owns accounts inside one organization. So each row belongs to exactly one project, one organization, or one person in one organization.

Each owner column is a real foreign key with a cascade, so deleting a project, an organization or a user also deletes its accounts. The other possible shape, two columns `owner_kind` and `owner_id`, reads more simply but is worse: `owner_id` would point to three tables, so the database could no longer check it or cascade deletes.

The check rule is `ck_secrets_single_owner` (on main, extended by the build) and `ck_gateway_connections_single_owner` (new name, see "Naming").

### 2.3 What each owner may hold

| Kind | Project | Organization | Person |
| --- | --- | --- | --- |
| Provider key | yes (today) | yes (today) | no |
| Subscription login | yes (today) | yes (today) | allowed by the table; no flow creates one yet |
| Custom secret | yes (today) | yes, API only (new) | yes (new) |
| MCP sign-in (grant or token) | yes (today) | no | yes (new) |
| Composio connection | yes (today) | allowed by the table; no flow | yes (new) |

The check `ck_secrets_user_kinds` (from the build) limits person rows in `secrets` to `custom_secret`, `subscription_provider`, `oauth_grant` and `mcp_token`.

### 2.4 Several accounts per owner

Every owner may hold several accounts for one app or provider. The slug stays the address of an account, with the shipped rule of each table, for every owner shape:

- `secrets`: the slug is unique per owner (shipped `uq_secrets_project_id_slug` and `uq_secrets_organization_id_slug`, and the build's `uq_secrets_user_slug`).
- `gateway_connections`: the slug is unique per owner, provider and integration (shipped `uq_gateway_connections_project_provider_integration_slug`). The build's person index `uq_gateway_connections_user_integration` allows one connection per integration, so it is replaced by `uq_gateway_connections_user_provider_integration_slug` on `(organization_id, user_id, provider_key, integration_key, slug) WHERE user_id IS NOT NULL`, and an organization index of the same shape is added (`uq_gateway_connections_organization_provider_integration_slug`, `WHERE project_id IS NULL AND user_id IS NULL`).

One shipped rule blocks this for subscription logins: `_name_and_slug_subscription_provider` in `core/secrets/services.py` allows one login per provider per project and uses the provider as the slug. That rule goes. A new login gets a unique slug made from its name. Existing logins keep their slug (`claude` or `chatgpt`), so saved agents keep working.

### 2.5 Defaults

Defaults exist only for a person's Composio connections, because only the Composio integration is a key that is the same for everyone, and only a `"user"` item reads a default. Project and organization connections have no default in this step.

- New column `gateway_connections.is_default`: boolean, not null, default false.
- Rule: for each person and each integration, at most one connection has `is_default = true`. Project and organization rows always keep `is_default = false`.
- One partial unique index enforces it, the same way the shipped slug indexes of `secrets` do:
  - `uq_gateway_connections_user_default` on `(organization_id, user_id, provider_key, integration_key) WHERE is_default AND user_id IS NOT NULL`

What a default means for each owner:

- **Person.** A `"user"` Composio tool uses it when the person made no account choice for the agent.
- **Project and organization.** No default. An `"agent"` Composio tool always names its connection by slug. If a project default is needed later, it is one more partial index with the same shape, and no redesign.

How defaults are kept:

- An owner's first connection for an integration becomes the default. When two creates race, the unique index refuses one, and that create retries as not default.
- When the owner already has connections for the integration and none is the default (the default was deleted), a new connection does not become the default. The owner picks one.
- "Make default" clears the old flag and sets the new one in one transaction.

`secrets` gets no default column. Provider keys and subscription logins keep today's rules: an `"agent"` model names its subscription login by slug, and a provider key without a slug uses the provider scan, which picks one of the project's keys for the provider in a fixed order. Custom secrets and MCP sign-ins have no defaults (requirement 8).

### 2.6 The account choice table

Table `account_choices`, in a new domain `account_choices` (`core/account_choices/`, `dbs/postgres/account_choices/`, `apis/fastapi/account_choices/`).

| Column | Type | Rule |
| --- | --- | --- |
| `id` | UUID v7 | primary key |
| `project_id` | UUID, not null | the agent's project |
| `artifact_id` | UUID, not null | the agent. Foreign key `(project_id, artifact_id)` to `workflow_artifacts`, `ON DELETE CASCADE`, as in `agent_access` |
| `user_id` | UUID, not null | the person. Foreign key to `users.id`, `ON DELETE CASCADE`, as in `session_grants` |
| `item_key` | text, not null | section 2.8 |
| `secret_id` | UUID, null | foreign key to `secrets.id`, `ON DELETE CASCADE` |
| `gateway_connection_id` | UUID, null | foreign key to `gateway_connections.id`, `ON DELETE CASCADE` |
| lifecycle columns | `LifecycleDBA` | rows are deleted, never archived, so the `deleted_*` columns stay empty, as in `secret_projects` |

Constraints:

- `ck_account_choices_single_account`: `num_nonnulls(secret_id, gateway_connection_id) = 1`.
- `uq_account_choices_project_id_artifact_id_user_id_item_key`: one choice per person, agent and item.
- `ix_account_choices_user_id`: for deletes by person.

The shape copies `session_grants`, the per-person sharing table: one row per person and resource, with real foreign keys, so the database deletes a choice when the person, the agent or the account goes. The foreign key to `gateway_connections.id` needs the build's change of that table's primary key from `(project_id, id)` to `(id)` (build migration 057), because a person's row has no `project_id`.

No account choice exists for an MCP server. A person has at most one usable sign-in per server: the server's current `auth_mode` selects the one slug that applies (`grant_slug` for an OAuth server, `token_slug` for a token server), and slugs are unique per owner. So there is nothing to choose between.

### 2.7 Agent item shape

```json
{
  "llm": {
    "model": "claude-opus-4-8",
    "provider": "anthropic",
    "connection": { "mode": "self_managed", "slug": "claude-team" }
  },
  "tools": [
    { "type": "gateway_connection",
      "connection": { "provider": "composio", "integration": "gmail",
                      "account_source": "user" } },
    { "type": "gateway_connection",
      "connection": { "provider": "composio", "integration": "hubspot",
                      "slug": "hubspot-sales" } }
  ],
  "mcps": [
    { "connection": { "type": "gateway", "namespace": "custom", "slug": "linear",
                      "account_source": "user" } }
  ],
  "sandbox": {
    "credentials": [
      { "secret": { "account_source": "user" },
        "binding": { "type": "env", "name": "GITHUB_TOKEN" } },
      { "secret": { "slug": "jira-token", "namespace": "organization" },
        "binding": { "type": "env", "name": "JIRA_TOKEN" } }
    ]
  }
}
```

Rules:

- `account_source` omitted means `"agent"`. Every saved revision keeps its meaning.
- An `"agent"` item names its account as today: a slug, and for an organization account the list the slug is in (`scope: "organization"` on the model connection, which is shipped; `namespace: "organization"` on the secret reference, which is new). The new field is `namespace: Optional[Literal["organization"]]`. Left out, the slug is in the project's list.
- A `"user"` Composio tool and a `"user"` custom secret have no slug. The SDK models refuse a slug next to `"user"`, in the same way as the shipped rules on these models.
- A `"user"` MCP server keeps its slug. The slug names the project's server, and the account is the person's sign-in to it. `"user"` is accepted only for servers in the `custom` namespace. Standard and built-in MCP routes stay `"agent"` in this step.
- A provider key (`mode: "agenta"`) with `"user"` is treated as a missing model, so the run fails with `agent_needs_setup` and Needs setup shows the fix.
- A subscription login (`mode: "self_managed"`) accepts `"user"`. It has no slug, and the shipped rule "a self-managed connection with no slug means the runner operator's login" applies only to `"agent"` items.
- `binding` inside `sandbox.credentials[]` keeps its shipped meaning: the environment variable that receives the value. It has nothing to do with the account source.
- Code tools (`tools[].secrets`, a list of slugs) stay `"agent"` only in this step.

### 2.8 Item keys

An item key names one `"user"` item inside one agent. It is built from the item, so no new field goes into the agent configuration. Its form is `<kind>:user/<text>`:

| Item kind | Shipped Needs setup key of an `"agent"` item | Item key of a `"user"` item | Text after `user/` |
| --- | --- | --- | --- |
| Composio tool | `app_connection:<integration>/<slug>` | `app_connection:user/gmail` | the integration, from `tools[].connection.integration` |
| MCP server | `mcp_server:<slug>` | `mcp_server:user/linear` | the slug of the project server, from `mcps[].connection.slug` |
| Custom secret | `secret:<slug>` | `secret:user/GITHUB_TOKEN` | the variable name, from `sandbox.credentials[].binding.name` |
| Subscription login | `subscription:<project or organization>/<slug>` | `subscription:user/claude` | the stored login kind, mapped from the model provider: `anthropic` to `claude`, `openai-codex` to `chatgpt` |

- The kind prefix is the kind name that Needs setup already uses (`AgentRequirementKind`: `app_connection`, `mcp_server`, `secret`, `subscription`). So the `key` of a Needs setup requirement for a `"user"` item and the `item_key` of its choice are the same text. One exception: for an MCP server whose sign-in expired, the shipped Needs setup code turns the prefix into `mcp_sign_in` (`mcp_sign_in:user/linear`). MCP items have no account choices, so no choice uses that key.
- After `user/` comes the text that the item matches on (an integration, a server slug, a variable name or a login kind). It is never the slug of a person's account. The segments of a `"user"` key do not mean what the segments of the shipped `"agent"` keys mean: in `app_connection:user/gmail`, `user` sits where an `"agent"` key puts the integration. Code reads the account source from the `user/` start, never by splitting a key into integration and slug.
- `user/` keeps a `"user"` secret apart from an `"agent"` secret whose slug equals a variable name (`secret:GITHUB_TOKEN`), because a slug cannot contain `/`.
- The subscription mapping is the only place where a model provider name (`anthropic`, `openai-codex`) is turned into a stored login kind (`claude`, `chatgpt`, from `SubscriptionProviderKind` in `core/secrets/enums.py`). The mapping lives in the item reader (section 3.3).
- Two Composio tools of one integration share one item key, so the person chooses once.

## 3. Run-time resolution

### 3.1 The run person

| Run started by | Run person |
| --- | --- |
| A person in the app (chat, playground) | that person |
| An automation: a schedule, a trigger subscription or an evaluation run | its executing principal, when that principal is a person (section 3.8). For an evaluation run, that is the person who started it or last edited it. |
| A Slack or Telegram message | none. Nothing creates links between channel users and Agenta users today. When links ship, the linked person becomes the run person for a channel turn, with a check on the run's origin. |
| An API key | none, until personal API keys exist |
| A child run | none in this step (the build refuses personal accounts in child runs) |

The run person comes from the run's authority (`RunAuthority` in `core/access/dtos.py`), not from the turn's sender. The build's helper `caller_user_id(authority)` is renamed `run_person_id(authority)`, and it returns a person only when the authority's principal is a human. It drops the build's branch for a channel installation principal. That branch would give an automation created from a channel turn the personal accounts of the row's creator, because the stored envelope (`stored_work_envelope` in `core/access/principals.py`) sets the installation's linked user to `created_by_id`. The person who created a channel connection or a channel automation is never the run person.

### 3.2 The resolution chain

For each `"user"` item, with the run person:

| Item kind | 1. Account choice | 2. Automatic match | 3. Otherwise |
| --- | --- | --- | --- |
| Composio tool | the chosen connection | the person's default connection for the integration | left out |
| MCP server | none | the person's sign-in to the same server, found by server id | left out |
| Custom secret | the chosen secret | none: Agenta always asks | left out |
| Subscription login | the chosen login | none | the model is missing, so the run fails |

Rules for every kind:

- With no run person, every `"user"` item has no account.
- The account must still be owned by the run person, in the agent's organization.
- Readiness is read from stored state only: an inactive or invalid Composio connection, or an MCP grant that is expired and has no refresh token, counts as missing. An expired grant with a refresh token counts as ready. Run start makes no upstream call.
- An `"agent"` item never turns into a person's lookup, and a `"user"` item never falls back to the agent's account.

### 3.3 One read at run start

At run start, in `core/workflows/service.py`, where the build signs its claim today:

1. The item reader (`core/account_choices/items.py`, moved from the build's `core/credentials/bindings.py`) lists the `"user"` items of the revision, with each item's key, kind and match text (the integration for Composio, the server id for MCP).
2. `AccountChoicesService.resolve` reads every account in one SQL statement: account choices joined to their account rows, then the person's Composio defaults for items with no choice, then the person's MCP sign-ins by `grant_slug` or `token_slug`, and the count of the person's accounts that fit each item. It returns one `ItemAccount` per item, with these fields:
   - `item_key`
   - `match`: `choice`, `default`, `sign_in`, or empty when no account matched
   - `secret_id` or `gateway_connection_id`: the matched account, if any
   - `name`: the account's name, for the interface
   - `is_ready`: false when the matched account is not ready
   - `candidates`: the number of the person's accounts that fit the item

   Accounts that matched but are not ready stay in the result. Needs setup turns the result into its reasons in one place: no match gives `needs_personal_account`, a match that is not ready gives `needs_sign_in`. The reasons stay in Needs setup, which depends on `account_choices`, never the other way round. Needs setup reads its counts from the same result and does no lookup of its own.
3. The API signs only the ready accounts into the run credential as the claim `run_accounts`: a list of `{item_key, secret_id}` or `{item_key, gateway_connection_id}`.

A choice made during a run applies from the next run.

Refreshing an MCP grant stays in the existing OAuth service (`refresh_grant`, with its lock), which the MCP gateway calls when it uses the grant. A failed refresh uses the shipped error handling: a temporary failure (`MCPOAuthRefreshUnavailableError`) is a retryable error (`503`), and a dead grant (`MCPOAuthRefreshFailedError` and its subclasses) is an error for that call. The next Needs setup check shows the item as `needs_sign_in`. A later call in the same run may succeed, always with the same signed account. Agenta keeps no per-run state for this, and never picks another account in its place.

### 3.4 The paths that use accounts

| Path | Items | How it finds a `"user"` account |
| --- | --- | --- |
| Tools service (`/tools/call`, `core/tools/service.py`) | Composio tools | reads the connection id for `app_connection:user/<integration>` from `run_accounts` |
| MCP gateway (`/gateways/mcps/...`) | MCP servers | reads the sign-in id for `mcp_server:user/<slug>` |
| Vault (`/vault/v1/secrets/...`), read by the services before the sandbox starts | custom secrets, subscription logins | reads the secret id for `secret:user/<variable>` or `subscription:user/<kind>` |
| Model gateway (`/gateways/llms/...`) | provider keys | never `"user"` |

Each path fetches the row by id, checks that its owner is still the run person, and reads the value as it does today. No path looks up a person's account by itself, so code in the sandbox cannot reach a person's account that is not in the claim. An `"agent"` item goes through each path's existing code, unchanged.

### 3.5 Missing items

- A missing `"user"` item is left out: the vault sets no variable, the tools service answers "not found" so the services leave the tool out, and the MCP gateway answers "not found" so the runner does not register the server. The agent runs without the item.
- A missing model (including a `"user"` subscription login with no account) fails the run before the sandbox starts, with `agent_needs_setup`.
- Resolution never raises for a missing account. An authorization failure is an error, not "missing".

### 3.6 Cases

- **The common case.** Bob connects Gmail once. His first connection becomes his default. Every agent with a `"user"` Gmail tool uses it, with no setup per agent.
- **A second account for one agent.** Bob chooses his personal Gmail for the agent "Newsletter". Only that agent uses it. Every other agent still uses his default.
- **A secret.** The first time Alice runs an agent with a `"user"` `GITHUB_TOKEN`, the variable is left out, and Needs setup asks her to choose or add a value. Her answer is stored for that agent.
- **An MCP server.** Alice signed in to the project's Linear server last week for another agent. A new agent with a `"user"` Linear item uses that sign-in with no question.
- **A Slack user with no link.** `"user"` items are left out. A `"user"` subscription login fails the run. `"agent"` items work.
- **A shared conversation.** Each turn uses the accounts of the person who sends it.
- **An automation edited by another editor.** The save makes the editor the run person (section 3.8). The next run uses the editor's accounts for the `"user"` items, and items the editor has not set up are left out. The automation's edit screen tells the editor before the save (section 5.6).

### 3.7 Changes over time

- **The builder renames or removes an item** (changes the variable name, or picks another MCP server). The item key changes. The old choice is no longer read, and Needs setup asks for the new key. If the builder changes it back, the old choice works again. Nothing deletes the old row, and it has no effect.
- **The agent is archived.** Choices stay, and work again after unarchive. **The agent is deleted.** The foreign key deletes its choices.
- **The person deletes the chosen account.** The foreign key deletes the choice. The item falls back to the next step of the chain, or is left out.
- **A project admin deletes the MCP server.** Today's delete removes only the project's grant. It changes to delete the rows at both `grant_slug` and `token_slug` of that server, for every owner, in the same transaction.
- **A project admin switches a server between OAuth and a token.** The server's `auth_mode` selects which sign-in applies, so a person's row of the other kind is no longer read. The edit deletes those rows, for every owner, like the delete above.
- **The person leaves the organization.** The build's `end_for_member` deletes every account the person owns there, including MCP sign-ins. The foreign keys delete the choices.
- **The person loses access to the project or the agent.** The choices stay, unused. They go when the person leaves the organization.

### 3.8 Automations

An automation is a schedule, a trigger subscription or an evaluation run. It runs an agent in the background, usually with no person in the app. Each automation row stores its executing principal (`principal_kind`, `principal_id`), the identity it runs as. An automation needs no account code of its own: the dispatcher builds the run's authority from the executing principal and sends it through the normal run start, which resolves accounts as for a chat (section 3.3).

Rules:

1. **The editor becomes the run person.** Every save through an edit route of a schedule, a trigger subscription or an evaluation run writes the editor as the executing principal, in the same database write as the configuration. The last save wins, and the row is always consistent. This applies to every save, including one that changes only the name or the time, so no save can make work run with another person's accounts.
2. **Lifecycle actions keep the run person.** Pause, resume, delete, archive and internal writes by workers never change the executing principal. Internal callers pass no principal.
3. **The run person is a human principal only.** An automation that runs as an API key or a channel installation has no run person, so its `"user"` items are left out (section 3.1).
4. **The event connection of a trigger subscription stays a project connection.** A person-owned Composio connection is never the event source of a trigger subscription, so a change of run person never leaves one person's connection firing another person's runs.
5. **The turn-on check stays as in pull request 7887.** It refuses to turn an automation on while the model needs setup, and checks only the model. Limit for later: when personal subscription logins ship, a `"user"` model depends on the person, so the check must then run for the executing principal, or leave that case to run start.
6. **Skipped deliveries stay as in pull request 7887.** A fire whose model needs setup is recorded as a skipped delivery, and the automation stays on. A missing personal item is left out at run start and the run goes on, so it never causes a skipped delivery. No other delivery state is added.

**Notice on the edit screen.** (Screen: section 5.6.) When the agent has `"user"` items and the save makes the editor the new run person (the editor is not the current executing principal), the edit dialog of the schedule, trigger subscription or evaluation run tells the editor that the automation will now run as them and use their own accounts for those items. It lists the `"user"` items that are not set up for the editor, with the fixes of section 5.3. The list comes from the existing Needs setup route (`POST /workflows/revisions/requirements/query`, pull request 7887), for the revision that the automation's references resolve to now (a pinned revision, an environment, or the latest revision), which is the one the next run uses. An evaluation run checks each agent revision it runs. When the agent has no `"user"` items, or the editor is already the run person, the dialog shows no notice. The save is never blocked. The notice is a picture at save time; run start stays the authority.

Code: a `principal` parameter on `edit_schedule` and `edit_subscription` (interface, DAO, service), and the evaluation edit entry points pass the editor to the existing `edit_run` principal write: about 60 to 120 lines. The notice is frontend code only, shared by the automation dialog and the evaluation run edit: about 60 to 150 lines and one test. The `run_person_id` change of section 3.1 adds 3 resolver tests (a human principal, an API key, an installation). Pull request 7883's sorting of edits is deleted (section 8.1).

## 4. Setup flow

### 4.1 What Needs setup returns

Needs setup (`AgentRequirementsService`, pull request 7887) runs the same `AccountChoicesService.resolve` as the run, for the person who asks. So the check, the interface and the run cannot disagree. For each `"user"` item with no account it returns a requirement:

| State | `reason` | `fix` |
| --- | --- | --- |
| Composio tool: the person has no connection for the integration | `needs_personal_account` (new) | `can_connect: true`, `candidates: 0` |
| Composio tool: the person has connections, none is the default | `needs_personal_account` | `can_connect: true`, `candidates`: the number of their connections for the integration |
| Custom secret: no choice for this agent | `needs_personal_account` | `can_connect: true`, `candidates`: the number of their custom secrets |
| MCP server: no sign-in | `needs_personal_account` | `can_sign_in: true` |
| MCP server: the grant is expired and has no refresh token | `needs_sign_in` (exists) | `can_sign_in: true` |
| A chosen or default Composio connection is inactive or invalid | `needs_sign_in` | `can_sign_in: true` (reconnect, as for a project connection today) |
| Subscription login, `"user"` | `needs_personal_account` | none until the login flow exists; `blocks_run: true` |
| Any `"user"` item, and the asker is no person (for example a check before a channel is turned on) | `needs_personal_account` | none. It blocks only for the model. |

The requirement `key` is the item key. `candidates` stays the shipped count. The picker gets the accounts themselves from the connection query or the vault list. `can_connect` keeps its shipped meaning, "you can add or pick an account for this item", so it also covers adding or picking a custom secret value. `can_connect` and `can_sign_in` are true for anyone who may run the agent, because the person sets up only their own account.

### 4.2 Steps per item kind

| Item kind | What the person does | API calls | What is written |
| --- | --- | --- | --- |
| Provider key (`"agent"`) | A project admin adds or picks a project key, as today | existing flows | a project or organization `secrets` row |
| Subscription login (`"agent"`) | A project admin connects a login, as today | existing flow | a project or organization `secrets` row |
| Subscription login (`"user"`) | Out of scope now | none | nothing yet |
| Composio tool, first connection for the integration | Connect | `POST /tools/connections/?scope=user` | a person-owned `gateway_connections` row, which becomes the default. No choice. |
| Composio tool, another connection for this agent | Pick | `POST /account-choices/` | an account choice |
| Composio tool, change the default for every agent | Make default | `POST /tools/connections/{connection_id}/make-default` | the default flag moves |
| MCP server, OAuth | Sign in to the project's server | `POST /gateways/mcps/endpoints/{endpoint_id}/connect?owner_kind=user`, then the existing OAuth callback | a person-owned `oauth_grant` row at `grant_slug(server id)`. No choice. |
| MCP server, token | Paste a token for the project's server | `POST /gateways/mcps/endpoints/{endpoint_id}/connect?owner_kind=user` with the token in the body | a person-owned `mcp_token` row at `token_slug(server id)`. No choice. |
| Custom secret, existing | Pick one of your secrets | `POST /account-choices/` | an account choice |
| Custom secret, new | Add a value | `POST /vault/v1/secrets/` with `scope: "user"`, then `POST /account-choices/` | a person-owned `custom_secret` row and an account choice |
| Organization custom secret | API only | `POST /vault/v1/secrets/` with `scope: "organization"` (shipped) | an organization `secrets` row |

The Composio connect flow uses the Composio entity `org:<organization id>:user:<user id>` for a person (from the build).

### 4.3 How Agenta knows next time

- A Composio tool finds the person's default, which applies to every agent in the organization. The person connects Gmail once.
- An MCP server finds the person's sign-in by the server id, which applies to every agent that uses that project server.
- A custom secret finds the account choice for this agent. A second agent with the same variable asks again, because the person may want another value there. The picker lists the secret that the person chose last for this variable name first, so a second answer is one click.
- The agent configuration is never written in a setup step, so all of this works with only the permission to run the agent.

### 4.4 MCP sign-in by a person on a project server

The OAuth code is project-scoped today (`core/gateways/mcps/oauth/storage.py` and `oauth/service.py`), and the build refuses any sign-in by a person. Changes:

- `connect` takes the query parameter `owner_kind`: `project` (today's behavior, the default) or `user`. It is not called `scope`, because the `connect` body already has the OAuth field `scopes`. With `user`, the grant or token is written as a person-owned row, and the permission check is "the caller may run an agent in the project", not `EDIT_MCP_ENDPOINTS`.
- Today `connect` refuses servers that do not use OAuth. With `owner_kind=user` it also accepts a token server, with the token in the body, and writes the person's `mcp_token` row. With `owner_kind=project` a token server is still refused: the project's token stays the server's `secret_id`.
- `disconnect` (`DELETE /gateways/mcps/endpoints/{endpoint_id}/connect`) with `owner_kind=user` deletes the caller's own sign-in at the slug that the server's `auth_mode` selects.
- Today `connect` may run discovery and write what it finds onto the project's server row. With `owner_kind=user` it never writes the server row, because the caller may only run agents. It uses the discovery data the server already holds; if there is none, it refuses with `409`, code `server_not_discovered`, and a project admin must connect the server once.
- The grant lookup takes the owner: the project's grant for `"agent"` items, the run person's grant for `"user"` items, both at `grant_slug(server id)`.
- The OAuth client registration stays in the project, where the server is.
- `mcps_oauth_attempts` gets one new column, `owner_kind` (text, not null, default `project`, values from `SecretOwnerKind`). `connect` stores the owner kind on the attempt, and the callback writes the grant for the stored owner: the project, or the user who started the attempt (the attempt's shipped `user_id`). The callback never infers the owner, so a project admin who signs in for themselves never creates a project grant by mistake.

### 4.5 Routes

New, for account choices, mounted at `/account-choices`. Every route acts for the caller. `user_id` is never in a request body. Responses use the `count` plus named payload envelope.

| Action | Route | Operation id | Notes |
| --- | --- | --- | --- |
| Upsert | `POST /account-choices/` | `upsert_account_choice` | Body `{workflow_id, item_key, secret_id or gateway_connection_id}`. Creates the choice, or replaces the account of the existing choice for the same agent and item key, and returns it. Precedent: `upsert_session_grant`. |
| Fetch | `GET /account-choices/{account_choice_id}` | `fetch_account_choice` | |
| Query | `POST /account-choices/query` | `query_account_choices` | Filters `workflow_id`, `item_key`; `Windowing`. |
| Delete | `DELETE /account-choices/{account_choice_id}` | `delete_account_choice` | The item falls back to the next step of the chain. |
| Resolve | `POST /account-choices/resolve` | `resolve_account_choices` | Body `{workflow_id, workflow_revision_ref}`, with the same revision reference and lookup as the Needs setup route; left out, the current revision. Returns `item_accounts`: one `ItemAccount` per `"user"` item of that revision, for the caller. It never writes. |

There is no separate create or edit route, because the upsert replaces the account for the same key, and nothing else on a choice can change. `resolve` is a custom action because it runs the whole chain across three tables and returns a view, not stored rows. It resolves every `"user"` item of the agent, including the ones found by a default or a sign-in, not only the ones with a stored choice. It sits under `/account-choices` because it is the read side of the same domain and runs the same service method as the run.

Checks on upsert:

1. The caller may run the agent (the same access check as a run, including a private agent's sharing rule).
2. The account is owned by the caller, in the agent's organization. Otherwise `400`, code `account_not_yours`.
3. The account fits the item key: a `custom_secret` for `secret:`, a `subscription_provider` of that login kind for `subscription:`, a Composio connection of that integration for `app_connection:`. An `mcp_server:` key is refused with `400`, code `choice_not_supported`, because MCP uses the sign-in.

The service does not check that the item key is in the agent's current revision. A choice for an item that is not there is never read.

Changes to existing routes:

| Route | Change |
| --- | --- |
| `POST /tools/connections/`, `/query` and `DELETE /tools/connections/{connection_id}` | query parameter `scope`: `project` (default) or `user` (from the build); responses add `is_default` |
| `POST /tools/connections/{connection_id}/make-default` (new) | operation `make_default_tool_connection`, same `scope` parameter. The caller must manage the connection's owner: a person their own, a project admin the project's. |
| `POST /vault/v1/secrets/`, the list and the delete | `scope`: shipped with `project` and `organization`; the build adds `user`. Organization rows of kind `custom_secret` become allowed. |
| `POST` and `DELETE /gateways/mcps/endpoints/{endpoint_id}/connect` | query parameter `owner_kind`, as in section 4.4 |

The owner of a new or listed row is chosen with one request field, `scope`, on the vault and tools routes. `scope` is the shipped vault field (M5), and the build uses the same name on the tools routes. The router of each domain maps `scope` and the caller to the owner DTO `SecretOwner` in one place. Section 7.7 records `scope` on these routes as an exception, and no agent configuration reference gets it.

### 4.6 Who may see and change a person's accounts

- Only the person lists, uses, refreshes or deletes their own accounts and account choices (from the build).
- A project admin or agent editor never sees which account another person uses.
- A person leaving the organization loses every account they own there (section 3.7).

## 5. Interface behavior

The owner approved the screens on 2026-10-29: the top section of the design canvas, with the hand-over notes `UX-HANDOFF.md` and the decisions `UX-DECISIONS.md`. Each board is the real `/m` page with the change applied. Every text below is a draft unless `UX-DECISIONS.md` lists it as approved; drafts get the owner's final pass with the other screen texts (section 9, item 7).

### 5.1 The "Account" block in the item's drawer

The item rows in the agent editor stay exactly as today: no mark, no badge and no account line on a row. The owner rejected the row mark "Uses your own account" and the account lines on rows, because they add information that cannot be removed and read as "everyone uses my account".

The account setting is inside the item's own drawer: the tool permission drawer for a Composio tool, and the MCP drawer for an MCP server. One "Account" block sits at the top of the drawer, above "Default permission", in the same style as the "Default permission" block. This follows one account selector inside the connector, with nothing on the row.

- **The select.** It sets `account_source`.
  - Composio tool: "Each person's default Gmail" (`"user"`), or one of the project's connections for the integration, for example "Gmail (main) · support@acme.com" (`"agent"` with that slug).
  - MCP server: "Each person's own sign-in" (`"user"`), or "The project's sign-in" (`"agent"`). The builder always picks the project's server first.
  - The builder changes the select. A person who may only run the agent sees the select read-only.
- **The "When you run it" line.** With "each person", one line under the select shows the account that the person who opens the drawer uses, from one `POST /account-choices/resolve` call per agent, for the revision the person is about to run:
  - Composio: "When you run it: bob@acme.com (your default) · Change". "Change" lists the person's accounts for the integration, "Make it my default for every agent" and "Connect another Gmail account". Picking an account stores an account choice for this agent (`upsert_account_choice`). "Make it my default for every agent" moves the default (`make_default_tool_connection`).
  - MCP: "When you run it: signed in as you · Sign out", or a "Sign in" action when the person has no sign-in.
  - The line shows only the viewer's own account. A builder never sees which account another person uses (section 4.6).
- **Custom secrets.** No approved board shows a `"user"` custom secret in the editor. "Attach a secret" keeps today's fields, and the environment variable name stays there. The account source of a secret uses the same "Account" select at the top of "Attach a secret", with draft texts.
- Provider keys show no select. Subscription logins show the select only once the personal login flow exists.

### 5.2 Where else the account shows

- Needs setup (section 5.3) and the "Connect your accounts" card in the chat (section 5.5) list the person's missing `"user"` items.
- No other place marks `"user"` items.

### 5.3 Needs setup

For each `"user"` item with no account, Needs setup shows one row with the item and the fix:

- Composio, no connection: "Connect your Gmail account". One click opens the Composio connect flow. The new connection becomes the default, and the row clears.
- Composio, several connections and no default: "Choose which of your Gmail accounts to use". The picker can also make the pick the default for every agent.
- MCP: "Sign in to Linear with your own account". It opens the OAuth sign-in, or a token field for a token server.
- Custom secret: "Choose your value for GITHUB_TOKEN". The picker lists the person's custom secrets, the last one chosen for this variable name first, then the ones named like the variable, and offers "Add a new value".

A row for a `"user"` item never blocks the run, except for the model. The row says so: "The agent runs without it until you set it up."

### 5.4 Managing your accounts

The settings pages Integrations, AI providers, Secrets and MCPs keep today's layout. The one "Connected" group of each page splits into owner groups, each with the page's own group header:

- **"Yours N".** The person's own accounts. They work in every project of the organization.
- **The project group, for example "Support ⇅ N".** The current project's accounts. The project name in the group header is the project switch: it opens the same project menu as the sidebar. This group has no fold arrow.
- **AI providers only: the organization group, for example "Acme organization N", in place of "Yours".** Provider keys never belong to a person (section 2.3). The Project and Organization tabs of the AI providers page are removed; the two groups replace them.

Per page:

- **Integrations.** The person's default shows in the row's second line, for example "Gmail · OAuth · Default". "Make default" is in the row's menu.
- **Secrets.** Each of the person's secrets has a "Used by ..." line, which lists the agents of the current project whose account choices point to the secret.
- **MCPs.** "Yours" lists the person's own sign-ins to the project's servers: "Signed in as you", or "Not signed in" with "Sign in". The project group is today's server table.
- **Empty "Yours".** Draft texts: "No accounts of your own yet" / "Accounts you add here are used in all 5 of your projects, when an agent uses each person's own account."

**"Who can use it".** Adding an account uses today's dialog or drawer, plus one field, "Who can use it":

| Page | Options | Owner written |
| --- | --- | --- |
| Integrations (connect drawer) | "Only me" / "Everyone in Support" | person / project |
| Secrets ("Create secret": Name, Slug, Format, Value, then this field) | "Only me" / "Everyone in Support" | person / project |
| AI providers (provider drawer) | "Everyone in Support" / "The Acme organization". No "Only me". | project / organization |

Who sees the field:

- Integrations and Secrets: people with the edit permission of the page (`edit_tools`, `edit_secret`; for MCP sign-ins `edit_mcp_endpoints`). With the default roles these are Editor, Developer, Admin and Owner.
- Annotators and Viewers see no question. They add only their own account ("Only me" without asking).
- AI providers: the organization option shows only where organization accounts exist today (EE, for people who may manage organization secrets). The field shows only when the drawer is opened from Settings, not when chat or the playground open the same drawer.
- The environment variable name of a secret stays in the agent's "Attach a secret", not in "Create secret".

### 5.5 "Connect your accounts" in the chat

When a person opens a chat with an agent that someone else built, and that agent has `"user"` items the person has not set up, the chat shows the real "Connect what it needs" card above the composer, with:

- the title "Connect your accounts" and the badge "Optional";
- only that person's missing `"user"` items, from the Needs setup route for the revision the chat runs. Examples: Gmail, "Choose which of your Gmail accounts to use", with the person's accounts and "Connect another"; Notion, "Sign in to Notion with your own account"; a set-up item shows as done, for example "Linear: signed in as you";
- the footer "Connect these now, or the agent will ask later." and "Continue".

The person can skip the card: a missing `"user"` item never blocks the run (requirement 9). Today the app shows this card only in the first chat after an agent is created from a template, so this use is new. The board rows show the pill "Uses your own account"; because the owner rejected that text as a row mark in the editor, the card keeps it only if the owner approves it in the text pass.

### 5.6 The automation notice

Section 3.8 gives the rule. In `/m`, an automation is edited on its detail screen, which saves with a save bar; there is no separate edit dialog. The notice sits next to the save bar of the schedule or trigger subscription:

- It shows only when the agent has `"user"` items and the viewer is not the automation's current executing principal.
- It says that the automation will now run as the viewer and use their own accounts for those items, and lists the items that are not set up for the viewer, with the fixes of section 5.3.
- The save is never blocked.

`/m` has no screen to edit an evaluation run, so for evaluation runs only the API rule of section 3.8 applies in this step.

## 6. Organization values in sandboxes

The contract (CONTRACT section 8) says organization credential values never reach a sandbox that the user controls. Organization custom secrets conflict with it, because a custom secret reaches the sandbox as a plain environment variable.

How values reach a run today:

- Provider keys never leave the API. The model gateway uses them.
- Organization subscription logins already go to the runtime. M5 made this one exception (`organization_subscription_for_runtime` in `core/secrets/redaction.py`), because the runner must hold the login.
- Custom secrets go into the sandbox as plain values. That is their only use.

A person's custom secret reaches only that person's runs, so it has no such conflict. Section 9, item 1, records how the organization case is settled.

## 7. Naming

Conventions read: `api/AGENTS.md` (domain layout, routes, migrations, exceptions), `web/AGENTS.md` (labels), and the Agenta convention table of the naming skill (owner columns, owner kind enum, catalog keys, boolean columns, constraint names, custom actions, operation ids, connection references and the known problem with `scope`).

### 7.1 Terms

**Item**: one thing an agent needs from outside Agenta: a provider key, a subscription login, a Composio tool, an MCP server or a custom secret.
_Avoid_: connection (as the general word), requirement (that is a Needs setup result), slot.

**Account**: one stored row that fills an item, owned by a person, a project or an organization.
_Avoid_: credential (as a product term), binding, "Account" alone in the interface (it means the Agenta sign-in on the settings screen; say "Your Gmail account").

**Owner**: who holds an account: `user` (a person, inside one organization), `project` or `organization`. "Personal" is the prose and label word for the `user` owner kind ("personal custom secret", `needs_personal_account`).
_Avoid_: level; scope, except as the shipped request field on account routes (section 7.7).

**Account source**: the item field that says whose account fills the item. `agent` is the account the agent was set up with, used by every run. `user` is the run person's own account.
_Avoid_: account (as the field name), binding, caller_account, project_default, shared, personal, scope, owner (on the item).

**Automation**: a schedule, a trigger subscription or an evaluation run, which runs an agent in the background.
_Avoid_: durable work, scheduled work (for all three), job.

**Executing principal**: the identity an automation runs as, stored on its row (`principal_kind`, `principal_id`): a person, an API key or a channel installation. When it is a person, it is the run person of the automation's runs.
_Avoid_: stored principal, owner (of an automation), creator.

**Run person**: the person a run is for, or none.
_Avoid_: caller, caller user, invoker, sender (the sender is who sent a turn, which differs for schedules).

**Sign-in**: the OAuth grant or pasted token of a person or a project for one MCP server.
_Avoid_: MCP account, MCP connection.

**Default**: the one Composio connection that an owner marks for an integration. Not the provider scan that picks a model's key when no slug is named.
_Avoid_: primary, preferred, "default" for the provider scan.

**Account choice**: a person's stored answer for one `"user"` item of one agent: which of their accounts to use.
_Avoid_: binding, selection, pin, preference.

**Item key**: the text that names one `"user"` item inside one agent, `<kind>:user/<text>`.
_Avoid_: service key, slot key, service.

**Match**: how Agenta found the account of a `"user"` item. Values `choice`, `default`, `sign_in`.
_Avoid_: source (taken by the account source).

**Run accounts**: the claim in the run credential that lists the accounts of a run's `"user"` items.
_Avoid_: bindings, gateway bindings.

### 7.2 Names in each layer

| Term | Table | Column or index | ORM model | DTO field | Route | JSON, claim or config field | UI label | Differs because |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Account source | | | | SDK reference field `account_source` | | `account_source`: `"agent"`, `"user"` | the drawer's "Account" select: "Each person's default Gmail", "Each person's own sign-in" (`"user"`); a project account such as "Gmail (main) · support@acme.com", "The project's sign-in" (`"agent"`) | no mark on rows (owner decision 2026-10-29) |
| Account | `secrets`, `gateway_connections` | | `SecretsDBE`, `ConnectionDBE` | | `/vault/v1/secrets/`, `/tools/connections/` | | "Your Gmail account", "your secret personal-token" | shipped table and route names, no rename |
| Owner | | `project_id`, `organization_id`, `user_id`; `ck_secrets_single_owner`, `ck_gateway_connections_single_owner`; `mcps_oauth_attempts.owner_kind` | owner DBA mixins | `SecretOwner(kind, id)`; `SecretOwnerKind` | request field `scope` (`project`, `organization`, `user`) on vault and tools routes; `owner_kind` on MCP `connect` | | group headers "Yours", the project name (the project switch), the organization name on AI providers; field "Who can use it": "Only me", "Everyone in <project>", "The <organization> organization" | the request field is the shipped vault `scope`, mapped to `SecretOwner` in each router; `SecretOwner` lives in `core/secrets/` (exceptions below) |
| Default | | `gateway_connections.is_default`; `uq_gateway_connections_user_default` | `ConnectionDBE.is_default` | `is_default` | `POST /tools/connections/{connection_id}/make-default`, `make_default_tool_connection` | | "Default", "Make default" | boolean column precedent `projects.is_default`; a column, not a `flags` key, because the unique index needs it |
| Account choice | `account_choices` | `ck_account_choices_single_account`, `uq_account_choices_project_id_artifact_id_user_id_item_key`, `ix_account_choices_user_id` | `AccountChoiceDBE` | `AccountChoice`, `AccountChoiceUpsert`, `AccountChoiceQuery` | `/account-choices`, `upsert_account_choice`, `fetch_account_choice`, `query_account_choices`, `delete_account_choice`, `resolve_account_choices` | | "Chosen for this agent" | |
| Agent (in a choice) | | `artifact_id` | | `workflow_id` | body `workflow_id` | | the agent name | sharing precedent: `agent_access.artifact_id` with `/workflows/{workflow_id}/sharing` |
| Item key | | `item_key` | | `item_key` | body and filter `item_key` | `run_accounts[].item_key`; equals the Needs setup `requirement.key` | not shown | |
| Chosen account | | `secret_id`, `gateway_connection_id` | | same | | same in `run_accounts` | the account's name | `gateway_connection_id`, not `connection_id`, because `connection` also names a channel connection |
| Item account | | | | `ItemAccount` (`item_key`, `match`, `secret_id`, `gateway_connection_id`, `name`, `is_ready`, `candidates`) | `item_accounts` in the `resolve` response | | the "When you run it: ..." line in the item's drawer | not `AccountRef`, which `core/accounts/dtos.py` already defines |
| Match | | | | `AccountMatch`: `choice`, `default`, `sign_in` | | | "chosen for this agent", "default", "signed in as you" | |
| Run person | | | | `run_person_id` | | | | `caller_user_id` (build) means the browser user of an OAuth callback on main; `RunSender.user_id` is the sender |
| Run accounts | | | | | | claim `run_accounts` | | replaces the build's `gateway_bindings`, which named only the gateway and reused `binding` |
| Personal account missing | | | | `AgentRequirementReason.NEEDS_PERSONAL_ACCOUNT` | | `reason: "needs_personal_account"` | "Connect your Gmail account" and the other texts in 5.3 | the value describes the item, like the shipped `not_chosen` and `needs_sign_in`; "your" stays in the label |
| Sign-in | `secrets` | kinds `oauth_grant` (shipped) and `mcp_token` (new, person rows); slugs from `grant_slug(server id)` and `token_slug(server id)`; a project token is `mcps_endpoints.secret_id` | `SecretsDBE` | `SecretKind.MCP_TOKEN` | `/gateways/mcps/endpoints/{endpoint_id}/connect`, parameter `owner_kind` | | "Signed in as you", "Sign in again" | shipped `connect` verb; `owner_kind`, not `scope`, beside the shipped OAuth `scopes` |
| Slug list of an organization secret | | | | `SandboxSecretReference.namespace: Optional[Literal["organization"]]`; left out means the project's list | | `namespace: "organization"` | not shown | the shipped model `Connection.scope` is not copied (exception below) |
| Deployment switch | | | | | | environment variable `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED` | | renamed from the build's `AGENTA_ACCESS_PERSONAL_CREDENTIALS_ENABLED` before merge: "credentials" is on the Avoid list |

### 7.3 Item kinds against the template

| Kind | Missing or extra fields | Actions | Owner kinds and owner rules | Differs because |
| --- | --- | --- | --- | --- |
| Composio connection | `is_default` new | create, query, fetch, delete, refresh, revoke, make-default | project, person in flows; organization allowed by the table. One default per person per integration. Slug unique per owner. | Only kind with a key that is the same for everyone |
| Custom secret | no default | vault create, list, read, update, delete | project, organization (API only), person. Slug unique per owner. | No shared key, so the account choice decides |
| MCP sign-in | a `secrets` row (`oauth_grant`, or `mcp_token` for a person's token), not a resource of its own | `connect`, `disconnect` on the server | project and person. One usable sign-in per owner per server: `auth_mode` selects the slug. | The server is the project's; only the sign-in is the person's |
| Subscription login | no default | vault create, list, delete | project, organization; person allowed by the table, no flow | Personal login creation is out of scope |
| Provider key | no default | as today | project, organization | Provider keys are never `"user"` |
| Account choice | no `slug`, `name`, `description`, `flags`, `tags`, `meta`, `data` | upsert, fetch, query, delete, `resolve` | always a person inside a project | The shape of `session_grants` (one row per person and resource, upsert by the natural key, real foreign keys) plus the standard `id` and lifecycle columns; no state beyond the account id |

Owner-dependent rules for each owner kind:

- Slug uniqueness: in `secrets`, per owner; in `gateway_connections`, per owner, provider and integration. Both hold for all three owners (section 2.4).
- Default: Composio only, per owner, for all three owners (three indexes).
- Who may read a row: the project's members for project rows, through the project's availability for organization rows (shipped M5 rule), only the person for person rows.
- Deletion: deleting a project or organization cascades its rows; a person leaving deletes their rows in that organization; deleting a user cascades everything.

### 7.4 Caller examples (proposed)

1. **Common.** Bob chats with an agent that has a `"user"` Gmail tool. At run start the API resolves `app_connection:user/gmail` to Bob's default connection and signs it into `run_accounts`. The runner calls `/tools/call`, and the tools service reads that connection id from the claim.
2. **Composition.** A schedule runs as Alice. The agent has an `"agent"` HubSpot tool with slug `hubspot-sales`, a `"user"` `GITHUB_TOKEN` and a `"user"` Linear server. Run start returns Alice's chosen `GITHUB_TOKEN` secret and her Linear sign-in. The HubSpot tool uses the project's connection, as today. If Alice never chose a `GITHUB_TOKEN` for this agent, the variable is left out and the agent still runs.
3. **Mistake and recovery.** Bob sends `POST /account-choices/` with a project secret's id. The upsert refuses with `400`, code `account_not_yours`, and the message "Pick one of your own accounts." He adds his own secret and picks it.

### 7.5 Deferred surface

- Organization Composio connections: the table allows them; no route creates them.
- A person's own subscription login: the table allows it; no flow creates it.
- `"user"` on standard and built-in MCP routes, and on code tool secrets.
- Two sign-ins by one person to one MCP server. Adding it later is one nullable column (`mcp_sign_in_id`) on `account_choices`.
- Defaults for MCP servers, once an Agenta MCP registry gives servers a shared key.
- A third account source `"project"` (only project members may use the account). Adding it later changes nothing else in this design.
- One combined list of a person's accounts across both tables, if the interface ever needs one response.

### 7.6 Costly choices

- **The item field name.** `account_source` (chosen, owner decision R18) against the earlier `account`. `account` reads as "an account" next to `account_choices` and `run_accounts`. The field is new on every reference, so either name costs the same now. Changing it after release needs a reader for both names.
- **The address of an organization secret.** Option A (chosen): `namespace: "organization"` on the secret reference. `namespace` already means "which list of names the slug is in" on the model connection and on MCP references. Option B: copy the model connection's `scope: "organization"`. The naming convention table records `scope` as a shipped problem not to copy, because users read "scope" as access. Both cost one optional field.
- **The table name.** `account_choices` (chosen) against a general `reference_choices` table for any per-person choice. The general table loses the foreign keys and has one user.

### 7.7 Exceptions

| Name | Rule it breaks | Reason | Plan |
| --- | --- | --- | --- |
| `gateway_connections` | Named after its user, not its content; Composio does not go through `core/gateways/` | Shipped | Permanent for this work |
| `integration_key` | One term per concept (the Composio match text) | Shipped catalog key | The item reader maps `integration` to the item key, in one place |
| `Connection.scope` on the model reference | Item fields say whose list a slug is in with `namespace` | Shipped in M5 | Kept on the model connection only; the item reader reads it as the organization list. No new reference gets `scope`. |
| `scope` as the owner field on the vault and tools routes | The glossary term is owner; `scope` is the known problem word | Shipped on the vault in M5; the build uses it on the tools routes. One name on every sibling route beats two names on one route | Permanent for the routes; mapped to `SecretOwner` in each router; never added to an agent configuration reference |
| `sandbox.credentials[].binding` | One word, one meaning | Shipped; it means the environment variable | The account source is `account_source`, never `binding` |
| `SecretOwner` and `SecretOwnerKind` in `core/secrets/`, reused by Composio connections | A shared type lives in a shared module | Shipped by the build, two users | Move to `core/shared/` as `Owner` when a third domain needs it |
| `core/gateway/` next to `core/gateways/` | One folder rule | Shipped | No move now |
| `ck_gateway_connections_owner` (build) | Sibling check names | The build named it differently from `ck_secrets_single_owner` | Renamed to `ck_gateway_connections_single_owner` before merge |

## 8. Migration from the current build

The build is not merged, so its migrations change in place. Nothing below needs a data backfill.

### 8.1 Pull requests

| Pull request | Fate | What changes |
| --- | --- | --- |
| 7883, only the person a schedule or evaluation runs as can change what it runs | Mostly deleted | Every save through an edit route makes the editor the executing principal, in the same write (section 3.8). The sorting of edits goes: `core/access/durable_work.py`, `apis/fastapi/shared/durable_work.py`, the execution field lists and classifiers in `core/triggers/service.py`, the run edit checks in `core/evaluations/service.py`, the DAO `check` callbacks, the `owner_only` refusal and its frontend message, and `test_durable_work_edits.py`. About 435 application lines and 575 test lines go; about 60 to 120 lines and 4 tests come in (section 3.8 lists the notice and resolver tests). |
| 7884, bindings and personal provider keys | Changed | `binding` becomes `account_source` on the model, Composio, MCP and secret references. The personal provider key path in the model gateway and proxy is deleted, with its tests. `core/credentials/bindings.py` becomes `core/account_choices/items.py` (the item reader). The claim `gateway_bindings` becomes `run_accounts`. `caller_user_id` becomes `run_person_id`. In `policy.py`, the deployment switch stays and the EE organization switch goes (section 9, item 3). |
| 7885, shared conversations never use a person's own account | Deleted | Migration 056 (the shared-chat mark), the guard, the session-row lock and the check in sharing writes go. |
| 7886, each person's own Composio connection | Kept, changed | Migration 057 keeps the owner columns and the `(id)` primary key. Its one-connection-per-integration index for persons is replaced by the person slug index and `is_default` with the person default index (section 2.4 and 2.5), and an organization slug index is added. The check is renamed `ck_gateway_connections_single_owner` and also allows the organization shape. The per-call personal branch in the tools service is replaced by reading `run_accounts`. |
| 7889, each person's own MCP server | Mostly deleted | Migration 058 (person-owned servers) is deleted: servers stay project-owned. Person-owned sign-ins on a project server are added instead (section 4.4). The runner change for personal servers is reverted if the project server's relay already covers a person's sign-in. |
| 7892, record which person's account each turn used | Deleted | Migration 059 (`run_credential_uses`) and `uses.py` go. |
| 7893, remove `SecretMode` from the secrets resolver | Kept | No change. |
| 7887, Needs setup | Changed | The parser reads `account_source` and builds item keys. `"user"` items go through `AccountChoicesService.resolve`. New reason `needs_personal_account`. |

### 8.2 Schema

| Migration | Fate |
| --- | --- |
| 055, personal secrets | Kept. Adds the kind value `mcp_token`. `ck_secrets_user_kinds` allows `custom_secret`, `subscription_provider`, `oauth_grant` and `mcp_token` for persons, and no longer `provider_key`. Organization rows accept `custom_secret`. |
| 056, shared-chat mark | Deleted |
| 057, personal Composio connections | Kept, changed as above |
| 058, personal MCP servers | Deleted |
| 059, run account record | Deleted |
| New, `account_choices` | Added |
| New, `mcps_oauth_attempts.owner_kind` | Added, default `project` |

### 8.3 The build folder `core/credentials/`

The folder goes. `api/oss/src/core/accounts/` cannot take its place: on main it holds the platform admin accounts service, with its own `AccountRef`.

| Build file | Fate |
| --- | --- |
| `bindings.py` | Becomes `core/account_choices/items.py` |
| `selection.py` | Deleted; `AccountChoicesService.resolve` replaces it |
| `policy.py` | Only the deployment switch stays, in `core/account_choices/` |
| `lifecycle.py` (`end_for_member`) | Moves to `core/account_choices/lifecycle.py`, and also deletes MCP sign-ins |
| `uses.py` | Deleted |

### 8.4 Existing rows

- Existing project provider keys and subscription logins need no backfill. `secrets` gets no default column, and an `"agent"` model keeps today's rules: a subscription login by slug, and a provider key by slug or by the provider scan. So no saved agent changes meaning.
- Existing project Composio connections get `is_default = false`. No run reads a project default, so nothing changes.
- Person-owned rows exist only in unmerged builds, so there is nothing to migrate.

### 8.5 Rollout

One release carries the schema and the code. Runners and services can lag the API, so the order is:

1. The SDK and the services accept `account_source` on every reference. The SDK models that refuse unknown fields (`SandboxSecretReference`, `MCPGatewayConnection`) need the new field before any revision carries it.
2. The deployment switch `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED` (the build's `AGENTA_ACCESS_PERSONAL_CREDENTIALS_ENABLED`, renamed) stays off until every API pod, services pod and runner runs the release. While it is off, the API refuses person-owned writes and account choices, and the interface hides "Each person's own account".
3. An item without `account_source` reads as `"agent"`, so no stored revision changes meaning at any step.

### 8.6 Code size

Rough application lines, tests not counted, against the build (about 2,990 lines and 630 migration lines):

- Removed: about 815 lines (shared-chat guard, account record, personal provider keys, per-call personal branches) plus person-owned MCP servers (about 250).
- Added: about 650 lines for `account_choices` (migration, DAO with the one-statement resolve, service, routes, item reader changes, claim, Needs setup changes) and about 150 for person sign-ins on a project server.

The result is about the size of the build or smaller, and it delivers what the build refused or deferred: several accounts per owner, a per-agent choice, MCP sign-in by each person, and personal and organization custom secrets.

## 9. Decided questions

No questions are open. The owner decided each one on 2026-10-29.

1. **Organization custom secrets in sandboxes** (section 6). Organization custom secrets ship in this release (data model and API, no UI). Hidden secrets (the sandbox gets a placeholder, and the real value is added outside the sandbox) ships very soon as separate work and removes the exposure. This spec does not change the contract rule and adds no exception.
2. **Personal items when another editor edits an automation.** Every save makes the editor the run person. When the agent has `"user"` items, the edit dialog tells the editor and lists the items not set up for them; the save is never blocked (section 3.8).
3. **The EE organization switch for personal accounts.** Dropped.
4. **Audit of personal account use.** No new audit event in this step. Add one to the existing EE audit log if a customer asks.
5. **A warning when sharing a conversation that used personal accounts.** Yes: one line in the share dialog when a turn used a `"user"` item. The text is settled with the other screen texts.
6. **May an `"agent"` Composio tool leave out its slug to use the project's default?** No. Only a person has a default, for Composio.
7. **Interface texts.** The labels in sections 3.8, 5 and 7.2 are proposals. They are settled in the design session, not in this spec.

## Appendix: Decisions applied

This version applies the owner's decisions of 2026-10-29 (R1 to R18 in the review decisions file), and the round 1 review of draft v2.

- R1, R2: the shared-chat rule and the per-run account record are dropped (pull requests 7885 and 7892 deleted).
- R3, R7, R15: hidden secrets stays a separate item; personal and organization custom secrets are in scope now; organization custom secrets get the data model and API only.
- R4: several accounts per owner, for every kind.
- R5, R17: no person-owned MCP servers matched by slug; a person signs in to the project's server, matched by server id.
- R6: every item kind has a setup flow (section 4).
- R8 final: provider keys are always the agent's; subscription logins accept `"user"` in the data model; the personal login flow is out of scope.
- R9: a missing personal item never stops a run.
- R10, R12: a person's default makes the common case automatic; the default rule is the same for every owner level. R16 limits defaults to items with a shared key, so defaults exist only for Composio.
- R27, R28: the minimal automation design. Every save of a schedule, trigger subscription or evaluation run makes the editor the run person; the sorting of edits in pull request 7883 is deleted; lifecycle actions keep the run person; the run person is a human principal only; a trigger subscription's event connection stays a project connection; the edit dialog notice appears only when the agent has `"user"` items and the run person changes. The screen texts move to the design session. The owner approved v3 (R26).
- R13, R18: the item field is `account_source: "agent" | "user"`. The settings direction of 2026-10-29 (one list per kind, owner chosen when adding) is in section 5.4.
- Screens approved on 2026-10-29 (`UX-HANDOFF.md`, `UX-DECISIONS.md`): no mark and no account lines on item rows; one "Account" block at the top of the tool permission drawer and the MCP drawer, with the "When you run it" line; owner groups "Yours" and the project (as the project switch) on the Settings pages, the organization group on AI providers, and the Project and Organization tabs removed; the "Who can use it" field; the "Connect your accounts" card in the chat; the automation notice on the edit screen (sections 5.1 to 5.6).
- R14 option A (service keys written onto a person's account) is replaced by R16: a stored per-person choice, `account_choices` (Design 1 of the selection API, approved).
- Round 1 review of v2: `core/accounts/` is not used; the run person has one name, `run_person_id`; `scope` is not copied to new references; existing provider keys and subscription logins need no backfill because `secrets` gets no default; the subscription item key maps `anthropic` and `openai-codex` to the stored kinds `claude` and `chatgpt` in one place; the reason is `needs_personal_account`; the claim is `run_accounts`; the item key prefixes reuse the Needs setup kinds; the check rule names follow `ck_<table>_single_owner`.
- Changed from the approved selection API design: the item key form is `<kind>:user/<text>` instead of `<kind>:<text>`, so a `"user"` secret cannot share a key with an `"agent"` secret whose slug equals a variable name. The MCP token sign-in uses the shipped `connect` route with the token in the body, instead of a new `token` route, and is stored with a new kind `mcp_token`.
