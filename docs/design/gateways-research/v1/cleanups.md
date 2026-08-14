# Gateways: the cleanup list

Everything that becomes possible **once the gateways are running**, and cannot be done before.

This document exists because the design kept mistaking outcomes for prerequisites. `notes.md`
records two cases where the reasoning ran backwards and produced a plan that could not start. The
rule that came out of it: **when something in the current code looks like it must be fixed first,
check whether the new design is what makes the fix possible.** If it is, it belongs here.

Nothing on this list blocks any wave. Nothing on it is optional either — this is what "everything
transits a gateway" (D1) costs in full, stated once so the cost is not discovered piecemeal.

**Status: a register, not a plan.** Each entry says what it is, why it cannot happen sooner, and
what done looks like. Sequencing comes later.

---

## CU1. Close the plaintext secrets read surface

**What.** The vault's read routes return decrypted material to any caller holding the view
permission: both `GET /secrets/` and `GET /secrets/{id_or_slug}` return the full payload, and the
create and update responses echo it too. Provider keys, client secrets, webhook keys and custom
secret content all come back in the clear.

**Why not sooner.** Callers read that route because it is how they obtain a provider key at all.
Restricting it before they have another way simply breaks them.

**Done.** Nothing outside the gateway resolves a secret through it, and the route is restricted or
removed. Parallel bring-your-own-secrets work wants the same outcome, so ownership has to be
agreed rather than assumed. Tracked as OR14 in `open-reviews.md`.

## CU2. Remove module-level provider keys from the workflow handler — CLOSED

**What.** One handler assigns provider keys to module-level attributes on the routing library
before each call, rather than passing them per call. That is process-wide state; in a shared
process it is a cross-tenant secret leak.

**Why not sooner.** The pattern exists *because* nothing hands that handler a resolved
connection. Dependency injection through the gateway is what removes the reason for it.

**Done.** Nothing assigns to the library's module attributes. Note that the handler in question is
reported unused and may be deleted outright, which would close this without any work. Tracked as
OR13.

**Closed, and the "unused" premise was wrong.** `llm_v0` is mounted at `/llm/v0` in
`services/entrypoints/main.py` and registered under `agenta:builtin:llm:v0` — reachable, not dead
code. The code-side fix already landed separately (commit `50d6a2b3ed`, "per-entry llm_v0 keys"):
`_call_llm_with_fallback` no longer does `setattr(litellm, attr, key)` per family; it resolves
`provider_settings` per LLM entry through `SecretsManager.get_provider_settings_from_workflow` and
splats them into the per-call `acompletion(**kwargs)`. A repo-wide grep for
`litellm\.\w+_key\s*=`/`setattr(litellm, ...)` turns up nothing. Added two regression tests to
`test_llm_v0_provider_key_binding.py`: one asserting the fake litellm module gains no new
attributes across a call, one running two concurrent calls on different connections and asserting
neither call's key leaks into the other's kwargs.

## CU3. Route embeddings through the gateway

**What.** Two similarity evaluators call the OpenAI client directly, twice each, and hand-roll
their secret lookup by scanning the vault for a `provider_key` secret whose inner kind is
`openai`. They bypass the provider-settings builder entirely and hardcode the provider.

**Why not sooner.** They are evaluator paths, and the current scope is the gateways, agent v0, the
runner and the harnesses (D15). They also need a north-port route the chat surface does not
provide.

**Done.** Both callers reach an embeddings route on the gateway, and neither reads the vault.

## CU4. Convert every remaining service that resolves a secret itself

**What.** The general case behind item 3. Any service that fetches provider material and calls an
upstream directly is a bypass of the boundary, and each one is a place where "did every call get
checked" becomes "every call except those."

**Why not sooner.** D1 is the target and wave 1 to 3 is where it starts; other services come after
the callers in scope are converted.

**Done.** An inventory exists and is empty. Producing that inventory is itself work — the model
call sites took two passes to count correctly (`raw/model-call-sites.md`), and there is no reason
to think the tool side is easier.

## CU5. Move the eligible slice of the runner's tool loopback to the gateway

**What.** The runner synthesizes a loopback HTTP MCP server per run, because Claude Code and Codex
accept tools only over MCP while Pi receives them through a bundled extension. Calls relay back to
the runner, which applies private specs and callback auth server-side. On a remote sandbox the
loopback is unreachable, so a stdio shim is uploaded instead and tool calls become relay files a
runner-side loop polls.

**The eligible slice is narrow:** `callback` tools with no `contextBindings`, no `ephemeralArgs`,
and permission `allow`. Those are plain third-party tool calls and could address the gateway
directly — `builtin/composio/notion/my-notion` instead of harness → loopback → runner → the tool
API → the provider. Two hops removed, and the gateway applies the policy instead of the tool
router.

