# Write-only vault secrets

A vault secret's value can be created, replaced, and deleted — but never read back by a
user. The platform runtime keeps reading it through a granted internal path so runs still
work. This is the GitHub-secrets model.

Status: backend landed (API + Python SDK), inert by default behind
`AGENTA_VAULT_WRITE_ONLY_DEFAULT=false`. Two PR numbers appear around this work and mean
different things: **#6065** is the frontend package-extraction refactor (merged) that the
web half of this feature builds on, and **#6135** is the branch this backend PR is
stacked on (the per-turn trace-export credential fix), which is a stacking base only and
has nothing to do with secrets. The web half (replace-only forms plus Fern client
regeneration) follows in a second PR, after which the gate flips on. Until then, an
explicitly created `write_only: true` secret shows cosmetically as "not configured" in
today's Settings (the UI does not read `has_key` yet) — accepted; the run path is
unaffected either way.

## The contract

### The flag

- `write_only: bool` on every secret. The default for NEW secrets is env-gated:
  **`AGENTA_VAULT_WRITE_ONLY_DEFAULT` (bool, default `false`)**. While off, flag-less
  creates behave exactly as today (`write_only: false`); once the web UI ships
  replace-only forms, the gate flips to `true` and new secrets default to write-only.
  An explicit `write_only` on the create request always wins over the gate, in both
  directions — so a caller can opt in to write-only immediately regardless of the
  default, and `write_only: false` remains the escape hatch after the flip.
- Existing rows carry no flag and read as `write_only: false`; their behavior is unchanged.
- The flag is **one-way**: an update may tighten `false → true`, but `true → false` is
  rejected with HTTP 400 (`WriteOnlyCannotBeDisabledError`). Making a value readable again
  would defeat the guarantee; delete and recreate instead. The transition is enforced
  atomically: the DAO checks under a `SELECT ... FOR UPDATE` row lock, and the mapper
  never clears a stored flag even when handed a stale explicit `false` — concurrent
  updates cannot resurrect readability.
- Storage: the flag rides inside the existing encrypted `data` JSON as a sibling key
  (`"write_only": true`), popped out at the mapping layer. **No schema migration.**

### Redaction (user-facing responses)

For `write_only: true`, every user-facing vault response (create echo, list, get, update
echo) strips the value and adds:

- `has_key: bool` — whether any credential material is stored (the primary value OR a
  credential extra: an AWS-only secret reports `true`).
- `key_preview: str | null` — masked preview of the PRIMARY value only. Policy: values
  under 20 characters mask entirely (`****`); from 20 on, at most first 3 + last 3
  characters and never more than 25% of the value (a 20-character value shows 5).
  Extras credentials and JSON content never get a preview. One helper:
  `oss/src/core/secrets/redaction.py`.

**One credential classifier.** What counts as credential material is defined once, in the
SDK (`agenta.sdk.agents.connections.credentials`): the primary value field per kind
(`provider.key`; `provider.client_secret` for sso_provider; `secret.content` for
custom_secret) plus the full credential-extras set the SDK resolver consumes (`api_key`,
the `aws_*`/`AWS_*` credential trio and bearer tokens, `ANTHROPIC_AUTH_TOKEN` and the
other provider tokens, `AZURE_OPENAI_API_KEY`, `GOOGLE_APPLICATION_CREDENTIALS`, ...).
The API imports that module for redaction, `has_key`, and update carry-over; a parity
test fails if a resolver-accepted extras key is ever left unclassified. Non-credential
config (URL, region, api_version, project, models, harnesses) stays readable.

Redaction happens at the response boundary, in every outward surface:

