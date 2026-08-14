# Gateways: out of scope

Things this design deliberately does **not** build, with enough of the research kept that
picking one up later starts from an argument rather than a blank page. Distinct from
[`cleanups.md`](cleanups.md), which is repo debt this work touches, and from
[`scope-checklist.md`](scope-checklist.md), which sequences what *is* in scope.

---

## User-level secrets on either plane

**Out of scope.** Not deferred to a later wave — removed from the plan. Every gateway
secret is **project-owned**: one key or one consent per endpoint, held by the project, used
by everyone in it.

### What ships instead

Both planes say it the same way, in one column:

```python
llms_endpoints.secret_id  ->  secrets.id   # the provider key
mcps_endpoints.secret_id  ->  secrets.id   # the oauth_grant, or nothing
```

`secret_id` is nullable on both, because an endpoint with no secret is legitimate — a mock
(D23), an unauthenticated self-hosted server. Health rides with the endpoint:
`flags.is_valid` for a secret that stopped working, `status` for the last failure that
explains why. D18 holds unchanged — a dead secret does not hide the endpoint, its tools
stay listed, the call fails with a connect affordance.

### The extension is additive, and identical on both planes

The direct `secret_id` **is** the project-level answer. Adding user-level secrets does not
change it, replace it, or migrate it. It adds a table per plane whose rows point at the
endpoint and narrow the answer for one user:

```sql
CREATE TABLE llms_grants (          -- and mcps_grants, field for field
    project_id  uuid NOT NULL,
    id          uuid NOT NULL,
    endpoint_id uuid NOT NULL REFERENCES llms_endpoints (id) ON DELETE CASCADE,
    user_id     uuid NOT NULL,      -- NOT nullable: the project's answer is the column
    secret_id   uuid NOT NULL REFERENCES secrets (id) ON DELETE CASCADE,
    ...
);
CREATE UNIQUE INDEX uq_llms_grants_user ON llms_grants (project_id, endpoint_id, user_id);
```

Resolution then reads: *this user's grant if one exists, else the endpoint's `secret_id`*.
Nothing that exists today moves. An endpoint keeps working for everyone who has not
connected their own, which is the behaviour you want anyway — a per-user key should be an
upgrade for that user, never a new requirement for everybody.

`user_id` is **NOT NULL** there, and that is the point of putting the project's answer in
the endpoint column instead. One table holding both owners would need a nullable `user_id`,
and then two partial unique indexes to express "one grant per owner" — because SQL treats
every `NULL` as distinct, so a single unique index would let a project-owned row be inserted
twice. Splitting the two answers across the column and the table removes the nullable owner,
and with it the need for partial indexes at all.

**Both planes or neither.** The pressure that would add user-level secrets — a member using
their own OpenAI key, or their own consent to a tool server — arrives on both planes at
once, and the shape is the same either way. Building one and not the other is what would
make this expensive later.

### What survives, so reopening stays additive

The resolver's signature. `SecretsResolverInterface.resolve()` takes the full `AuthScope`
and a `SecretMode` — `PROJECT_ONLY`, `USER_REQUIRED`, `USER_OPTIONAL` — per D10, even
though only the project arm can answer today. That is the expensive thing to retrofit; the
modes are already written and already tested.

So reopening is: two tables, the user arm of `USER_REQUIRED` / `USER_OPTIONAL` wired to
them, and a connect flow that mints per-user consent. No data migration. No signature
change. No change to either endpoint table.

**What would justify it:** a customer whose compliance rules forbid sharing one consent
across a workspace, or a server whose tokens carry per-user identity the tools actually
read — a "who am I" call answering differently per member. Neither is worth building for in
advance; both are unmistakable the moment they arrive.

## Upstreams a relay-only gateway cannot reach

One exclusion from WP24's per-provider verification (OD16), recorded so it is not rediscovered as a
bug. It is unreachable for a stated reason rather than merely unbuilt.

**SageMaker.** Its invoke API has no platform-level request schema: AWS forwards opaque bytes to
whatever container the customer deployed. There is no "SageMaker wire" to check a front door
against, so the answer is per-deployment rather than a fact this design can pin. `select_upstream`
raises, naming that it has no fixed protocol rather than naming one it needs. Every other model
provider OD16 examined is reachable through one door or another.

Bedrock's legacy `InvokeModel` path and Vertex's Claude `rawPredict` path were listed here and are
**no longer out of scope**: D40 carves out a static, named field rewrite for exactly these two, and
WP27 implements it. Both also have wired alternatives that need no rewrite at all — Bedrock through
its newer `bedrock-mantle` endpoint with a plain bearer key, Vertex through its OpenAI-compatible
layer — so neither vendor was ever unreachable; one path per vendor was.