**What stays, and why it is not incidental.** `contextBindings` are executor-private argument
paths the runner fills from run context *after* the permission verdict, deliberately not
advertised to the model — per-run state a stateless gateway has neither. `ephemeralArgs` are
fields stripped so they reach the human and never the request. `client` tools pause the run and
relay to the caller, and permission `ask` raises human-in-the-loop approval through the runner's
own machinery. **The loopback is the runner's tool executor, not a transport**, and it shrinks
rather than disappears.

**Why not sooner.** It cannot begin before the runner addresses the gateway at all, and putting a
runner change inside the wave whose job is standing the gateways up would confuse two risks.

**Done.** The eligible slice is served by the gateway, the ineligible slice is still served by the
runner, and the boundary between them is written down rather than folklore.

## CU6. Collapse the wire's secret arrays — CLOSED

**What.** The runner's request carries per-server secret arrays for MCP and a secret array
for the model. If the gateway holds every upstream secret, those collapse to a single minted
token.

**Why not sooner.** They cannot collapse while anything still needs a real upstream secret
delivered to a sandbox.

**Closed, already an outcome of WP12/WP13/WP15.** Both arrays carry one gateway token on the
connected path: the model's `credentials` stays empty and its one token rides the separate
`gatewayCredentials` field (D36); each MCP server's `credentials` array holds exactly one entry,
`X-AG-Credentials`, regardless of how many named secret refs the author declared. Verified with a
new regression test proving the collapse holds across more than one server at once, not only the
single-server case the existing tests covered.

`local_use` survives, and the reason is narrow: `_resolve_from_secrets` (the connected `agenta`-
mode path) never emits it any more — `build_gateway_resolved_connection` returns `credentials: []`
for every deployment, bedrock and vertex included, so cloud-reseller signing has already moved
behind the gateway there. The category is still reachable from the two offline, standalone-SDK
resolvers (`EnvConnectionResolver`, `StaticConnectionResolver` in `connections/resolver.py`),
which exist for SDK usage with no Agenta backend and therefore no gateway to hold a reseller
secret for — the sandbox has nobody else's account to sign with, so the value has to be real.
`daytona-secret-plan.ts`'s allowlist already carries this exact reasoning inline. Tracked as OR6.

## CU7. Simplify the redaction deny-set

**What.** The runner builds a per-run deny-set from every secret value on the wire, so no
secret can reach a log.

**Why not sooner.** The complexity is proportional to the number of distinct secrets on the wire.

**Done.** Once item 6 leaves one short-lived token, the deny-set's construction is re-assessed
rather than inherited. Tracked as OR7.

## CU8. Widen the hard-coded provider couplings, together

**What.** Provider names are pinned in more places than a reader expects: the static model
catalogue and the two maps derived from it; two secret-kind enums naming providers; the harness
capability table's vault-provider set, subscription set, model aliases, and per-harness custom
deployment map; a provider-to-base-URL map; and a provider-kind alias map. The
provider-to-environment-variable map exists **twice**, once in the SDK and once mirrored by hand
in the runner's TypeScript.

**Why not sooner.** Widening them piecemeal produces a half-open system where a provider works in
one layer and not the next. Doing it once, after the gateway defines what a provider *is*, is
cheaper and verifiable.

**Done.** Adding a provider touches a declared set of places, and the two copies of the
environment-variable map either agree by construction or become one. Tracked as OR8.

## CU9. Converge the duplicated auth-scheme and connection-state definitions

