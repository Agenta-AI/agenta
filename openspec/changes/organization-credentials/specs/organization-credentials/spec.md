# Organization credentials delta

## ADDED Requirements

### Requirement: Organization access decision for organization credentials
Every `/organization-secrets/` route SHALL call `decide_organization(principal, credential, authority, organization_id, MANAGE_ORGANIZATION_SECRETS)` and SHALL return HTTP 403 on a denial. The decision SHALL allow only a human principal of a browser session, with no run authority, who has an `organization_members` row in the organization with role `owner` or `admin`. It SHALL NOT read entitlements, project rows, project roles or custom roles, in OSS and EE.

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

### Requirement: Only inheritable kinds
The organization routes SHALL accept only `provider_key` and `custom_provider`. They SHALL refuse a `custom_provider` whose deployment kind the LLM gateway does not serve. Both refusals SHALL be HTTP 422 naming the reason.

#### Scenario: Refused kinds
- **WHEN** an owner posts a `custom_secret`, a `subscription_provider`, or a `custom_provider` for a Bedrock deployment
- **THEN** Agenta SHALL return HTTP 422 and SHALL NOT store a row.

### Requirement: One owner per row and unique organization slugs
Every `secrets` row SHALL have exactly one owner column set (`ck_secrets_single_owner`). The core API SHALL describe the owner as `SecretOwner` (CONTRACT.md section 8). Organization slugs SHALL be unique within the organization (`uq_secrets_organization_id_slug`); a duplicate create SHALL return HTTP 409. The migration SHALL delete rows with no owner, and log the count, before it validates the constraint.

#### Scenario: Duplicate organization slug
- **WHEN** an owner creates two organization credentials with slug `openai-company`
- **THEN** the second create SHALL return HTTP 409, and one row SHALL exist.

### Requirement: Organization values never leave the API
No HTTP response SHALL carry the value of an organization credential, for any caller, including the organization owner and a request with the `secret-resolve` grant. Only the in-process LLM gateway SHALL use the value. `GET /secrets/` SHALL include inherited rows only when `include_inherited=true` is set and the request does not hold the `secret-resolve` grant.

#### Scenario: Run credential reads the vault
- **WHEN** an agent run on a deployment without the LLM gateway reads `GET /secrets/` with its run credential, and the project inherits an OpenAI organization credential
- **THEN** the response SHALL NOT contain the inherited row, and the sandbox SHALL NOT receive its value.

#### Scenario: Legacy vault middleware
- **WHEN** a completion app's vault middleware loads the project vault
- **THEN** it SHALL receive only project rows.

#### Scenario: Project member lists credentials
- **WHEN** a project admin calls `GET /secrets/?include_inherited=true`
- **THEN** the inherited item SHALL carry `owner`, provider, name, slug and status, and no value.

#### Scenario: Gateway uses the value
- **WHEN** an agent run calls OpenAI through the gateway with an inherited key
- **THEN** the sandbox SHALL receive only a gateway credential.

### Requirement: Project routes do not manage organization rows
`GET /secrets/{id_or_slug}`, `PUT /secrets/{id}` and `DELETE /secrets/{id}` SHALL resolve project rows only. A project row SHALL shadow an inherited slug only with the same kind and, for `provider_key`, the same provider family; otherwise `POST /secrets/` SHALL return HTTP 409.

#### Scenario: Project editor deletes an inherited row
- **WHEN** a project editor calls `DELETE /secrets/{id}` with the id of an organization credential
- **THEN** Agenta SHALL return HTTP 404, and the row SHALL stay.

#### Scenario: Mismatched override
- **WHEN** a project creates a `custom_provider` with the slug of an inherited `provider_key`
- **THEN** Agenta SHALL return HTTP 409 and SHALL NOT store the row.

### Requirement: EE limits a credential to selected projects
In EE, with the `Flag.RBAC` entitlement, `PUT /organization-secrets/{secret_id}/projects` SHALL set `availability` to `all_projects` or `selected_projects` with project ids of the same organization. With `selected_projects`, only listed projects SHALL inherit the credential, and with none listed, no project SHALL. OSS SHALL refuse `selected_projects` with HTTP 403. Resolution SHALL apply the same filter in both editions.

#### Scenario: Limit to one project
- **WHEN** an EE admin limits the OpenAI organization credential to project Sales
- **THEN** Sales SHALL list and resolve it, and Marketing SHALL do neither.

#### Scenario: Last selected project deleted
- **WHEN** the only selected project of a limited credential is deleted
- **THEN** no project SHALL inherit the credential.

#### Scenario: Foreign project id
- **WHEN** an EE admin lists a project of another organization
- **THEN** Agenta SHALL return HTTP 422 and SHALL NOT change the limit.
