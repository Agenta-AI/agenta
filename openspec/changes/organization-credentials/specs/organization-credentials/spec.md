# Organization credentials delta

## ADDED Requirements

### Requirement: Organization access decision for organization credentials
Every `/organization-secrets/` route SHALL call `decide_organization(access, organization_id, MANAGE_ORGANIZATION_SECRETS)` first and SHALL return HTTP 403 on a denial. The decision SHALL allow only a human principal of a browser session, with no run envelope, acting as itself, who has an `organization_members` row in the organization with role `owner` or `admin`. It SHALL NOT read entitlements, project rows, project roles or custom roles, in OSS and EE.

#### Scenario: Owner adds a company key
- **WHEN** the organization owner posts a `provider_key` for OpenAI to `/organization-secrets/`
- **THEN** Agenta SHALL store one row with `organization_id` set and `project_id` NULL, and SHALL return it with `owner.kind = organization` and no value.

#### Scenario: Member on an EE plan without RBAC
- **WHEN** an EE organization has no `Flag.RBAC` entitlement and a member with organization role `editor` posts to `/organization-secrets/`
- **THEN** Agenta SHALL return HTTP 403 and SHALL NOT store a row.

#### Scenario: API key
- **WHEN** a request authenticated by an API key of a project calls `GET /organization-secrets/`, also when the key creator is an organization owner and also when the key is an M6 personal key with a human principal
- **THEN** Agenta SHALL return HTTP 403.

#### Scenario: Run credential
- **WHEN** an agent run of an organization owner calls `GET /organization-secrets/` with its run credential
- **THEN** Agenta SHALL return HTTP 403.

### Requirement: Only shareable kinds
The organization routes SHALL accept only `provider_key` (of an LLM provider family), `custom_provider` and `subscription_provider`. They SHALL refuse a `custom_provider` whose deployment kind the LLM gateway does not serve (Bedrock and SageMaker today). Every refusal SHALL be HTTP 422 naming the reason.

#### Scenario: Refused kinds
- **WHEN** an owner posts a `custom_secret`, an `sso_provider`, or a `custom_provider` for a Bedrock or SageMaker deployment
- **THEN** Agenta SHALL return HTTP 422 and SHALL NOT store a row.

### Requirement: Organization values are long enough to scan
The organization routes SHALL remove surrounding whitespace from every credential value and SHALL refuse a value shorter than 8 characters with HTTP 422.

#### Scenario: Short key
- **WHEN** an owner posts a `provider_key` whose key is 7 characters, or 7 characters padded with spaces
- **THEN** Agenta SHALL return HTTP 422 and SHALL NOT store a row.

### Requirement: Organization routes address shareable rows only
Every organization route SHALL address only shareable organization rows.

#### Scenario: SSO secret id
- **WHEN** an owner calls any `/organization-secrets/` route with the id of the organization's SSO secret
- **THEN** Agenta SHALL return HTTP 404 and the SSO row SHALL stay unchanged.

### Requirement: One owner per row and unique organization slugs
Every `secrets` row SHALL have exactly one owner column set (`ck_secrets_single_owner`). The core API SHALL describe the owner as `SecretOwner` (CONTRACT.md section 8). Organization slugs SHALL be unique within the organization (`uq_secrets_organization_id_slug`); a duplicate create SHALL return HTTP 409. Create SHALL accept an optional slug; without one the server SHALL derive it from the name. The migration SHALL delete rows with no owner, and log the count, before it validates the constraint.

#### Scenario: Duplicate organization slug
- **WHEN** an owner creates two organization credentials with slug `openai-company`
- **THEN** the second create SHALL return HTTP 409, and one row SHALL exist.

### Requirement: Organization values never leave the API
No HTTP response SHALL carry the value of an organization API key or custom provider, a part of it or a preview of it, for any caller, including the organization owner and a request with the `secret-resolve` grant. Only the in-process LLM gateway SHALL use the value. An organization subscription login follows its own requirement. No log record SHALL carry it.

#### Scenario: Run credential reads the vault
- **WHEN** an agent run reads `GET /secrets/` with its run credential, and an OpenAI organization connection is available to the project
- **THEN** the response SHALL NOT contain the organization row, and the sandbox SHALL NOT receive its value.

#### Scenario: Legacy vault middleware
- **WHEN** a completion app's vault middleware loads the project vault
- **THEN** it SHALL receive only project rows.

#### Scenario: Project member lists credentials
- **WHEN** a project member calls `GET /secrets/?include_organization=true`
- **THEN** each organization item SHALL carry `owner`, provider, name, slug and status, and no value and no preview.

#### Scenario: Project member tests an organization connection
- **WHEN** a project member calls `POST /providers/probe` with the id of an organization connection available to the project and `secret_scope = organization`
- **THEN** Agenta SHALL test the stored value as saved and SHALL answer the result without the value. A probe that changes a stored field SHALL need the organization access decision.

#### Scenario: Gateway uses the value
- **WHEN** an agent run calls OpenAI through the gateway with an organization connection it named
- **THEN** the sandbox SHALL receive only a gateway credential.

### Requirement: Project members list the organization connections they may use
`GET /secrets/` SHALL include the organization rows available to the project, without values, only when `include_organization=true` is set and the request does not hold the `secret-resolve` grant; with the grant the parameter SHALL be ignored.

#### Scenario: Resolve grant
- **WHEN** a request with the `secret-resolve` grant calls `GET /secrets/?include_organization=true`
- **THEN** the response SHALL hold project rows only.

