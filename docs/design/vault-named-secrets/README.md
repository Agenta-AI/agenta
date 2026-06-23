# Vault named secrets

Add arbitrary user-named secrets to the project model vault. Today the vault only stores
LLM provider keys and custom providers. This feature lets a user save any `name -> value`
secret (for example `GITHUB_TOKEN`) alongside the existing provider keys, scoped to the
project, and manage them from Settings.

Scope for this iteration: **storage + management UI only**. We do not wire these secrets
into the agent runtime / sandbox yet. That is a separate follow-up.

## Files in this folder

- `context.md` — why this work exists, goals, non-goals, decisions.
- `research.md` — how the vault works today, with exact file:line references and gotchas.
- `plan.md` — the execution plan (backend, migration, frontend), phase by phase.
- `status.md` — current progress and the source of truth for what is done / next.

## Quick orientation

- Backend vault domain: `api/oss/src/core/secrets/` + `api/oss/src/dbs/postgres/secrets/`
  + router `api/oss/src/apis/fastapi/vault/router.py`.
- Frontend vault UI: `web/oss/src/components/pages/settings/Secrets/` + entity package
  `web/packages/agenta-entities/src/secret/`.
- The vault is `kind`-driven. We add one new `SecretKind` (`custom_secret`) and reuse the
  generic CRUD, encryption, DAO, and mapping layers unchanged.
