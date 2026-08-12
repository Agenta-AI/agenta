# WP2 — Secret resolution

Delivers `CredentialResolver`, the one class both gateways call to turn a `CredentialRef`
into a `(secret, owner, payer)` triple. Pure logic wrapped around two existing services —
`VaultService` and the grants DAO — so nothing here talks to Postgres directly. Owns
`core/gateways/policy/resolution.py` only.

This is the signature `plan.md` calls out as the one thing the seed had to get right:
`resolve()` takes the owner from the outset (D10) even though today only the project
answers. WP2 fills in behavior; it does not touch the signature — that is frozen by the
seed commit in `core/gateways/policy/interfaces.py`.

## What this is NOT

- **Not the vault, not the grants table.** `VaultService` (`core/secrets/services.py`)
  and `McpGrantsDAOInterface` (implemented by WP1) already exist; WP2 composes them, never
  reimplements encryption, storage, or the grants schema.
- **Not the permission or entitlement check.** `authorize()` on
  `GatewayPolicyService` is WP3's; WP2's `resolve()` is called only *after* WP3 (or a
  caller mimicking it) has already decided the call is allowed. `resolve()` never checks
  a permission and never raises `PolicyDeniedError`.
- **Not the brokered (`builtin`, MCP) path.** A Composio-backed MCP endpoint's credential
  lives at the broker and never enters the vault — `McpBrokeredAuth` carries the
  `gateway_connections` row directly, never `ResolvedCredential`. `resolve()` is never
  called for that namespace; routing around it with a fourth `CredentialRef` arm was
  rejected in `entities.md` §7.2 and must not be reintroduced here.
- **Not the OAuth client.** `resolve()`'s `GrantRef` arm reads an existing grant row and
  its vault secret; it never mints, refreshes, or exchanges a token. That is WP17.
- **Not the two new secret kinds.** `oauth_provider`/`oauth_grant` (WP16) do not exist yet
  when this package lands (wave 1, before Checkpoint B). `resolve()`'s `GrantRef` branch
  is written against the DAO/vault shapes now; it becomes reachable once WP16+WP17 land
  real grant rows. Nothing in WP2 blocks on WP16.

## Files

New:
- `api/oss/src/core/gateways/policy/resolution.py` — `CredentialResolver`, implementing
  `CredentialResolverInterface` (seed-owned, `core/gateways/policy/interfaces.py` —
  imported, never edited).

Edited: none. WP2 adds one construction line to `api/entrypoints/routers.py` at the M1
merge (below); it does not commit that file.

## Interface (reproduce verbatim, seed-owned)

From `core/gateways/policy/interfaces.py` (`entities.md` §7.2):

```python
class CredentialResolverInterface(ABC):
    """One lookup, called by both planes. Fakeable (D23): the fake resolver
    answers from a dict and never touches the vault."""

    @abstractmethod
    async def resolve(
        self,
        *,
        scope: AuthScope,
        #
        ref: CredentialRef,
        mode: CredentialMode,
    ) -> ResolvedCredential:
        """Resolve one credential for one call.

        The mode logic, in full (secrets.md):
          PROJECT_ONLY  -> the project secret; CredentialNotFoundError(PROJECT) if absent.
          USER_REQUIRED -> the (project, user) secret; CredentialNotFoundError(USER)
                           if absent — NEVER falls back.
          USER_OPTIONAL -> the (project, user) secret if present, else the
                           project's; CredentialNotFoundError(USER) naming the
                           narrower owner if neither exists.

        Until user-owned secrets ship, the user arm of every mode finds nothing
        and the modes degrade to project lookup or failure — behaviourally
        today's world, with the signature already right.

        By ref arm:
          ProviderKeyRef -> scan the project's provider_key / custom_provider
                            secrets for the provider, as the SDK's settings
                            builder does today (models.md).
          BoundSecretRef -> VaultService.get_secret_by_id, scoped to the project.
          GrantRef       -> the grants DAO's owner-keyed fetch, then
                            get_secret_by_id; CredentialInvalidError when the
                            grant's is_valid is False (D18).

        Raises, never returns None: no path silently yields "no credential",
        and the exceptions carry which owner is missing so the boundary can
        build the connect affordance."""
        ...

    @abstractmethod
    async def available_provider_keys(self, *, scope: AuthScope) -> Set[str]:
        """Provider keys with a resolvable project-owned secret. Names only,
        never a value — an existence test that must not read a credential."""
        ...
```

