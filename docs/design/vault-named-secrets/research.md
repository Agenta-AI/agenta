# Research: how the vault works today

All references verified against the repo at planning time.

## Backend: the vault is one generic, kind-driven store

- Enum: `api/oss/src/core/secrets/enums.py:4` — `SecretKind` has four members today
  (`provider_key`, `custom_provider`, `sso_provider`, `webhook_provider`).
- DTOs: `api/oss/src/core/secrets/dtos.py`
  - `SecretDTO` (`:68`) holds `kind` plus a `data: Union[...]` over the four provider DTOs.
  - `validate_secret_data_based_on_kind` (`:77`) is a `mode="before"` validator with one
    `if/elif` branch per kind. Anything not matched raises "not a valid SecretKind enum".
  - `WebhookProviderDTO` (`:64`) / `WebhookProviderSettingsDTO` (`:60`) is the closest
    existing shape: `data = {provider: {key: str}}`. Our new kind copies this idea.
  - `CreateSecretDTO` (`:153`) = `{header: Header, secret: SecretDTO}`;
    `UpdateSecretDTO` (`:189`) makes both optional. `SecretResponseDTO` (`:206`) adds id +
    lifecycle and a `build_up_model_keys` validator that only touches `custom_provider`.
- DBE / column: `api/oss/src/dbs/postgres/secrets/dbas.py:22`
  - `kind = Column(SQLEnum(SecretKind, name="secretkind_enum"))` — a **native Postgres enum
    type** named `secretkind_enum`. Adding a member needs a DB migration (see below).
  - `data = Column(PGPString())` — encrypted at rest via `pgp_sym_encrypt/decrypt`
    (`api/oss/src/dbs/postgres/secrets/custom_fields.py`). Kind-agnostic.
- Mapping is generic: `api/oss/src/dbs/postgres/secrets/mappings.py`
  - write (`:16`) stores `kind=secret.kind.value` and `data=json.dumps(data.model_dump(...))`.
  - read (`:58`) does `SecretKind(dbe.kind)` and `data=json.loads(dbe.data)`.
  - **No per-kind logic.** A new kind flows through untouched.
- DAO + service are kind-agnostic too: `api/oss/src/dbs/postgres/secrets/dao.py`,
  `api/oss/src/core/secrets/services.py` (sets the crypt key from `env.agenta.crypt_key`).
- Router (CRUD): `api/oss/src/apis/fastapi/vault/router.py`, mounted at `/vault/v1`
  (`api/entrypoints/routers.py:758`). `POST/GET/PUT/DELETE /secrets`. EE adds
  `VIEW_SECRET` / `EDIT_SECRET` permission checks and list caching. No change needed.

### Migration gotcha (important)

`secretkind_enum` is a native PG enum, so a new value needs `ALTER TYPE`. Precedent:
- `.../core/versions/f0a1b2c3d4e5_add_webhooks.py:24`
  → `op.execute("ALTER TYPE secretkind_enum ADD VALUE IF NOT EXISTS 'WEBHOOK_PROVIDER'")`
- `.../core/versions/c3b2a1d4e5f6_add_secret_org_scope.py:25` does the same for `SSO_PROVIDER`.

Facts to copy exactly:
1. The label added is the **uppercase member NAME** (`CUSTOM_SECRET`), even though the
   stored `.value` is lowercase. That is how the existing four members already work, so
   mirror it.
2. **Migration target corrected post-convergence.** The legacy `core` chain is parked at
   `park00000000`; new core revisions live in the post-alignment **`core_oss`** chain
   (`api/oss/databases/postgres/migrations/core_oss/versions/`, version table
   `alembic_version_oss`). This chain ships in the OSS tree and **EE runs it from there** —
   there is **no EE duplicate**. The actual head was `oss000000004`; the new revision is
   `oss000000005_add_custom_secret_kind.py`. (The old "duplicate into both `core/` trees"
   note was the pre-convergence layout.) See
   `docs/designs/oss-ee-convergence/migration-chains-and-edition-switch.md`.

## Runtime consumption today (left untouched this iteration)

- `api/oss/src/core/secrets/utils.py:54` `get_user_llm_providers_secrets` filters to
  `kind == "provider_key"` and maps each to a fixed env var name. New kind is ignored here
  by construction, which is what we want for now.

## Frontend: the secret entity package + Settings tables

- Entry: Settings -> "Providers & Models" renders
  `web/oss/src/components/pages/settings/Secrets/Secrets.tsx`, which today mounts two
  `<SecretProviderTable type="standard" | "custom" />`. Named secrets do **not** go here —
  they get their own Vault Settings section (see plan 4e). Find where the "Providers &
  Models" tab is declared in the Settings layout to register the new tab as a sibling.
- Table: `web/oss/src/components/pages/settings/Secrets/SecretProviderTable/index.tsx` —
  heavily provider-specific (LLM icons, provider tag, model tags). Reusing it for a plain
  secret would mean threading a third `type` through many branches. A small dedicated
  table + modal is cleaner.
- Data layer (entity package) `web/packages/agenta-entities/src/secret/`:
  - `core/types.ts` — re-exports Fern types. `SecretKind` (`:42`) and the DTO aliases come
    from `@agentaai/api-client`. After backend regen, `SecretKind.CustomSecret` and a
    `CustomSecretDto` alias appear here.
  - `core/transforms.ts` — `transformSecret` (`:68`) maps each wire kind into the common
    `LlmProvider` row. `transformCustomProviderPayloadData` (`:120`) builds the
    `CreateSecretDto`. We add a `custom_secret` branch and a `transformCustomSecretPayloadData`.
  - `state/atoms.ts` — query atom (`:78`), `customSecretsAtom` (`:130`, filters by kind),
    mutation atoms (`:144`), and per-kind create action atoms (`createCustomSecretAtom`
    `:229`, `deleteSecretAtom` `:259`). We add a `customNamedSecretsAtom` +
    `createCustomNamedSecretAtom` following the custom-provider pattern; delete is reused.
  - `state/useVaultSecret.ts` — the hook (`:50`) exposes `secrets`, `customRowSecrets`,
    and `handleModify*` callbacks. We add `namedSecrets` + `handleModifyNamedSecret`;
    `handleDeleteVaultSecret` is reused as-is.
  - `api/api.ts` — `fetchVaultSecret` runs `transformSecret`; create/update/delete are
    generic over `CreateSecretDto`. No change needed.
- Shared row type: `web/packages/agenta-shared/src/types/llmProvider.ts:13` `LlmProvider`
  already has `name`, `key`, `id`, `type`, `created_at`. Reuse it for named-secret rows.
- Fern regen: per `web/CLAUDE.md`, after backend OpenAPI changes run
  `bash ./clients/scripts/generate.sh --language typescript` then `pnpm install` (rebuilds
  `@agentaai/api-client` `dist/`) so the new enum value + DTO reach the frontend.

## Existing tests to mirror

- `api/oss/tests/legacy/vault_router/test_vault_secrets_apis.py` exercises the vault CRUD.
  Add `custom_secret` cases here: one `text` and one `json` (create -> list -> get ->
  update -> delete, value masked on the wire and decrypted round-trips). Plus rejection
  cases: a `json` secret with a nested object or array must be **rejected**, and a `text`
  secret with a non-string value must be rejected.