### Requirement: Project routes do not manage organization rows
`GET /secrets/{id_or_slug}`, `PUT /secrets/{id}` and `DELETE /secrets/{id}` SHALL resolve project rows only. Project and organization rows SHALL be two slug spaces: a project row MAY use the slug of an organization row, with any kind or family, and neither write SHALL check the other.

#### Scenario: Project editor deletes an organization row
- **WHEN** a project editor calls `DELETE /secrets/{id}` with the id of an organization connection
- **THEN** Agenta SHALL return HTTP 204, as it does today for any id that is not a row of the project, and SHALL change no row.

#### Scenario: Same slug, another kind
- **WHEN** a project creates a `custom_provider` with the slug of an organization `provider_key`
- **THEN** Agenta SHALL store the project row, and the organization row SHALL stay unchanged.

### Requirement: New organization connections are available to all projects
A new organization connection SHALL start with `availability = all_projects` unless the request sets another value. Its default display name SHALL carry the owner ("OpenAI (Organization)", then "OpenAI (Organization) 2").

#### Scenario: Default name and availability
- **WHEN** an owner posts an OpenAI `provider_key` with no name and no availability
- **THEN** Agenta SHALL store it with availability `all_projects` and the name "OpenAI (Organization)".

### Requirement: Saved agents name their connection explicitly
Every agent save path and the template default SHALL write an explicit `agent.llm.connection`. An organization connection SHALL be saved with scope `organization`, its slug and namespace `organization`; a commit missing any of them SHALL be refused with HTTP 422 (`invalid_agent_connection`).

#### Scenario: Incomplete organization connection
- **WHEN** an agent is saved with scope `organization` and no slug
- **THEN** Agenta SHALL return HTTP 422 and SHALL NOT store the revision.

#### Scenario: Template agent
- **WHEN** an agent is created from a template whose base revision names no connection
- **THEN** the stored agent SHALL carry `{"mode": "agenta", "scope": "project"}`.

### Requirement: A save does not check that named items exist or are usable
A commit SHALL NOT be refused because a named connection is missing or unusable where it runs. A `self_managed` connection SHALL commit with or without a slug, as on v0.125.0; the runner decides at run time.

#### Scenario: Self-managed without a slug
- **WHEN** an agent with `{"mode": "self_managed"}` is saved
- **THEN** Agenta SHALL store the revision, and a runner that holds an operator login SHALL run it as on v0.125.0.

### Requirement: EE limits a credential to selected projects
In EE, with the `Flag.RBAC` entitlement, `PUT /organization-secrets/{secret_id}/projects` SHALL set, in one transaction, `availability` to `all_projects` or `selected_projects` with project ids of the same organization. With `selected_projects`, only agents of listed projects SHALL use the connection, and with none listed, no project SHALL. OSS SHALL refuse `selected_projects` with HTTP 403. Resolution SHALL apply the same filter in both editions.

#### Scenario: Limit to one project
- **WHEN** an EE admin limits the OpenAI organization credential to project Sales
- **THEN** Sales SHALL list and resolve it, and Marketing SHALL do neither.

#### Scenario: Last selected project deleted
- **WHEN** the only selected project of a limited credential is deleted
- **THEN** no project SHALL be able to use the connection.

#### Scenario: Foreign project id
- **WHEN** an EE admin lists a project of another organization
- **THEN** Agenta SHALL return HTTP 422 and SHALL NOT change the limit.

### Requirement: Organization admins manage organization subscription logins
An organization owner or admin MAY create a `subscription_provider` (ChatGPT or Claude) at `/organization-secrets/` and sign it in through its `login-attempts` or `subscription-token` route. Its default name SHALL carry the owner ("ChatGPT (Organization)"), and it SHALL start available to all projects.

#### Scenario: Member creates a login
- **WHEN** an organization member with role `editor` posts a `subscription_provider` to `/organization-secrets/`
- **THEN** Agenta SHALL return HTTP 403 and SHALL NOT store a row.

#### Scenario: Admin signs in
- **WHEN** an admin starts a device login for the organization ChatGPT login
- **THEN** the runner SHALL report the outcome to the organization row, never to a project row.

### Requirement: Only the run credential receives an organization subscription login
An agent SHALL use an organization subscription login only when it names it with `{"mode": "self_managed", "scope": "organization", "slug": ...}`. The API SHALL release it only to the run's own credential (`secret-resolve` grant) of a project it is available to, from `GET /secrets/organization-subscriptions/{slug}`.

#### Scenario: A browser reads the login
- **WHEN** an organization owner calls `GET /secrets/organization-subscriptions/chatgpt` from a browser session
- **THEN** Agenta SHALL return HTTP 403.

#### Scenario: Project not allowed
- **WHEN** a run of a project the admin did not select names the organization ChatGPT login
- **THEN** the release route SHALL return HTTP 404, and the run SHALL fail without using a project login.

### Requirement: Organization subscription logins behave like project ones
Once released to a run, an organization subscription login SHALL behave exactly like a project subscription login of the same provider: the same harness, the same engines, and the same delivery. An organization Claude login SHALL be accepted like a project one. Refreshed logins and failures SHALL be written to the organization row (`?scope=organization`), only for a project the login is available to.

#### Scenario: Pi run on any engine
- **WHEN** an agent of project Sales names the organization ChatGPT login and runs Pi on the `inprocess`, `daytona` or `local` engine
- **THEN** the run SHALL use the login as it uses a project ChatGPT login on that engine, and SHALL write refreshes to the organization row.

#### Scenario: Claude run
- **WHEN** an agent of project Sales names the organization Claude login and runs the Claude harness
- **THEN** the run SHALL use the setup-token as it uses a project Claude setup-token.