**The second method is R2's ruling, added at kickoff.** D20 makes a generated `builtin`
endpoint exist for a project exactly when a provider key exists for it, so
`LlmGatewayService.list_endpoints` (WP7) needs to ask that question — and it has no vault
dependency, by design. Handing the service a `VaultService` would give it two credential
seams and defeat the port; calling `resolve()` once per provider and catching
`CredentialNotFoundError` is control flow by exception plus eleven vault reads per list.
Existence of a credential is a credential-layer question, so it belongs on the credential
port.

Implement it over the same scan `ProviderKeyRef` uses — the project's `provider_key` and
`custom_provider` secrets — returning the set of provider names found. It returns names,
never secret values, and it never raises for "none found": the empty set is the correct
answer, unlike `resolve()`, which raises because a caller asking to resolve has already
committed to needing one.

## DTOs used (reproduce verbatim, seed-owned — `core/gateways/policy/dtos.py`)

```python
class CredentialMode(str, Enum):
    USER_OPTIONAL = "user_optional"
    USER_REQUIRED = "user_required"
    PROJECT_ONLY = "project_only"

class CredentialOwnerKind(str, Enum):
    PROJECT = "project"
    USER = "user"

class CredentialOwner(BaseModel):
    kind: CredentialOwnerKind
    user_id: Optional[UUID] = None    # set exactly when kind is USER

class SecretOrigin(str, Enum):
    VAULT = "vault"
    LOCAL = "local"

class ProviderKeyRef(BaseModel):
    provider_key: str

class BoundSecretRef(BaseModel):
    secret_id: UUID

class GrantRef(BaseModel):
    endpoint_id: UUID

CredentialRef = Union[ProviderKeyRef, BoundSecretRef, GrantRef]

class ResolvedCredential(BaseModel):
    secret: SecretResponseDTO         # decrypted, from VaultService
    owner: CredentialOwner
    origin: SecretOrigin
```

`SecretResponseDTO` is `core/secrets/dtos.py`'s existing response type — WP2 imports it,
never redefines it. `origin` is currently always `SecretOrigin.VAULT` for every path
`resolve()` can reach in this scope: nothing in wave 1 has a `LOCAL`-origin secret to
return (that distinction belongs to the parallel bring-your-own-secrets work, `secrets.md`
§"secret_origin"). Set it to `VAULT` unconditionally; do not invent a `LOCAL` branch.

## Exceptions used (reproduce verbatim, seed-owned — `core/gateways/policy/types.py`)

```python
class CredentialNotFoundError(GatewaysError):
    def __init__(self, *, mode: CredentialMode, missing: CredentialOwnerKind, target: str): ...

class CredentialInvalidError(GatewaysError):
    def __init__(self, *, target: str, detail: Optional[str] = None): ...
```

`target` is a caller-supplied string identifying what was being resolved for — WP2 does
not have a `GatewayTarget` in `resolve()`'s signature, so it builds this string itself
from the `CredentialRef` it was given (e.g. `f"provider:{ref.provider_key}"`,
`f"secret:{ref.secret_id}"`, `f"endpoint:{ref.endpoint_id}"`). This is not named anywhere
in `entities.md` beyond "target" as a parameter name on the exception constructors — pick
a stable, greppable format per ref arm and keep it consistent across all three.

## Implementation, by ref arm

### `BoundSecretRef` — custom endpoints

The simple case. `mode` still governs owner selection even though a bound secret has no
owner axis of its own today — `VaultService.get_secret_by_id` takes only
`project_id`/`organization_id`, so in this scope the mode parameter is honored for
consistency (the signature promise) rather than because it changes behavior yet:

```python
secret = await self.vault_service.get_secret_by_id(
    ref.secret_id, project_id=scope.project_id,
)
if secret is None:
    raise CredentialNotFoundError(
        mode=mode, missing=CredentialOwnerKind.PROJECT, target=f"secret:{ref.secret_id}",
    )
return ResolvedCredential(
    secret=secret,
    owner=CredentialOwner(kind=CredentialOwnerKind.PROJECT),
    origin=SecretOrigin.VAULT,
)
```

