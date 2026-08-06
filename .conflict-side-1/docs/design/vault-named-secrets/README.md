# Vault named secrets

Add arbitrary user-named secrets to the project vault. Today the vault only stores LLM
provider keys and custom providers. This feature lets a user save any named secret (for
example `GITHUB_TOKEN`) scoped to the project, and manage it from a dedicated **Vault**
section in Settings.

Each secret declares a **format** (the AWS Secrets Manager model):

- **`text`** — an opaque string, stored verbatim (no re-serialization).
- **`json`** — a **flat** object of primitives (no nested objects, no arrays); the shape
  that maps onto environment variables. The backend rejects nesting.

How a value is displayed (raw vs prettified text; JSON editor vs key/value grid) is a UI
choice; `format` is what changes validation.

Scope for this iteration: **storage + management UI only**. We do not wire these secrets
into the agent runtime / sandbox yet. That is a separate follow-up — but `format` is
designed with that consumption in mind (`json` → env vars, `text` → file/single value).

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
  generic CRUD, encryption, DAO, and mapping layers unchanged. The `text`/`json` split is a
  `format` field **inside** the secret data, not a second kind — one kind, two validation
  rules.
- The management UI is a **new Vault Settings section**, separate from "Providers & Models"
  (which is LLM-scoped and also holds internal webhook/SSO secrets).
