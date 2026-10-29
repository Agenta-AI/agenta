# The vault contract the seeded row depends on

The starter-credits bridge writes one vault row and then never touches it again. That row
holds a credential the organization did not supply, under a name that other records point
at. Two vault attributes make it safe to leave there: `write_only` keeps its value from
being read back, and `managed_by` keeps the row from being edited or deleted.

Both are general platform mechanisms, not bridge features. The bridge is the first thing
that sets them. The full write-up of each lives in
[docs/design/write-only-secrets](../write-only-secrets/README.md) and
[docs/design/managed-secrets](../managed-secrets/README.md); this page covers the parts the
bridge depends on and why it sets both at creation.

## The problem

Any project member could list the project's vault secrets, and every one of those
responses carried decrypted values. The create call handed the key straight back, and the
list response was cached with plaintext in it. There was no masking anywhere on the
server.

For the bridge that is the last place a user can read the seeded virtual key. For the
platform it is larger than the bridge: every project member could read every teammate's
provider key.

## Write-only: the GitHub model

A secret can be created, replaced, and deleted. It is never read back by a user. The
runtime that spends it keeps reading it.

### The flag

`write_only: bool` on every secret (`api/oss/src/core/secrets/dtos.py`).

- The default for new secrets is env-gated: `AGENTA_VAULT_WRITE_ONLY_DEFAULT`
  (`api/oss/src/utils/env.py`), which ships false. An explicit `write_only` on the create
  request always wins over the gate, in both directions, which is how the bridge seeds its
  key write-only while nothing changes for anyone else.
- Rows that carry no flag read as `write_only: false`. Their behavior is unchanged.
- The flag is **one-way**. An update may tighten false to true. True to false returns HTTP
  400 (`WriteOnlyCannotBeDisabledError`); delete and recreate instead. The transition is
  atomic: the DAO checks under a `SELECT ... FOR UPDATE` row lock
  (`api/oss/src/dbs/postgres/secrets/dao.py`), and the mapper never clears a stored flag
  even when handed a stale explicit false.
- It rides inside the existing encrypted `data` JSON as a sibling key, popped out at the
  mapping layer. There is no schema migration.

### Redaction

For a write-only secret, every user-facing response (create echo, list, get, update echo)
strips the value and adds two fields:

- `has_key: bool`. Whether any credential material is stored, including credential extras.
- `key_preview: str | null`. A masked preview of the primary value only. Values under 20
  characters mask entirely; longer ones disclose at most three leading and three trailing
  characters, and never more than a quarter of the value. The policy lives in one helper,
  `api/oss/src/core/secrets/redaction.py`.

What counts as credential material is defined once, in the SDK
(`sdks/python/agenta/sdk/agents/connections/credentials.py`), and imported by the API, so
the fields the resolver consumes as credentials and the fields redaction strips cannot
drift. Non-credential configuration (URL, region, model list) stays readable, which is why
a redacted seeded connection still shows the user which proxy and which model it points
at.

Redaction happens at the response boundary, in every outward surface: the vault routes,
webhook subscription responses, and the EE organization-provider serialization. In-process
runtime readers below `VaultService` are untouched.

### Updates keep the stored value on omit

On update, an omitted value field means "keep the stored value", extending the existing
carry-over pattern (`_carry_over_saved_policy` in `api/oss/src/core/secrets/services.py`).
An empty string counts as omitted. That is mandatory rather than convenient: the current
edit form re-sends an empty key when it cannot prefill a value, so treating empty as
"clear" would wipe the credential on every edit of a write-only secret through the
existing UI. Values are therefore replace-only.

Carry-over is identity-local. An update that changes the secret's kind or its provider
family must carry an explicit new credential; omitting it returns HTTP 400
(`SecretValueRequiredError`), and the old identity's credential extras never carry over. A
stored key for one provider can never silently become a key for another.

### The runtime path: a grant, not a scope

`SECRET_RESOLVE_GRANT = "secret-resolve"` (`api/oss/src/middlewares/auth.py`).

A scope confines a token to an allowlist of paths. The runtime's credential is
general-purpose, since it authenticates workflows, tools, session coordination, and vault
reads alike, so the plaintext capability rides an additive `grants` claim that confines
nothing.

It is minted in two places:

- `GET /access/permissions/check` attaches it to the re-minted credential for
  `action=run_service` exchanges (`api/oss/src/apis/fastapi/access/router.py`). That is the
  credential every workflow service and sandbox run actually uses.
- The workflow invoke and inspect prelude (`sign_secret_token` in
  `api/oss/src/core/workflows/service.py`), which covers services running with auth
  middleware disabled.

A verified Secret token carrying the grant receives plaintext from the vault read routes.
Everyone else, including session and API-key callers, gets the redacted shape. There is no
transition period for API-key callers.

The trust line is GitHub's: anyone who can run a workload can reach the values through a
run. What the flag removes is the casual read.

### What a standalone SDK run sees

A process running outside the platform with a raw API key gets the redacted shape. The
resolver falls back to the provider's standard environment variable, and raises
`WriteOnlySecretError` (`sdks/python/agenta/sdk/agents/connections/errors.py`, HTTP 422)
only when that variable is absent too. Passing a redacted value to a provider would fail
with a misleading authentication error, so the resolver fails loudly and names the
remediation: switch the connection to `self_managed` and set the provider's environment
variable.

## Managed rows

`managed_by: str | None` names the platform component that provisioned and owns a row, for
example `"starter-credits-bridge"`. Absent means nobody owns it, which is every row that
existed before.

- It is **server controlled**. The vault routes reject a client-supplied `managed_by` on
  create and on update with HTTP 400 (`ManagedByIsServerControlledError`). Rejecting
  rather than ignoring matters: a caller that sent the field believes the row will end up
  managed, and dropping it silently would leave that caller wrong about what the vault
  holds.
- Only in-process callers set it, by putting it on the `CreateSecretDTO` they hand
  `VaultService.create_secret`.
- A managed row is read-only to users. Update and delete both return HTTP 409
  (`ManagedSecretReadOnlyError`). It is 409 and not 400 because the request is well formed;
  it is the stored row's state that forbids it.
- `update_secret` and `delete_secret` take `allow_managed: bool = False`
  (`api/oss/src/core/secrets/services.py`). The default applies the guard, so a route added
  later is guarded without anyone remembering to opt in. Forgetting the parameter denies;
  it does not permit. The owning component passes `allow_managed=True` when it needs to
  re-credential or tear down its own row.

Enforcement lives in `api/oss/src/core/secrets/managed.py` and is invoked by
`VaultService`.

The bridge sets `allow_managed` nowhere. It seeds once, never repairs
([design.md](design.md#no-repair-path)), and its teardown is an operator procedure, so the
override exists for a future owner rather than for this one.

## Why the bridge sets both, at creation

| Attribute | What it stops | Why at creation |
| --- | --- | --- |
| `write_only` | Reading the virtual key back through the API | A row that starts readable and is tightened later has a window in which the key is readable, and that window is the first minutes of a new organization |
| `managed_by` | Deleting the row, renaming it, or re-pointing it | The same window applies, and a row deleted before the marker lands is gone with no repair path |

The two compose. A managed write-only row redacts and refuses.