Note `get_secret_by_id`'s real signature is `get_secret_by_id(self, secret_id: UUID,
project_id: UUID | None = None, organization_id: UUID | None = None)` —
`secret_id` is positional in `VaultService`, not keyword-only. Call it positionally; do
not assume `VaultService`'s own convention matches the gateways domain's keyword-only
house rule, because it predates it.

**Every call into `VaultService` must be wrapped in `set_data_encryption_key`
(`core/secrets/context.py`)** — the underlying DAO raises `ValueError` without it
(`get_data_encryption_key()`'s explicit check). `VaultService`'s own public methods
already open this context internally (see `services.py::get_secret_by_id`), so
`CredentialResolver` does **not** need to open it a second time around
`vault_service.get_secret_by_id(...)` — confirm this against `core/secrets/services.py`
before assuming otherwise; wrapping twice is harmless (the context manager nests) but
redundant, and *not* wrapping when calling `secrets_dao` directly (WP2 must not do this —
it only calls through `VaultService`) would raise.

### `ProviderKeyRef` — standard LLM endpoints

No column indexes "the provider's key" — this is a scan, matching what the SDK's
provider-settings builder already does client-side. **Precedent to study before writing
this branch:** `sdks/python/agenta/sdk/agents/platform/connections.py` —
`_provider_key_candidate()` (a `provider_key`-kind secret is identified by
`data.kind == provider` with the key itself at `settings.key`, i.e. `SecretDTO(kind=
PROVIDER_KEY, data=StandardProviderDTO(kind=<provider>, provider=StandardProviderSettingsDTO(key=...)))`)
and `_custom_provider_candidate()` (a `custom_provider`-kind secret matches when its
`data.kind` — a `CustomProviderKind` — equals the target provider). WP2 replicates the
*matching* rule these two functions encode, over `VaultService.list_secrets`, not the
whole candidate-selection/priority machinery in that file (which also handles model
allowlists, endpoints and env vars — out of scope for a credential lookup):

```python
secrets = await self.vault_service.list_secrets(project_id=scope.project_id)
match = next(
    (s for s in secrets if s.kind == SecretKind.PROVIDER_KEY
     and s.data.kind == ref.provider_key), None,
) or next(
    (s for s in secrets if s.kind == SecretKind.CUSTOM_PROVIDER
     and s.data.kind == ref.provider_key), None,
)
if match is None:
    raise CredentialNotFoundError(
        mode=mode, missing=CredentialOwnerKind.PROJECT,
        target=f"provider:{ref.provider_key}",
    )
```

`provider_key`-kind secrets take priority over `custom_provider`-kind matches when both
exist for the same provider — this mirrors `_catalog`'s ordering in the cited module
(provider_key candidates are the "standard" match; custom_provider is the fallback for a
reseller or self-hosted deployment claiming the same provider family). If two secrets of
the *same* kind match the same provider, behavior is undefined upstream too (the SDK
picks by list order); do not invent a tie-break rule beyond "first match" — flag it if a
reviewer wants one, do not silently add priority logic not present in the cited
precedent.

### `GrantRef` — OAuth MCP endpoints

```python
grant = await self.mcp_grants_dao.fetch_grant(
    project_id=scope.project_id, endpoint_id=ref.endpoint_id, user_id=scope.user_id,
)
if grant is None and mode is not CredentialMode.PROJECT_ONLY:
    # USER_OPTIONAL falls back; USER_REQUIRED does not attempt this branch at all
    ...
if grant is None:
    grant = await self.mcp_grants_dao.fetch_grant(
        project_id=scope.project_id, endpoint_id=ref.endpoint_id, user_id=None,
    )
if grant is None:
    raise CredentialNotFoundError(mode=mode, missing=..., target=f"endpoint:{ref.endpoint_id}")
if not grant.flags.is_valid:
    raise CredentialInvalidError(target=f"endpoint:{ref.endpoint_id}")
secret = await self.vault_service.get_secret_by_id(grant.secret_id, project_id=scope.project_id)
if secret is None:
    # a dangling secret_id despite the FK — the constraint prevents this at
    # steady state, but a resolver must not trust an invariant it cannot see
    raise CredentialInvalidError(target=f"endpoint:{ref.endpoint_id}", detail="secret missing")
