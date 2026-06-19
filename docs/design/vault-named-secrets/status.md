# Status

Source of truth for progress. Update as work lands.

_Last updated: 2026-06-18 (planning complete, implementation not started)._

## Current state

Planning only. No code changed. Research verified against the repo.

## Checklist

### Phase 1 — Backend
- [ ] Add `SecretKind.CUSTOM_SECRET` (`api/oss/src/core/secrets/enums.py`)
- [ ] Add `CustomSecretDTO` + union member + validator branch (`.../secrets/dtos.py`)
- [ ] `ruff format` + `ruff check --fix` in `api/`

### Phase 2 — Migration
- [ ] Re-confirm current core head (compute by elimination)
- [ ] Add `ALTER TYPE secretkind_enum ADD VALUE 'CUSTOM_SECRET'` revision to OSS tree
- [ ] Add the identical revision to EE tree (same `revision` id)
- [ ] `alembic upgrade head` against the dev DB

### Phase 3 — Fern client
- [ ] `bash ./clients/scripts/generate.sh --language typescript`
- [ ] `pnpm install` and confirm `SecretKind.CustomSecret` + `CustomSecretDto` exist

### Phase 4 — Frontend
- [ ] `CustomSecretDto` alias in `core/types.ts`
- [ ] `transformSecret` branch + `transformCustomSecretPayloadData` in `core/transforms.ts`
- [ ] `customNamedSecretsAtom` + `createCustomNamedSecretAtom` in `state/atoms.ts`
- [ ] `namedSecrets` + `handleModifyNamedSecret` in `state/useVaultSecret.ts`
- [ ] `NamedSecretTable` + `ConfigureSecretModal` under `settings/Secrets/`
- [ ] Mount `<NamedSecretTable />` in `Secrets.tsx`
- [ ] `pnpm lint-fix` in `web/`

### Verification
- [ ] Backend: extend `api/oss/tests/legacy/vault_router/test_vault_secrets_apis.py` with a
      `custom_secret` create/list/get/update/delete case; value decrypts round-trip
- [ ] Manual API: `POST /vault/v1/secrets/` with
      `{header:{name:"GITHUB_TOKEN"}, secret:{kind:"custom_secret", data:{secret:{key:"x"}}}}`
- [ ] UI: Settings -> Providers & Models -> add a secret, reload, edit, delete

## Open questions / decisions log

- 2026-06-18: Storage scope confirmed as **project vault** (not per-agent). New
  `SecretKind = custom_secret`. Data shape `{secret:{key}}`, name in `header.name`.
- 2026-06-18: Runtime/agent wiring is **out of scope** for this iteration.