**What.** The `oauth | api_key` scheme enum and the ready / needs-auth / needs-input state machine
each exist in three parallel copies across the catalog, tool and trigger domains, and the gateways
add a fourth inside their own boundary (D27's separate-domain layout).

**Why not sooner.** Those three domains are outside the current scope (D15), and importing the
gateways' vocabulary from one of them would couple a traffic boundary to an integrations domain
through the back door — worse than a fourth copy.

**Done.** All four resolve to one definition in the shared DTO module that already holds the
identifier, slug and header types. Tracked as OR4.

## CU10. Remove the legacy credits counter

**What.** A credits counter increments today whenever a caller checks access to platform-owned
secrets — once per access check rather than per usage. It measures nothing anybody wants.

**Why not sooner.** It is the only thing counting anything on that path.

**Done.** Removed, once the gateway is the sole mechanism the whole system uses (D24).

## CU11. Fix the callback path hardcoded to one consumer

**What.** The connections service builds its OAuth callback URL against the tool domain's mount,
`/tools/connections/callback`, although the trigger domain creates connections through the same
service. The comment explains it as preserving a public contract when the connection moved into
its own domain, which explains it without justifying inheriting it.

**Why not sooner.** Changing a registered redirect path is a coordinated change with whatever has
already registered it.

**Done.** The callback path is a property of the connections domain rather than of one consumer,
and a third consumer needs no new special case.

## CU12. Collapse the four copies of the outbound SSRF guard

**What.** The same guard — block private, loopback, link-local, reserved, multicast and
unspecified addresses, refuse plain `http`, resolve once and pin the literal IP — now exists four
times. In the API at `core/webhooks/utils.py`, whose three functions the gateways import (D28). In
the SDK at `agenta/sdk/utils/net.py`, whose own docstring says "unify these three if a clean shared
package ever spans API + SDK". In the SDK again, inline in the workflow handler as
`_validate_webhook_url`. And in TypeScript at `services/runner/src/tools/ssrf-guard.ts`, which
carries a hand-transcribed copy of Python's `ipaddress` special-registry tables and a comment
saying they once drifted apart.

**Why not sooner.** Two of the copies are in a different language and a third is in a package that
ships to users, so there is no import that spans them today. Collapsing the two Python ones is
possible now, and the gateway does not need it: it imports the API copy, exactly as EE's
organization service already does.

**Why the gateway makes it worth doing.** Until now each copy guarded one narrow path — a webhook,
an OIDC issuer, a custom provider base URL. The gateway makes this guard the single control on
every outbound call the platform makes on a tenant's behalf, so the copies stop being four small
risks and become one contract with four implementations that can disagree.

**Also on this item, and larger than the duplication:** `AGENTA_INSECURE_EGRESS_ALLOWED` defaults
to `true` and is set in no deployment configuration in this repo, so every copy is currently
inert. The default exists so zero-config self-hosting works, which is a real requirement; what is
missing is that a shared deployment turns it off. C1 verifies with it `false`, and
cloud setting it `false` is a deployment action rather than an assumption.

**Done.** One definition per language, with the range tables generated or tested against each
other rather than transcribed, and the flag explicitly `false` wherever more than one tenant
shares a deployment.

## CU13. Turn the insecure-egress default off wherever a deployment is shared

**What.** `AGENTA_INSECURE_EGRESS_ALLOWED` is set in no deployment configuration in this repo. Two
of its four copies — the API's `WebhooksConfig` (`api/oss/src/utils/env.py`) and the runner's
`insecureEgressAllowed()` (`services/runner/src/tools/ssrf-guard.ts`) — default unset to `true`
(permissive), so those copies of the outbound guard in CU12 are currently inert. The default
exists so zero-config self-hosting works, which is a real requirement; what is missing is that a
deployment serving more than one tenant turns it off. The other two copies default the other way;
CU14 covers that split.

**Why it is its own item and not part of CU12.** CU12 is duplication — four implementations of one
contract that can drift. This is posture: one flag, set nowhere, that leaves the API and runner
copies open. Collapsing the copies does not change it, and turning it off does not need the copies
collapsed. Bundling them would let the slower half hold the faster one.

**Why not sooner.** It was not wrong sooner — before the gateways, each copy guarded one narrow
path. The gateway makes this guard the single control on every outbound call the platform makes on
a tenant's behalf, which is what turns an inert flag from untidy into load-bearing.

**Done.** The flag is explicitly `false` in every configuration where more than one tenant shares a
deployment, and a test asserts the guard actually refuses a private address under that setting
rather than assuming it.

## CU14. Agree on one default for the insecure-egress flag, not four independent ones

**What.** `AGENTA_INSECURE_EGRESS_ALLOWED` means opposite things when unset, depending on which
copy of CU12's guard reads it:

| Copy | Default when unset |
|---|---|
| API — `WebhooksConfig` (`api/oss/src/utils/env.py`) | `true` (permissive) |
| Runner — `insecureEgressAllowed()` (`services/runner/src/tools/ssrf-guard.ts`) | `true` (permissive) |
| SDK — `agenta/sdk/utils/net.py` | `false` (secure) |
| SDK — `agenta/sdk/engines/running/handlers.py` | `false` (secure) |

A guard that is on in one layer and off in another for the identical unset env var is not a single
control with four implementations; it is two controls that happen to share a name. Nobody reading
any one copy would know the others disagree.

**Why not sooner.** CU12 collapsed the SDK's two copies into one Python definition and made the
runner's range table verifiable against the API's, but collapsing implementation is orthogonal to
agreeing on a default — the same reasoning CU13 gives for being its own item applies here.
CU13's own inventory recorded the flag as defaulting to `true` flatly, because it was written
looking at the API and the hosting configs, not at the SDK copies; this item exists because that
picture was incomplete.

**Done.** All four copies resolve `AGENTA_INSECURE_EGRESS_ALLOWED` unset to the same value, decided
once rather than inherited separately per copy, and the decision is recorded next to CU13's
per-deployment `false` setting so the two are read together.

---

## What is not on this list

**Anything that is genuinely a prerequisite.** If something must be true before a wave can start,
it belongs in `plan.md` as a work package, not here. The test is whether the gateway is what makes
it possible.

**Retries, model fallbacks and aliasing.** Never planned, not deferred — `scope-checklist.md`
records them as outside this work entirely.

**Usage recording and charging, and per-endpoint configuration.** Deferred rather than unlocked:
they are gateway work that ships after C3, and `plan.md` carries them.