return ResolvedCredential(
    secret=secret, owner=CredentialOwner(kind=..., user_id=...), origin=SecretOrigin.VAULT,
)
```

The pseudocode above is illustrative of the branch order, not a literal transcription —
write the full mode table (§ below) explicitly rather than the abbreviated `if` chain
shown. `CredentialInvalidError` (grant exists but `is_valid` is `False`) is a different
failure from `CredentialNotFoundError` (no grant row at all) — D18's distinction, and the
one the boundary needs to build the right connect affordance later. Do not collapse them
into one exception.

## The mode table, written out in full (do not abbreviate in code)

For **every** ref arm, the same three-way branch on `mode` (`secrets.md`, `entities.md`
§7.2):

| `mode` | behavior | on failure |
| --- | --- | --- |
| `PROJECT_ONLY` | look up the project-owned credential only; never consult `scope.user_id` | `CredentialNotFoundError(mode=PROJECT_ONLY, missing=PROJECT, target=...)` |
| `USER_REQUIRED` | look up `(project, scope.user_id)` only; **never** fall back to the project's | `CredentialNotFoundError(mode=USER_REQUIRED, missing=USER, target=...)` |
| `USER_OPTIONAL` | look up `(project, scope.user_id)`; if absent, look up the project's | `CredentialNotFoundError(mode=USER_OPTIONAL, missing=USER, target=...)` — names the **narrower** owner even though the project lookup was also tried |

For `BoundSecretRef` and `ProviderKeyRef` in this scope there is no `(project, user)`
lookup to perform yet — no owner column exists on a bound-secret or provider-key lookup
until user-owned secrets ship (`secrets.md`). So for these two ref arms all three modes
currently degrade to the same project-only lookup **behaviorally**, but the branch must
still be written for all three modes explicitly (not collapsed into a single code path)
so the day a user-owned vault row exists, only the per-arm lookup changes and the mode
dispatch does not move. This is D10's entire point, applied at the one seam that will
actually change: write the `if mode == CredentialMode.USER_REQUIRED: ...` branches now
even though today they read from a table with no user-owned rows.

For `GrantRef`, the owner axis is real today (`McpGrantDBA.user_id` is nullable and
populated from the first migration, §2.2) — this is the one ref arm where the three modes
already produce different observable behavior in wave 1.

## Contracts this package must honour

- **Never returns `None`.** Every failure path raises `CredentialNotFoundError` or
  `CredentialInvalidError`; a bare `return None` or silently constructing a
  `ResolvedCredential` with an empty secret is the exact failure `secrets.md` names as
  disallowed ("failure is never silent and never a fallback to 'no credential'").
- **`USER_REQUIRED` never falls back**, on any ref arm. A implementation that tries the
  project secret "just in case" after a `USER_REQUIRED` miss is a silent privilege
  escalation risk (an agent could act as the organization when it should have failed) —
  this is the one rule in this package most worth a dedicated test per ref arm.
- **The exceptions name which owner is missing**, not just that resolution failed —
  `missing=CredentialOwnerKind.USER` vs `.PROJECT` is what lets the boundary (later
  packages) build `needs_auth` for "you must connect" versus an administrator-facing
  message for "the project has no key." Getting this backwards silently degrades the UX
  without failing any test that only checks "an exception was raised."
- **`builtin`-namespace MCP targets never call `resolve()`.** If a future caller passes a
  `GrantRef` for a builtin endpoint, that is a caller bug (§4.4, D27) — `resolve()` has no
  way to detect this from the ref alone (a `GrantRef` only carries `endpoint_id`) and is
  not expected to; the namespace check is the caller's responsibility (WP9's service),
  not this package's.
- **Constructor takes `vault_service` and `mcp_grants_dao` by keyword**, matching the
  entrypoint wiring in `entities.md` §9: `CredentialResolver(vault_service=vault_service,
  mcp_grants_dao=mcp_grants_dao)`. This exact call is the only place this constructor's
  shape is written down in the design; treat it as authoritative.

## Tests

**Unit (no services running, run now).** This is the point of the spec's framing —
`resolve()` is pure orchestration over two ports, both trivially fakeable, so every case
below runs with a dict-backed fake `VaultService` and a dict-backed fake
`McpGrantsDAOInterface`, no Postgres, no encryption key:

`api/oss/tests/pytest/unit/gateways/test_gateways_resolution.py`

- `BoundSecretRef`, secret exists → `ResolvedCredential` with
  `owner.kind == PROJECT`, `origin == VAULT`.
- `BoundSecretRef`, secret does not exist (any mode) → `CredentialNotFoundError` with
  `missing == PROJECT`.
- `ProviderKeyRef`, a `provider_key`-kind secret matches → resolves it.
- `ProviderKeyRef`, no `provider_key`-kind match but a `custom_provider`-kind match
  exists → resolves the `custom_provider` one (fallback order).
- `ProviderKeyRef`, both kinds match the same provider → resolves the `provider_key`-kind
  one (priority order).
- `ProviderKeyRef`, no match of either kind → `CredentialNotFoundError` with
  `missing == PROJECT`.
- `GrantRef`, `mode=PROJECT_ONLY`, only a `user_id=None` grant exists → resolves it with
  `owner.kind == PROJECT`.
- `GrantRef`, `mode=PROJECT_ONLY`, only a `user_id=<scope.user_id>` grant exists (no
  project grant) → `CredentialNotFoundError` — **must not** fall through to the user's
  grant; this is the test that catches a `PROJECT_ONLY` implementation that accidentally
  behaves like `USER_OPTIONAL`.
- `GrantRef`, `mode=USER_REQUIRED`, only a project grant exists (no user grant) →
  `CredentialNotFoundError` with `missing == USER` — **must not** fall back to the
  project's, the single most important assertion in this suite.
- `GrantRef`, `mode=USER_REQUIRED`, a user grant exists → resolves it, `owner.kind ==
  USER`, `owner.user_id == scope.user_id`.
- `GrantRef`, `mode=USER_OPTIONAL`, both a user grant and a project grant exist →
  resolves the **user's**, never the project's.
- `GrantRef`, `mode=USER_OPTIONAL`, only a project grant exists → resolves it,
  `owner.kind == PROJECT`.
- `GrantRef`, `mode=USER_OPTIONAL`, neither exists → `CredentialNotFoundError` with
  `missing == USER` (the narrower owner, per the mode table above — not `PROJECT`, even
  though the project lookup was also attempted).
- `GrantRef`, a grant exists with `flags.is_valid == False` → `CredentialInvalidError`,
  regardless of mode, **before** any vault lookup is attempted (assert the fake
  `VaultService.get_secret_by_id` was never called in this case — the invalid-grant
  check must short-circuit).
- `GrantRef`, a grant exists and is valid but its `secret_id` resolves to nothing in the
  vault → `CredentialInvalidError` (the dangling-FK defensive case) — not
  `CredentialNotFoundError`, since a grant genuinely exists.
- Every `CredentialNotFoundError` raised across the cases above carries a `target` string
  that is non-empty and reproducible from the input `ref` (assert the format is stable,
  not just present).

**Integration:** none required for this package specifically — `VaultService` and
`McpGrantsDAOInterface` are both fully fake in the unit suite above, and there is no
direct database or Redis touch anywhere in `resolution.py`. If a reviewer wants one
end-to-end sanity check against a real `VaultService` + Postgres-backed grants DAO, it
belongs in a cross-package integration suite once WP1's DAO exists, not in this package's
own test file.

## `api/entrypoints/routers.py` diff (apply at the M1 merge)

```python
from oss.src.core.gateways.policy.resolution import CredentialResolver

