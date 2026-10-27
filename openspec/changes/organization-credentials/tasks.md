# Tasks

Order follows the implementation sequence. Spec references: OC = organization-credentials, CR = credential-resolution.

## 1. Schema

- [x] 1.1 One `core_oss` revision `oss000000054` per design.md "Migration" (no `core_ee` copy); run `uv run api/scripts/migration_gate.py`; it passes without the label (OC "one owner per row").
- [x] 1.2 `SecretsDBE` and `SecretsDBA` changes; `SecretProjectDBE`.

## 2. Core

- [x] 2.1 `SecretOwnerKind` in `core/secrets/enums.py`; `SecretOwner`, `SecretAvailability`, `ORGANIZATION_SECRET_KINDS`; owner-based DAO methods and mapping.
- [x] 2.2 `owner` and `availability` on `SecretResponseDTO`; forced `write_only` for organization rows (OC "never leave the API").
- [x] 2.3 One cache entry per project (namespace `effective_secrets`) with the project's rows and the available organization rows, and its invalidation (CR "scope and slug", "project default", "id references").
- [x] 2.4 Organization management service methods; kind, family, served-deployment and short-value refusals; default name with the owner; new connections available to all projects (OC "shareable kinds", "all projects").

## 3. Access

- [x] 3.1 `OrganizationAction` and `decide_organization` in `core/access/` (OC "organization access decision").

## 4. Routes

- [x] 4.1 `OrganizationSecretsRouter` at `/organization-secrets/` with the EE limit route (OC "EE limits").
- [x] 4.2 `GET /secrets/?include_organization=true`, never with organization rows under the `secret-resolve` grant; single-row and write routes stay project-only; members test an organization connection as saved (OC "never leave the API", "project routes").
- [x] 4.3 Regenerate the Fern client from an EE OpenAPI spec.
- [x] 4.4 Commit check for agent connections (organization connection complete; no check that named items exist) and the template default connection (OC "explicit connection").

## 5. Gateway

- [x] 5.1 `SecretsResolver(plane=LLM|MCP)`; only the LLM plane answers an organization reference; real owner in `ResolvedSecret.owner`; the project default reads project rows only (CR "project default", "real owner").
- [x] 5.2 The `organization` gateway namespace (resolve with `connection_scope`, relay routes), the one-pass project slug resolve (`_resolve_slug_target`); echo scan over organization values; tenancy rule unchanged (CR "own gateway namespace").
- [x] 5.3 SDK: `Connection.scope` and `WireConnection.scope`, the `organization` namespace, `connection_scope` on resolve, and the refusal without the gateway (CR "older runtime refuses").

## 5b. Organization subscription logins

- [x] 5b.1 `subscription_provider` in `ORGANIZATION_SECRET_KINDS`, never a gateway target; organization create, device login and setup-token routes behind the organization decision (OC "organization subscription logins").
- [x] 5b.2 `GET /secrets/organization-subscriptions/{slug}` for the run credential only; upkeep with `?scope=organization`, checked for availability.
- [x] 5b.3 SDK: `organizationSubscription` wire field; organization Claude login resolves like a project one (2026-10-27).
- [x] 5b.4 Runner: every engine, like a project login (2026-10-27); upkeep and device login carry the organization owner.

## 6. Web

- [x] 6.0 Every `/m` save path writes the picked or default connection explicitly (`scope` included).
- [ ] 6.1 `/m` organization settings: credentials page with the EE limit control (design approved; built separately).
- [ ] 6.2 `/m` connection picker: organization connections the project may use, saved with scope `organization` (built separately).
- [x] 6.3 Run `pnpm lint-fix` in `web`.

## 7. QA matrix

| Boundary | Test |
| --- | --- |
| Gateway run (OSS, EE) | An organization connection serves an agent that names it by scope; an agent with no connection or a project slug never uses it; one slug in both scopes answers each scope's own row. |
| Plaintext paths | The run credential's `GET /secrets/` has no organization row, the sandbox has no organization key, and without the gateway a named organization connection fails. A completion app's vault middleware sees project rows only. |
| Redaction | Every project role and the organization owner: no response carries an organization value. |
| Organization authorization | EE without RBAC: an organization `editor` gets 403; an owner's API key and an owner's run credential get 403; owner and admin succeed in both editions. |
| Id reference | A pinned organization credential deleted or limited away: the run fails and uses nothing else. |
| Custom provider | An organization Azure provider serves an agent that names it, with no endpoint row. |
| EE limit | A limited connection is invisible to other projects; deleting the only selected project leaves it with no project; OSS gets 403. |
| SSO | SSO login works; SSO secrets never appear in a project list. |
| Mixed versions | Production copy: the migration runs while old pods serve; an old SDK runner resolves as before. |
