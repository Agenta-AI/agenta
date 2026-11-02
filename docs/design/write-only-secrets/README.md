# Write-only vault secrets

A write-only Vault secret can be created, replaced, and deleted, but an ordinary API or
frontend caller cannot read its value back. A trusted platform runtime can resolve the value
through a short-lived granted token so the credential remains usable for runs.

Status: implementation complete across #6164, #6165, #6138, #6195, and #6174. The backend
and frontend ship in the same release. The feature has no environment gate or compatibility
mode.

## Value visibility

`write_only` is a creation-time policy:

- New ordinary Vault secrets default to `write_only=True`.
- A create request may explicitly select `write_only=False`.
- Existing rows without the stored field resolve as `write_only=False`.
- Update requests cannot set or change `write_only`.
- Changing the policy requires deleting and recreating the secret.

The policy remains in the existing encrypted `data` JSON. This implementation requires no
database migration.

SSO and webhook secrets explicitly use `write_only=False`. Their existing settings, login,
test, signing, and verification flows continue to receive the readable value.

## Public and trusted responses

The trusted `SecretResponseDTO` contains the stored credential. The caller-facing
`PublicSecretResponseDTO` adds general value status:

```json
{
  "write_only": true,
  "value_status": {
    "configured": true,
    "preview": "sk-****9Qa"
  }
}
```

`value_status.configured` reports whether the secret contains credential material.
`value_status.preview` is optional and does not determine whether a value is configured.
The model applies to provider keys, custom secrets, compound provider credentials, SSO,
webhooks, and later secret kinds.

For an ordinary caller, the response projection removes the primary credential and every
credential-bearing provider extra when `write_only=True`. Non-secret configuration such as
URLs, regions, versions, models, and harnesses remains readable. A verified runtime token
carrying the `secret-resolve` grant receives the plaintext projection.

The credential-extra vocabulary is shared by the API redaction layer and Python SDK resolver
through `agenta.sdk.agents.connections.credentials`. The same module exposes the SDK helper
that reads `value_status.configured`, so runtime consumers use the public API contract rather
than a key-specific field.

## Vault list cache

The Vault service caches canonical trusted DTOs in Redis with the existing namespace, TTL,
invalidation, and shortened project UUID packing. Create, update, and delete invalidate the
project list namespace.

Caller-specific projection always happens after a cache read:

```text
list request
  -> read canonical SecretResponseDTO values from Redis or the DAO
  -> inspect the verified caller grant
  -> return plaintext to a granted runtime or redact for an ordinary caller
```

Redis is part of the trusted backend boundary. A redacted response is never stored in the
shared list cache.

## Updates

Credential updates use one strict contract:

- An omitted credential field means keep the stored value.
- A non-empty credential replaces the stored value.
- An explicitly supplied empty provider credential is invalid and is rejected.
- An empty JSON object remains an explicitly supplied JSON value and follows the custom-secret
  validation rules.

The frontend ships with the backend and follows the same contract. When a user edits a
write-only connection without typing a replacement credential, the frontend omits the
credential field. It never sends an empty value as the keep signal.

Carry-over is identity-local. Changing the secret kind, provider family, or custom-secret
format requires an explicit new credential. The service resolves the update against the row
loaded under `SELECT ... FOR UPDATE`, so a concurrent rotation cannot be overwritten by a
stale carried value.

## Runtime resolution

The platform uses the `secret-resolve` grant for plaintext runtime access. The grant is
project-scoped and allowlisted on the Vault read routes.

`AGENTA_SERVICES_INTERNAL_KEY` proves the trusted API-to-Services exchange. It is independent
from `AGENTA_AUTH_KEY`, has no administrator-key fallback, and must contain a non-placeholder
value. The API fails startup when it is missing or invalid.

Configure the same `AGENTA_SERVICES_INTERNAL_KEY` value on the API and trusted Services
container. Do not provide it to the web app, runner, sandbox, worker, cron, or migration
containers. The runner receives only the signed, short-lived runtime token needed to execute
the authorized workload.

A caller refreshing an already granted Secret token may carry the grant forward. The exchange
does not create the grant from a requested action alone.

## Consumer behavior

| Consumer | Behavior |
| --- | --- |
| Frontend Settings and connection forms | Read `value_status`, display configured state, and omit untouched credential fields on update. |
| Direct API callers | Receive redacted write-only values and general value status. |
| Platform runs | Resolve plaintext through the granted runtime token. |
| Standalone Python SDK | Reads `value_status`; a redacted provider connection uses only the matching provider environment credential or fails with `WriteOnlySecretError`. |
| Legacy SDK Vault middleware | Drops configured redacted entries so they cannot shadow local environment credentials. |
| Named tool secrets | Skip configured redacted values and log an error without the secret name or value. |
| SSO and webhooks | Remain explicitly readable and otherwise unchanged. |
| In-process trusted readers | Continue using the trusted DTO with plaintext. |

## Managed secrets

Managed lifecycle and value visibility are independent. A managed row stores typed internal
manager identity and policy in the encrypted JSON payload. The public response exposes only
`management.policy`.

The starter-credit bridge explicitly creates its connection with
`management.policy=manager_only` and `write_only=True`. General update, delete, and provider
probe operations reject manager-only rows against the current locked record. The frontend
hides these rows from Settings and edit surfaces but keeps them available for model selection,
agent defaults, key gating, and execution.

## Pull request order

The release chain is:

```text
release/v0.114.0
  -> #6164 write-only contract
  -> #6165 managed-secret model
  -> #6138 starter-credit seeding
  -> #6195 stored provider probe
  -> #6174 generated clients and frontend consumer
```

The five pull requests merge in this order and deploy together in the same release.
