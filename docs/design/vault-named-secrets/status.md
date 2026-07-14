# Status

Source of truth for progress. Update as work lands.

_Last updated: 2026-06-26 (Phases 1–4 implemented: backend, migration, Fern types, full
frontend Vault UI, and tests. Only stack-dependent steps — DB upgrade, manual API/UI
click-through — remain.)_

## Current state

Implemented end to end. Backend DTOs + validator, the `core_oss` enum migration, the Fern
client types, the frontend data layer, and the new **Vault** Settings section are all in
place. Backend DTO unit tests pass (11/11); `@agenta/entities` and `@agentaai/api-client`
build clean. Remaining: run `alembic upgrade head` and click through the UI on a live
stack (not available in this environment).

## Checklist

### Phase 1 — Backend
- [x] Add `SecretKind.CUSTOM_SECRET` (`api/oss/src/core/secrets/enums.py`)
- [x] Add `CustomSecretFormat` (`text`/`json`) + `CustomSecretSettingsDTO`/`CustomSecretDTO`
      (`{secret:{format, value}}`), union member, and format-aware validator branch
      (`.../secrets/dtos.py`): text → string (verbatim); json → flat object of primitives
      (reject nesting/arrays). Verified in-process: accept text/json/null, reject
      non-string text + nested/array json + bad format + missing value; providers still
      resolve; json `null` survives the mapping `json.dumps` round-trip.
- [x] `ruff format` + `ruff check --fix` (secrets module clean)

### Phase 2 — Migration
- [x] Re-confirm current core head — **corrected**: `core` chain is parked at
      `park00000000`; new revisions go in the post-alignment **`core_oss`** chain (head was
      `oss000000004`). No separate EE copy — EE runs the OSS `core_oss` chain.
- [x] Add `ALTER TYPE secretkind_enum ADD VALUE 'CUSTOM_SECRET'` revision `oss000000005`
      to `core_oss` (chained from `oss000000004`); chain verified linear, single head
- [ ] `alembic upgrade head` against the dev DB — **pending** (local stack not running;
      migration file written + chain-validated offline, not yet applied)

### Phase 3 — Fern client
- [x] Types added under `web/packages/agenta-api-client/src/generated/api/types/`
      (`CustomSecretDto`, `CustomSecretSettingsDto`, `CustomSecretFormat`; `SecretKind`
      + `SecretDto.Data` union extended) — hand-written to **exactly** match Fern's output
      format because the codegen script needs the running stack; a future
      `generate.sh --language typescript` reproduces them idempotently.
- [x] `pnpm --filter @agentaai/api-client build` regenerated `dist/`; verified
      `SecretKind.CustomSecret` + `CustomSecretDto` exist in `dist/`.

### Phase 4 — Frontend
- [x] `CustomSecretDto` / `CustomSecretSettingsDto` / `CustomSecretFormat` aliases +
      `NamedSecretRow` / `CustomSecretValue` in `core/types.ts`
- [x] `transformSecret` `custom_secret` branch (carries `format` + `value`) +
      `transformCustomSecretPayloadData` in `core/transforms.ts`
- [x] `customNamedSecretsAtom` + `createCustomNamedSecretAtom` in `state/atoms.ts`
      (deliberately skips `removeEmptyFromObjects` so empty-string text and null json
      values survive)
- [x] `namedSecrets` + `handleModifyNamedSecret` in `state/useVaultSecret.ts`; barrels
      updated (`core/index.ts`, `state/index.ts`, `secret/index.ts`)
- [x] `NamedSecretTable` + `ConfigureSecretModal` under `settings/Vault/`. Format selector
      (`Segmented`); text → textarea; **json → typed key/value grid OR raw `SharedEditor`
      JSON editor** (Grid/JSON toggle). The grid keeps values **native** (string / number /
      boolean / null) with a per-row type selector shown as a `TypeChip` badge and
      `coerceToType` on change — so `{B: 2}` round-trips as a number, not `"2"` (modeled on
      playground variable management). Grid↔JSON sync enforces the flat-primitive shape
      (`assets/primitives.ts`, 17 pure-logic checks pass). Format-switch warns instead of
      coercing; delete reuses `DeleteProviderModal`.
- [x] Registered **Vault** Settings tab (key `vault`) as a sibling of "Models" (key
      `secrets`) in both the page router (`settings/index.tsx`) and `SettingsSidebar.tsx`;
      EE inherits it via its OSS-Settings re-export
- [x] `eslint --fix` on all touched web files; `@agenta/entities` builds clean

### Verification
- [x] Backend unit: extended `api/oss/tests/pytest/unit/secrets/test_dtos.py` — text,
      text-verbatim-json-string, json-flat (str/int/bool/null), + rejections (json
      nesting, json array, text non-string, unknown format, missing value). **11 passed.**
- [x] Backend integration: added `TestCustomNamedSecretsAPI` to
      `.../legacy/vault_router/test_vault_secrets_apis.py` — text + json create/get/delete
      round-trip + nesting/non-string rejections (runs when the stack is up).
- [ ] `alembic upgrade head` + manual API + UI click-through — **pending** (needs the
      running stack; not run here).

## Open questions / decisions log

- 2026-06-18: Storage scope confirmed as **project vault** (not per-agent). New
  `SecretKind = custom_secret`, name in `header.name`.
- 2026-06-18: Runtime/agent wiring is **out of scope** for this iteration.
- 2026-06-26: Secrets get a **`format`** (`text` | `json`), AWS-Secrets-Manager style.
  `text` = opaque string stored verbatim; `json` = flat object of primitives (no nesting /
  arrays, backend rejects). Modeled as a `format` field inside `custom_secret` data
  (`{secret:{format, value}}`), **not** a second kind. text/json rendering (raw vs grid vs
  JSON editor) is a UI choice.
- 2026-06-26: Management UI moves to its **own Vault Settings section**, out of "Providers
  & Models" (LLM-scoped; also holds internal webhook/SSO secrets users don't manage).
- 2026-06-27: **Renamed the secret value field `value` → `content`** end to end (wire shape
  is now `data.secret.{format, content}`, backend DTO `CustomSecretSettingsDTO.content`,
  Fern `CustomSecretSettingsDto.content`, entity `NamedSecretRow.content` /
  `CustomSecretContent`, modal + table labelled "Content"). Earlier doc prose still says
  `value`; the field is `content`. Safe rename — feature is unreleased.
- 2026-06-27: Settings tab labels finalised — `secrets` tab = **"LLMs"** (was "Models"),
  `vault` tab = **"Secrets"** (was "Vault"); sidebar order API Keys → Secrets → LLMs →
  Tools → Triggers → Webhooks. Route keys (`secrets`, `vault`) unchanged. Secrets-table
  column order: Name → Content → Format → Created at.
