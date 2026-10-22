# Tasks

Order follows the implementation sequence. Spec references: OC = organization-credentials, CR = credential-resolution.

## 1. Schema

- [ ] 1.1 One `core_oss` revision per design.md "Migration" (no `core_ee` copy); run `uv run api/scripts/migration_gate.py`; it passes without the label (OC "one owner per row").
- [ ] 1.2 `SecretsDBE` and `SecretsDBA` changes; `SecretProjectDBE`.

## 2. Core

- [ ] 2.1 `SecretOwnerKind` in `core/secrets/enums.py`; `SecretOwner`, `SecretAvailability`, `INHERITABLE_KINDS`; owner-based DAO methods and mapping.
- [ ] 2.2 `owner` and `availability` on `SecretResponseDTO`; forced `write_only` for organization rows (OC "never leave the API").
- [ ] 2.3 Effective-set methods with the organization cache entry and its invalidation (CR "effective set", "slug reference", "default selection", "id references").
- [ ] 2.4 Organization management service methods; kind and Bedrock refusals; override integrity (OC "inheritable kinds", "project routes").

## 3. Access

- [ ] 3.1 `OrganizationAction` and `decide_organization` in `core/access/` (OC "organization access decision").

## 4. Routes

- [ ] 4.1 `OrganizationSecretsRouter` at `/organization-secrets/` with the EE limit route (OC "EE limits").
- [ ] 4.2 `GET /secrets/?include_inherited=true`, never with inherited rows under the `secret-resolve` grant; single-row and write routes stay project-only (OC "never leave the API", "project routes").
- [ ] 4.3 Regenerate the Fern client from an EE OpenAPI spec.

## 5. Gateway

- [ ] 5.1 `SecretsResolver` on the effective methods; real owner in `ResolvedSecret.owner`; project-first default (CR "default selection", "real owner").
- [ ] 5.2 `inherited_custom_provider_by_slug` in `_namespace_of_slug` and `_resolve_target`; tenancy rule unchanged (CR "custom providers").

## 6. Web

- [ ] 6.1 `/m` organization settings: credentials page with the EE limit control.
- [ ] 6.2 `/m` project credentials: request `include_inherited=true`; inherited rows read-only with an owner badge, "Overridden in this project", and "Override in this project" (same slug and kind).
- [ ] 6.3 Run `pnpm lint-fix` in `web`.

## 7. QA matrix

| Boundary | Test |
| --- | --- |
| Gateway run (OSS, EE) | An organization key serves agents in new and old projects; a slug override wins only in its project; the default prefers the project key. |
| Plaintext paths | Gateway off: the run credential's `GET /secrets/` has no inherited row, the sandbox has no organization key, and a named organization slug fails. A completion app's vault middleware sees project rows only. |
| Redaction | Every project role and the organization owner: no response carries an organization value. |
| Organization authorization | EE without RBAC: an organization `editor` gets 403; an owner's API key and an owner's run credential get 403; owner and admin succeed in both editions. |
| Id reference | A pinned organization credential deleted or limited away: the run fails and uses nothing else. |
| Custom provider | An organization Azure provider serves an agent by slug with no endpoint row; a project endpoint row with that slug wins. |
| EE limit | A limited credential is invisible to other projects; deleting the only selected project leaves no inheritor; OSS gets 403. |
| SSO | SSO login works; SSO secrets never appear in a project list. |
| Mixed versions | Production copy: the migration runs while old pods serve; an old SDK runner resolves as before. |