credential_resolver = CredentialResolver(
    vault_service=vault_service, mcp_grants_dao=mcp_grants_dao,
)
```

(`entities.md` §9; depends on WP1's `mcp_grants_dao` construction landing in the same
merge — order WP1's DAO lines before this one.)

## Checkpoint

Feeds **M1**, then **Checkpoint A** through WP6 and WP8 (both call `resolve()` on the
relay path).

Exit condition, verbatim from `plan.md`: *"each resolution mode behaves as specified and
no path silently returns no secret."*

WP2 is done when: every case in the Tests section above passes; grep over
`resolution.py` confirms every `return` statement either returns a `ResolvedCredential`
or is unreachable, and every early-exit path is a `raise`; and a `USER_REQUIRED` lookup
with only a project-owned credential present raises rather than resolving, on both
`GrantRef` (has real behavior today) and by code-path inspection on the other two arms
(behaviorally inert today, but present).

## Out of scope

- `core/gateways/policy/service.py` (`GatewayPolicyService.authorize`, `.record`) — WP3.
- `McpGrantsDAO`'s implementation — WP1; WP2 only calls the interface.
- The OAuth client, token refresh, and anything that writes a grant row — WP17.
- `VaultService` itself and the two new secret kinds — WP16 adds the kinds; `services.py`
  is pre-existing and not touched.

## Missing from the design, needs a ruling

- **The tie-break when two secrets of the same kind match the same provider under
  `ProviderKeyRef`.** `entities.md` and the cited SDK precedent both leave this
  undefined (the precedent resolves it by list order via `VaultService.list_secrets`'s
  return order, which is not documented as stable). Not blocking — "first match in
  return order" is a reasonable default and matches existing client-side behavior — but
  it is not written down anywhere as a deliberate choice, and a future admin UI that lets
  a project hold two `provider_key` secrets for one provider would need this resolved
  properly rather than inherited by accident.
- **Whether `resolve()` should validate that a `GrantRef`'s `endpoint_id` actually names
  an MCP endpoint with `auth_mode == GatewayAuthScheme.OAUTH`.** Nothing in `entities.md`
  §7.2 asks for this check, and `resolve()` has no endpoint DAO dependency to perform it
  with (its constructor takes only `vault_service` and `mcp_grants_dao` — no
  `McpEndpointsDAOInterface`). Treated here as intentionally the caller's (WP9's)
  responsibility, consistent with the constructor signature `entities.md` §9 gives; flagged
  in case that omission was accidental rather than deliberate.