- the vault routes (`VaultRouter`), for all five endpoints;
- webhook subscription responses (create echo, fetch, edit echo) — the signing value
  disappears from responses once its vault record is write-only, while the delivery
  signers (the service-internal resolver and the dispatcher's own) keep plaintext;
- the EE organization-provider serialization drops `client_secret`; the SuperTokens
  login-time reader keeps plaintext.

In-process runtime readers (`VaultService` and below) are untouched.

**No cache.** The list route reads the database on every request. The list is small and
only the settings page reads it, and the runtime path already bypassed the cache, so
caching bought little while making the redaction guarantee depend on what a shared Redis
entry holds and on how a stale reader is kept from repopulating it. Removing the cache
removes that whole class of question: what a caller sees is what the row says, redacted
at the response boundary for every principal without the grant.

### Updates: keep-stored-on-omit

On update, an omitted value field means "keep the stored value" (extends the existing
`_carry_over_saved_policy` pattern for `models`/`harnesses`). This covers the standard
provider key, the custom provider key and its credential `extras`, and custom secret
content. **An empty string counts as omitted — this is mandatory, not a convenience**: the
CURRENT frontend's edit form re-sends `key: ""` when it cannot prefill a value, so if `""`
cleared the credential, every edit of a write-only secret through today's UI would wipe
it. An empty credential is never a meaningful value anyway. Values are therefore
replace-only — they cannot be cleared in place.

This applies to all secrets, not only write-only ones, so update semantics do not fork on
the flag.

**Keep-on-omit is identity-local.** An update that changes the secret's kind or its
provider family (`data.kind`) must carry an explicit new credential value; omitted or
empty values are rejected with HTTP 400 (`SecretValueRequiredError`), and the old
identity's credential extras never carry over. A stored OpenAI key can never silently
become an Anthropic key, and a kind change can never silently erase the stored value.
(Consequence: a credential-less record — for example an endpoint-only custom provider —
cannot be the target of a kind/family change; delete and recreate it.)

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
| Standalone SDK runs (ApiKey) | `VaultConnectionResolver` | Fail loud: `WriteOnlySecretError`, raised even when config extras survive; remediation = switch the connection to `self_managed` AND set the env variable |
| Standalone SDK legacy services | `VaultMiddleware.get_secrets` | Redacted entries dropped with a clear `log.error`; env-var keys are not shadowed by them |
| Named tool secrets | `resolve_named_secrets` | Redacted entries skipped with a clear `log.error` (no secret names in logs) |
| Webhook subscribers (UI/API responses) | webhook routes | Signing secret disappears from create/fetch/edit responses once its record is write-only; deliveries keep signing |
| EE SSO provider settings | organization-provider routes | `client_secret` dropped once write-only; login flow unaffected |
| In-process runtime readers (SuperTokens login, delivery signing, EE orgs internals) | `VaultService` direct | Unchanged — plaintext |

## Frontend follow-up (second PR)

- Replace-only secret forms: no value prefill; show `key_preview`/`has_key`; a "Replace
  key" action instead of an editable field.
- Surface `write_only` in the connections/secrets lists.
- Optional "readable" toggle at creation only (maps to `write_only: false`), if product
  wants the escape hatch exposed.
- Regenerate the Fern client for the new `write_only`, `has_key`, `key_preview` fields.


## Who may read a value: the grant

The vault returns plaintext only to a caller whose verified `Secret` token carries the
`secret-resolve` grant. Two callers can hold it, and there is no third:

- **The platform runtime**, on the hop that starts a run. The workflow service exchanges
  the END USER's credential at `/access/permissions/check` on their behalf, so nothing
  about the presented token says a run is starting — and that route is reachable by a
  browser. The runtime therefore proves what it is with a secret only the backend holds
  (`AGENTA_SERVICES_INTERNAL_KEY`), sent as `X-Agenta-Runtime-Key` on the internal
  hop and compared in constant time. This key has no fallback to
  `AGENTA_AUTH_KEY`. If it is missing or remains the well-known placeholder, the API
  issues no grant instead of accepting a string anyone could send.
- **A caller refreshing a grant it already holds.** The runner re-exchanges its run
  credential every few heartbeats; the exchange carries the grant forward rather than
  re-deciding it. The runner is never given the runtime secret, and it never reaches a
  sandbox.

**A deployment without the dedicated key loses agent runs against write-only connections**,
and the failure names something else: the run reports "provide the provider key in this run's
environment", which is right for a standalone run and misleading here. The services
middleware therefore warns once, at the point of use, naming the variable to set. The
placeholder is the shipped default in the example env files, so this is the common case,
not an edge one.

**Deployment.** Set `AGENTA_SERVICES_INTERNAL_KEY` to the same value on the API and the
Services container before turning write-only on. It must be independent from
`AGENTA_AUTH_KEY` and must not be provisioned to web, runner, sandbox, worker, cron, or
migration containers. The API warns at startup when a deployment uses write-only secrets
without one, and a component that seeds write-only rows refuses to seed rather than store
a credential no run can read.

The exchange never mints the grant from the requested `action` alone. It did once, and
that made the grant self-serve: `VIEWER_PERMISSIONS` includes both `run_service` and
`view_secret`, so any member could ask for a credential and spend it on the vault routes.


## Known gap: cache-key tenancy (elsewhere)

The platform cache truncates a project id to its last 12 characters, so two projects whose
UUIDs end the same way share an entry in every namespace that caches per project,
including `check_permissions` and `check_action_access`. Server-generated UUID4s make that
remote, and unreachable by a caller who cannot pick their own project id, but it is a
default worth removing. Nothing here depends on it — the vault caches nothing — and the
platform-wide fix is tracked in issue #6166.
