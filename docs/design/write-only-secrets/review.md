# Review: write-only vault secrets

This review covers the write-only and managed-secret stack: [#6164](https://github.com/Agenta-AI/agenta/pull/6164) defines write-only secrets, [#6165](https://github.com/Agenta-AI/agenta/pull/6165) defines managed secrets, [#6138](https://github.com/Agenta-AI/agenta/pull/6138) creates the first managed secret, [#6174](https://github.com/Agenta-AI/agenta/pull/6174) is the frontend consumer, and [#6195](https://github.com/Agenta-AI/agenta/pull/6195) is the provider-probe consumer.

Status: resolved. Every required change in this review is implemented. The five PRs form one release chain rooted in `release/v0.114.0`: #6164, #6165, #6138, #6195, then #6174. Each PR uses the preceding branch as its immediate GitHub base, and backend plus frontend deploy together.

## Owner decisions

These are settled decisions for this review:

- Restore the Vault list cache. Batch evaluations, completion services, chat services, and agent resolution can list secrets repeatedly. Removing the shared cache adds latency and unnecessary database load.
- Keep the existing cache-key UUID packing unchanged. Do not add a generation to the key and do not change the 12-character project/user segments in this PR.
- Cache the canonical plaintext DTO in trusted Redis, then apply caller-specific redaction after reading it. Never cache a caller-specific redacted response.
- Redis is inside the trusted backend boundary, so storing the encrypted-at-rest secret's decrypted runtime representation in this cache is accepted.
- A secret's `write_only` policy is selected when the secret is created and is immutable afterward. An update must not turn an old readable secret into a write-only secret, or the reverse.
- Keep the standalone SDK environment fallback. A redacted Vault value may still be supplied locally through the matching provider-specific environment variable.
- Keep the signed, short-lived runtime grant as the first implementation. Do not add issuer, subject, audience, or per-secret resource claims now.
- Use only `AGENTA_SERVICES_INTERNAL_KEY` to prove the internal service hop. Remove the fallback to `AGENTA_AUTH_KEY` and update every deployment example and document that configures the services/API pair.
- SSO and webhook secrets remain readable. Set `write_only=False` explicitly at their creation call sites.
- Keep `write_only` in the existing encrypted JSON payload for now. This review requires no database migration.
- Replace key-specific response metadata with a general value-status model, and keep persistence mechanics out of the DAO.
- Keep the internal manager identity separate from the public management policy. Do not make frontend behavior depend on a backend component-name string.
- Do not use an `allow_managed` boolean as an ownership credential. The current bridge never updates, releases, or deletes its row, so no bypass is needed in this release.
- Keep management and value visibility independent. Starter credits explicitly chooses both `management.policy=manager_only` and `write_only=True`; one must not be derived from the other.

## Required changes

### 1. Finalize the API model and regenerate Fern

At review time, the backend contract was represented manually in #6174. Its frontend type intersected the generated `SecretResponseDto` with handwritten `write_only`, `managed_by`, `has_key`, and `key_preview` fields, and separately made provider keys optional. That proved the generated client does not yet contain the contract the frontend consumes.

Requested change:

1. Finalize the backend DTO names and shapes described below.
2. Generate the final Fern clients from the combined OpenAPI contract in #6174.
3. Consume those generated types directly in #6174.
4. Remove the handwritten response intersection, key-optional intersection, and related casts from #6174.
5. Update backend OpenAPI/contract tests so a later generation cannot silently lose these fields.

The backend DTOs and OpenAPI define the wire contract. #6174 generates the final Python and TypeScript clients from the combined stack and consumes those generated types without a handwritten copy.

### 2. Restore the Vault list cache without changing its key scheme

Restore `get_cache`/`set_cache` for Vault list results, using the existing namespace, TTL, mutation invalidation, and cache-key packing.

The correct flow is:

```text
list request
  -> load canonical SecretResponseDTO list from Redis, or load it from the DAO and cache it
  -> inspect the verified caller grant
  -> return plaintext DTOs to an authorized runtime, or redact them for an ordinary caller
```

This order matters. If an ordinary caller's redacted list is cached, a runtime may be unable to resolve its secrets. If a runtime's plaintext list is returned directly from the cache without the response-boundary check, an ordinary caller may receive plaintext. The shared entry must therefore be canonical and the caller projection must always happen after the cache read.

Continue invalidating the list namespace after create, update, and delete. Do not add a cache generation, a second redacted cache, or request coalescing in this PR.

#### Why the cache currently shortens UUIDs

The 12-character packing was introduced when the shared cache helper was generalized to support optional project/user scopes and wildcard invalidation. It creates short, fixed-width `p:...:u:...` key segments, which makes keys and scan patterns compact and predictable. The introducing change does not document why the UUID suffix was chosen instead of the full UUID, so there is no confirmed stronger rationale to cite.

That uncertainty is not a reason to change a platform-wide cache convention inside this feature. Keep the current packing. Its theoretical collision concern is separate from write-only secrets and remains outside this PR.

### 3. Make `write_only` a creation-time policy

The reviewed false-to-true update path had to be removed. It is surprising for a normal secret update to change whether an existing value can ever be read again, and it creates a security-sensitive cache transition that would need stronger invalidation coordination.

Requested behavior:

- Create accepts or derives `write_only`.
- Update does not expose `write_only` as mutable state. If compatibility requires accepting the field temporarily, reject any value different from the stored value.
- Existing records without the stored field continue to resolve as `write_only=False`.
- To change the policy, the caller deletes and recreates the secret.

This also means a late cache refill cannot convert a newly write-only record back into a readable cached view, because readable-to-write-only conversion no longer exists. Ordinary key replacement keeps the cache's existing TTL/invalidation semantics.

### 4. Keep SSO and webhook behavior unchanged

Webhook creation already explicitly sets `write_only=False`. Keep that behavior.

At review time, SSO relied on the default rather than stating the policy. Set `write_only=False` explicitly on every SSO `CreateSecretDTO` call path, including create-on-edit paths if present.

This is important because the current SSO settings form reads the stored `client_secret` to prefill and validate edits. If SSO became write-only, the outward response would omit `client_secret`, and editing unrelated SSO fields would require the administrator to re-enter it. That would be a regression introduced by applying write-only behavior to SSO, not an existing SSO bug.

With explicit `write_only=False`, there is no SSO UX change in this feature:

- the settings API still returns `client_secret` as it does today;
- the edit form can still prefill it;
- testing and login continue to receive the plaintext value;
- no SSO frontend workaround is required.

Add a regression test proving that SSO remains readable even if the ordinary Vault-secret default is write-only. Keep the equivalent explicit-policy test for webhooks.

### 5. Require a dedicated internal-service key

`X-Agenta-Runtime-Key` is acceptable for the internal proof because the normal `Authorization` header is already carrying the end user's credential. The important boundary is the credential behind the header, not the spelling of the header.

Requested change:

- Read the proof only from `AGENTA_SERVICES_INTERNAL_KEY` through the shared API environment configuration.
- Remove the `AGENTA_AUTH_KEY` fallback.
- Keep constant-time comparison and reject known placeholder values.
- Make missing or placeholder configuration fail clearly before write-only runtime traffic is served. Since this feature is not gated, a warning that permits a predictably broken production deployment is insufficient.
- Give the same value only to the API and trusted services that perform the exchange. Do not give it to runners or sandboxes.
- Update Docker Compose variants, Helm values/templates, Railway configuration, example env files, deployment documentation, design documentation, validation messages, and tests.

The service exchanges the user's already-authorized credential and adds the runtime grant. The internal key proves that this exchange was requested by an Agenta service; it is not user authentication and it must not be a reusable general admin credential.

### 6. Keep the resolver grant simple, but name and validate it centrally

The short-term model can remain one project-wide capability: a verified, short-lived Secret token carrying the Vault-resolution grant may resolve all secrets in that token's project.

Requested cleanup:

- Define the grant name once in the authentication/authorization owner module.
- Validate grants against an explicit allowlist when tokens are created and consumed.
- Check the exact grant at the Vault response boundary.
- Document that a grant is additive and project-scoped. It does not replace project authorization.
- Preserve the grant only when refreshing an already verified token that already carries it.

Do not add `iss`, `sub`, `aud`, or a general capability framework now. Those claims are useful when tokens cross more trust boundaries, have several issuers, or target several services, but they do not solve an immediate problem in this first version.

For future per-secret permissions, extend the same concept with an action and resource scope rather than creating a new header per permission. For example:

```json
{
  "grants": ["secrets:resolve"],
  "secret_scope": ["secret-id-1", "secret-id-2"]
}
```

This release does not need `secret_scope`. This shape records the direction so the project-wide grant does not become an accidental permanent contract.

### 7. Keep the standalone environment fallback

Do not remove the resolver fallback from a redacted Agenta connection to a locally supplied provider credential. This is the intended standalone/self-hosted escape hatch: the control-plane record can still provide non-secret configuration while the process supplies the secret locally.

Keep the fallback narrow:

- OpenAI reads an OpenAI credential, Anthropic reads an Anthropic credential, and so on.
- AWS requires its complete credential combination.
- Azure and Vertex retain their provider-specific requirements.
- A missing matching environment credential fails with a clear message.
- Logs must not contain the secret name or value.

Add or retain tests for each supported fallback family and document the behavior in SDK examples. Do not silently borrow another provider's environment variable.

### 8. Generalize the public secret-status model

`has_key` and `key_preview` expose one provider-key implementation through a model that also represents custom text, JSON credentials, SSO, webhooks, and future secret kinds. Replace them with value-oriented metadata:

```python
class SecretValueStatus(BaseModel):
    configured: bool
    preview: str | None = None


class PublicSecretResponseDTO(BaseModel):
    # identity, kind, timestamps, non-secret configuration, etc.
    write_only: bool
    value_status: SecretValueStatus
```

Semantics:

- `configured` means credential material exists for that secret kind.
- `preview` is optional and is returned only when the kind and policy allow a safe preview.
- `preview=None` does not mean unconfigured. Callers use `configured` for that decision.
- The same structure works for provider keys, named custom secrets, compound credentials, and later secret kinds.

Separate DTOs by role:

- `CreateSecretDTO`: requires the value appropriate for the selected kind and accepts the creation-time `write_only` policy.
- `UpdateSecretDTO`: value is optional; omission means keep the stored value. It does not mutate `write_only`.
- `SecretResponseDTO` or `ResolvedSecretDTO`: trusted internal representation with plaintext credential fields.
- `PublicSecretResponseDTO`: caller-facing representation after grant-aware redaction, with `value_status` and no plaintext for a write-only secret.

Avoid using `VALUE_REQUIRED: ClassVar` switches to make one inheritance tree serve incompatible create, update, internal-read, and public-response roles.

For updates, preserve the distinction between omission and an explicitly supplied empty value:

- omitted value: keep the stored value;
- `""` for a provider credential: supplied but invalid, so reject it;
- `{}` for JSON content: explicitly supplied empty object, subject to that secret kind's validation;
- empty custom text: accept or reject according to the custom-secret product rule, not because the transport confused it with omission.

This is an API and in-memory model cleanup only. Continue storing `write_only` in the encrypted JSON data. Existing rows without it map to `False`; no database migration is required.

### 9. Keep transaction mechanics in the DAO and policy in the service

The DAO should keep the row lock because an update must resolve against the current stored record atomically. It should not know the meaning of `write_only`, parse policy fields from JSON, raise write-only domain exceptions, or mutate the request DTO through a callback.

Replace a mutation callback such as:

```python
resolve_update(current_secret)  # mutates the caller's update DTO
```

with a pure resolver contract such as:

```python
resolved_update = resolve_update(current_secret, requested_update)
```

Responsibilities should be:

- DAO: validate tenant/project scope, lock and load the row, map it to the internal DTO, invoke the resolver, persist the returned update, and commit.
- Service/domain resolver: enforce immutable `write_only`, carry stored values on omission, require a new credential when identity/kind changes, prevent credential extras from crossing identities, and return a validated `UpdateSecretDTO`.
- Mapper/redaction layer: translate encrypted JSON to the internal model and translate that model to the caller-facing projection.

This keeps the transaction safe without coupling persistence code to one secret policy. It also makes the update rules unit-testable without a database.

### 10. Close the provider-probe managed-secret hole in #6195

At review time, #6195 allowed `/providers/probe` to load plaintext by `secret_id` and combine it with caller-supplied provider configuration, while the probe path did not apply the managed-secret guard.

As a result, a caller could ask the backend to send a managed credential to a caller-selected endpoint. The credential is not returned in the HTTP response, but it leaves the intended provider boundary. That defeats the purpose of making the managed record immutable.

Requested short fix: reject `secret_id` probing when the loaded internal secret has a `management` owner. Keep ordinary user-owned secret probing unchanged. Add a test proving a managed secret cannot be probed against an overridden URL.

### 11. Split internal ownership from the public managed-secret contract

At review time, #6165 put `managed_by: str | None` on `CreateSecretDTO`, `UpdateSecretDTO`, and `SecretResponseDTO`. The public routes then accepted the field structurally and rejected it at runtime. #6174 copied the same internal component string into `LlmProvider.managedBy` and used its truthiness to decide whether the row appears in Settings.

This mixes three different concerns:

- an internal identity: which Agenta component owns the row;
- a public capability: whether the user may edit or delete the row;
- frontend presentation: whether the row is shown, locked, or hidden.

The manager needs a real data model, not only a string marker or a public boolean. Requested short-term internal and storage model:

```python
class SecretManager(str, Enum):
    STARTER_CREDITS_BRIDGE = "starter-credits-bridge"


class SecretManagementPolicy(str, Enum):
    MANAGER_ONLY = "manager_only"


class SecretManagementDTO(BaseModel):
    manager: SecretManager
    policy: SecretManagementPolicy = SecretManagementPolicy.MANAGER_ONLY
```

Keep the existing encrypted JSON representation for storage:

```json
{
  "management": {
    "manager": "starter-credits-bridge",
    "policy": "manager_only"
  }
}
```

This requires no database migration because the object still lives in the existing encrypted JSON column. Existing rows have no `management` object and therefore remain unmanaged.

The fields deliberately answer different questions:

- `manager`: which trusted Agenta component owns the row's lifecycle;
- `policy`: what management means for user mutation;
- `write_only`: whether an ordinary caller can read the stored value;
- runtime grants: which authenticated runtime can resolve plaintext.

Do not infer the latter three from the manager's string. A new manager can use the same policy, and a future policy can be introduced without teaching every consumer about every manager.

The public Fern response should expose policy, but not the internal component identity:

```python
class PublicSecretManagementDTO(BaseModel):
    policy: SecretManagementPolicy


class PublicSecretResponseDTO(BaseModel):
    management: PublicSecretManagementDTO | None = None
```

The frontend can now act on the supported policy without knowing who implements it:

```typescript
if (secret.management?.policy === "manager_only") {
    // render the chosen managed-row UX
}
```

If product needs to display an owner later, add a separate user-facing owner such as `owner: "agenta"`; do not expose `starter-credits-bridge`. It is an implementation identifier, not product copy.

Because these PRs have not shipped, write the final `management` object directly. A temporary mapper fallback from the branch-only `managed_by` string is unnecessary unless a deployed preview contains durable rows that must be retained.

### 12. Remove server-controlled fields from public create and update DTOs

`managed_by` is not user input, so it should not be present in the DTO used by public Vault routes. Rejecting it in `_refuse_client_managed_by` is safe at runtime, but the OpenAPI and generated client still advertise a field clients are never permitted to use.

Requested change:

- Remove `managed_by` from the public `CreateSecretDTO` and `UpdateSecretDTO`.
- Remove the empty-string-means-clear convention from `UpdateSecretDTO` and delete `resolve_managed_by` from the general update mapper.
- Add an internal service command for creation, for example:

```python
await vault_service.create_managed_secret(
    project_id=project_id,
    create_secret_dto=create_secret_dto,
    management=SecretManagementDTO(
        manager=SecretManager.STARTER_CREDITS_BRIDGE,
        policy=SecretManagementPolicy.MANAGER_ONLY,
    ),
)
```

`create_managed_secret` sets the trusted internal `management` object. It must not derive `write_only` from management. The caller chooses value visibility explicitly at creation, and the public create path has no way to claim management.

There is no current consumer that needs to add, change, clear, update, or delete management after creation. Do not ship speculative set/clear behavior through the general update DTO. If a real owner lifecycle is added later, give it explicit operations such as `update_managed_secret`, `release_managed_secret`, or `delete_managed_secret`, with a typed manager identity and tests for that workflow.

### 13. Remove the universal `allow_managed` bypass

#6165 adds `allow_managed: bool = False` to update and delete. Passing `True` permits full access to every managed row, regardless of which component owns it. It therefore means "bypass all management," not "the owning component is acting." The name and documentation overstate the security property.

The starter-credits bridge in #6138 creates its row once and never updates, releases, or deletes it. The bypass has no production consumer in this release.

Requested change now:

- Remove `allow_managed` from the general update and delete methods.
- Reject updates and deletes of a managed row for every caller of those general methods.
- Remove tests for setting/clearing the marker, owner re-credentialing, and owner deletion through `allow_managed=True`.
- Keep tests proving that a managed row is immutable through every public and general service path.

When a real owner operation is needed later, take a typed `manager: SecretManager`, compare it with the stored manager on the locked row, and expose only the operation that owner needs. A boolean bypass should not return.

### 14. Enforce the managed guard against the locked row

At review time, the update flow read the row in `VaultService`, checked `managed_by`, and only afterward asked the DAO to acquire `SELECT ... FOR UPDATE`. The resolver executed under the DAO lock handled credential carry-over but did not repeat the managed check. A row could therefore change between the ownership check and the write.

Delete had the same check-then-act shape: the service read and checked, then the DAO opened a separate transaction and deleted without locking and rechecking the policy.

Even if the first bridge never changes its marker, the implementation and tests claim a general ownership invariant. That invariant must be true at the persistence boundary.

Requested change:

- For update, use the pure locked-row resolver from section 9. It receives the current `SecretResponseDTO`, rejects a managed row, resolves carry-over and identity rules, and returns the complete `UpdateSecretDTO` that the DAO persists.
- For delete, select the row with `FOR UPDATE`, invoke a service-owned delete authorizer against that current DTO, then delete in the same transaction.
- The DAO remains unaware of what "managed" means. It provides the lock and invokes the supplied resolver/authorizer; domain code decides whether the operation is allowed.
- Add concurrency-oriented tests proving a user update or delete cannot pass a stale unmanaged check and then mutate a managed row.

The same locked-row structure can later compare a typed owner for an explicit internal owner operation without adding a second race-prone path.

### 15. Update #6138 to use the managed-secret boundary, not its storage DTO

#6138 initially constructed the general `CreateSecretDTO` with both `managed_by=ORIGIN_MARKER` and `write_only=True`. It also used the same `ORIGIN_MARKER` value for three semantic roles: proxy audit metadata, Vault manager identity, and the user-facing header description.

Requested change:

- Call `create_managed_secret(..., management=SecretManagementDTO(manager=SecretManager.STARTER_CREDITS_BRIDGE, policy=SecretManagementPolicy.MANAGER_ONLY))`.
- Keep `write_only=True` explicit in #6138 because the starter-credit credential must not be returned to users.
- Remove the generic “managed implies write-only” rule from #6165. Ownership/mutation policy and value visibility are separate contracts.
- Keep a separately named proxy-origin constant for LiteLLM metadata, even if its serialized value is currently the same.
- Use human-facing copy for `header.description`, not an internal component identifier.
- Type `_create_row` as `SecretResponseDTO` instead of `Any`.
- Keep `_platform_runtime_key_configured()` as a defense before minting, but make sure `env.agenta.services_internal_key` no longer inherits `AGENTA_AUTH_KEY` from the environment model.

The Vault list cache also has an internal writer now. Cache invalidation should live at the Vault mutation boundary, not only in HTTP routers. Move list invalidation into the create/update/delete service operation, remove duplicate route invalidations, and verify that #6138's internal managed create invalidates the same namespace. Otherwise the newly seeded connection may remain invisible to a previously cached list until the TTL expires.

### 16. Make the managed-secret UX decision explicit

At review time, #6138 described the seeded connection as visible in Settings while #6174 filtered every `managedBy` row out of the Settings table. The final code keeps it in the shared connection atom so model selection and run gating can use it.

This is a documentation/UX inconsistency, not a reason to expose the internal manager string. Pick the intended presentation and make the PR description, design document, and frontend test agree:

- if hidden, test that it is absent only from the Settings table but remains available to model resolution and key-status checks;
- if visible, render it with a general managed/locked affordance and no edit/delete actions.

In both cases, branch on the generated public `management.policy`. Do not branch on `managed_by` or `"starter-credits-bridge"`.

## Accepted security boundary

The runtime grant, not `AGENTA_SERVICES_INTERNAL_KEY`, can reach the runner. The internal key exists only on the trusted API/services hop and must never be forwarded. A short-lived granted Secret JWT is forwarded because the runner must call the Vault to execute the user's workload.

That means a runner trusted to execute a workload can resolve the project's secrets. This is accepted for the first version and matches the feature's stated trust model: write-only prevents casual API/UI reads; it does not claim to protect a secret from the workload authorized to use it. Per-secret runner scope is a future tightening, not a blocker for this PR.

## Final documentation and test contract

The README and PR descriptions describe this final production behavior:

- base is `release/v0.114.0`;
- no feature flag or later gate flip;
- Vault list cache is restored and redaction happens after canonical cache retrieval;
- `write_only` is creation-time and immutable;
- SSO and webhook explicitly use `write_only=False`;
- dedicated `AGENTA_SERVICES_INTERNAL_KEY` is mandatory and has no admin-key fallback;
- standalone provider environment fallback is supported;
- final `value_status` response model replaces `has_key`/`key_preview`;
- public `management.policy` replaces the exposed internal `managed_by` identifier;
- public create/update DTOs do not advertise server-controlled management fields;
- managed creation uses an internal typed manager command and general mutations have no boolean bypass;
- managed update/delete checks run against the row locked in the mutation transaction;
- Fern is regenerated and the frontend consumes generated types;
- runtime trust and future per-secret scope are documented accurately.

The final stack tests cover:

- cached plaintext returned to a granted runtime and redacted to a normal caller from the same cache entry;
- cache miss and cache hit produce the same public response;
- create/update/delete invalidate the list cache;
- `write_only` cannot change after creation;
- existing records without the stored field remain readable;
- SSO and webhook remain readable regardless of the ordinary-secret default;
- missing/placeholder `AGENTA_SERVICES_INTERNAL_KEY` cannot mint a runtime grant;
- `AGENTA_AUTH_KEY` is not accepted as the runtime proof;
- grant preservation only from an already verified granted token;
- standalone provider-specific fallback behavior;
- managed secrets cannot be used through the provider probe;
- public callers cannot set, clear, update, or delete management state;
- a managed row cannot be changed through a stale pre-lock update/delete check;
- the starter-credits bridge creates a typed managed, write-only row and invalidates the Vault list cache;
- the chosen hidden-or-visible managed-row UX does not remove the connection from runtime/model resolution;
- generated frontend types compile without handwritten contract augmentation.

## Merge assessment

The required architecture changes are incorporated. The later contract audit also found and fixed the Python SDK consumers that still read `has_key`. The SDK now reads `value_status` exclusively, and the co-released frontend omits untouched credential fields while the backend continues to reject explicit blanks.

No database migration, cache-generation scheme, full-UUID cache-key rewrite, general token-claims framework, removal of standalone fallback, or SSO frontend rewrite is requested in this review.
