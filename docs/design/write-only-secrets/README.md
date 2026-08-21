# Write-only vault secrets

A vault secret's value can be created, replaced, and deleted — but never read back by a
user. The platform runtime keeps reading it through a granted internal path so runs still
work. This is the GitHub-secrets model.

Status: backend landed (API + Python SDK). Frontend and Fern client regeneration follow in
a second PR.

## The contract

### The flag

- `write_only: bool` on every secret. **New secrets default to `true`.** An explicit
  `write_only: false` at creation is the compatibility escape hatch.
- Existing rows carry no flag and read as `write_only: false`; their behavior is unchanged.
- The flag is **one-way**: an update may tighten `false → true`, but `true → false` is
  rejected with HTTP 400 (`WriteOnlyCannotBeDisabledError`). Making a value readable again
  would defeat the guarantee; delete and recreate instead.
- Storage: the flag rides inside the existing encrypted `data` JSON as a sibling key
  (`"write_only": true`), popped out at the mapping layer. **No schema migration.**

### Redaction (user-facing responses)

For `write_only: true`, every user-facing vault response (create echo, list, get, update
echo) strips the value and adds:

- `has_key: bool` — whether a value is stored.
- `key_preview: str | null` — masked preview like `sk-****9Qa` (first 3 + last 3 characters,
  only for string values of 12+ characters; shorter values and JSON content show no
  preview). One helper: `oss/src/core/secrets/redaction.py`.

Stripped fields per kind: `provider.key` (provider_key, custom_provider, webhook_provider),
`provider.client_secret` (sso_provider), `secret.content` (custom_secret), plus the
credential keys of a custom provider's `extras` (`api_key`, `aws_access_key_id`,
`aws_secret_access_key`, `aws_session_token`). Non-credential config (URL, region,
api_version, models, harnesses) stays readable.

Redaction happens once, at the API response boundary (`VaultRouter`). In-process readers
(`VaultService` and below: webhooks, SSO overrides, EE organizations) are untouched and
keep plaintext.

The Redis list cache stores the **redacted** shape — which also removes the previous
plaintext-at-rest in Redis for write-only secrets.

### Updates: keep-stored-on-omit

On update, an omitted value field means "keep the stored value" (extends the existing
`_carry_over_saved_policy` pattern for `models`/`harnesses`). This covers the standard
provider key, the custom provider key and its credential `extras`, and custom secret
content. **An empty string counts as omitted**: an empty credential is never a meaningful
value, and replace-only forms submit empty for "unchanged". Values are therefore
replace-only — they cannot be cleared in place.

This applies to all secrets, not only write-only ones, so update semantics do not fork on
the flag.

### The runtime plaintext path: the `secret-resolve` grant

- Constant: `SECRET_RESOLVE_GRANT = "secret-resolve"` (`oss/src/middlewares/auth.py`).
- It is a **grant**: an additive claim, not a restriction. The runtime's credential is
  general-purpose — it authenticates workflows, tools, session coordination, and vault
  reads alike — so the plaintext capability rides a `grants` claim that adds one ability
  and never narrows what the token can otherwise do.
- Minted in two places:
  - `GET /access/permissions/check` attaches the grant to the re-minted `credentials` for
    `action=run_service` exchanges — the credential every workflow service and sandbox run
    actually uses for its vault reads.
  - The workflow invoke/inspect prelude (`sign_secret_token` in
    `core/workflows/service.py`) — covers services running with auth middleware disabled,
    which use that token directly.
- A verified Secret token carrying the grant receives plaintext from all vault read routes
  (write_only is ignored for it). Everyone else — session, ApiKey, unscoped Secret token —
  gets the redacted shape. **Strict stance: no transition period for ApiKey callers.**

Trust line (same as GitHub's): anyone who can run a workload can reach the values through a
run, so the `run_service` exchange hands out the grant. What the flag removes is the casual
read: no session, ApiKey, or list/get call ever returns the value.

## Consumer impact

| Consumer | Path | Impact |
| --- | --- | --- |
| Frontend forms | vault routes, session auth | Redacted for write-only secrets; needs replace-only forms (follow-up) |
| Direct API users (ApiKey) | vault routes | Redacted for write-only secrets; no escape hatch besides `write_only: false` at creation |
| Platform runs (playground, deployments, agents) | granted credential via `permissions/check` | Unchanged — plaintext |
| Standalone SDK runs (ApiKey) | `VaultConnectionResolver` | Fail loud: `WriteOnlySecretError` with instructions to use env vars |
| Standalone SDK legacy services | `VaultMiddleware.get_secrets` | Redacted entries dropped with a clear `log.error`; env-var keys are not shadowed by them |
| Named tool secrets | `resolve_named_secrets` | Redacted entries skipped with a clear `log.error` (best-effort contract kept) |
| In-process readers (webhooks, SSO, EE orgs) | `VaultService` direct | Unchanged — plaintext |

## Frontend follow-up (second PR)

- Replace-only secret forms: no value prefill; show `key_preview`/`has_key`; a "Replace
  key" action instead of an editable field.
- Surface `write_only` in the connections/secrets lists.
- Optional "readable" toggle at creation only (maps to `write_only: false`), if product
  wants the escape hatch exposed.
- Regenerate the Fern client for the new `write_only`, `has_key`, `key_preview` fields.
