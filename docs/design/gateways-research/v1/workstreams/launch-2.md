# Wave 2 launch — to C2

Wave 1 built the gateways. Wave 2 makes them the only way out. Nothing new is designed
here: the packages are the ones `plan.md` names, and this document is what each worktree
needs to start without reading the whole of `v1/`.

**C2 is "everything except OAuth works."** Agent v0, the runner and the harnesses
reach models and MCP servers only through the gateways; every call leaves an audit event;
no provider secret exists inside a sandbox.

---

## What wave 1 left standing, and what changed under it

Read these before planning a package — all four postdate `plan.md`'s wave-2 outline and
all four change what a caller sends.

- **The namespaces are `builtin` / `standard` / `custom` (D30).** A gateway route is
  `/gateways/{plane}/{namespace}/...`, and `builtin` carries a provider segment:
  `builtin/agenta/tools`, `builtin/composio/notion/my-notion`, `standard/openai`,
  `custom/{slug}`. A caller that hard-codes a namespace list has three words to get right,
  not four.
- **The inbound credentials ride `X-AG-Credentials` (D31).** `Authorization` still works
  and is what every existing caller uses. The dedicated header exists so a harness can keep
  its own vendor auth in `Authorization`, and it is the header wave 2's callers should send.
- **The endpoint document is `route` / `models`|`tools` / `settings`.** Only relevant to a
  caller that creates endpoints — WP14 and the fixtures, not the runner.
- **The mock upstreams are reachable and dialable.** `builtin/agenta/tools` is wave 1's one
  reachable builtin MCP target; `custom/{slug}` against `mock-llm-gateway` is the model
  equivalent. Every wave-2 acceptance test can run without a third-party account.

---

## Still on paper, and where each piece goes

Nothing in this list is built. Each line is either a package below or an owner it does not
have yet — no third category.

| Decided | State | Lands in |
| --- | --- | --- |
| D33 — protocol front doors | not built; one door exists | **WP23** |
| D34 — no body conversion | **not enforced**; `TranslatedLLMAdapter` still converts | **WP24** |
| OD16 — which upstreams a relay-only gateway reaches | not verified | **WP24**, first task |
| `provider_key` `NOT NULL` | unchanged | **WP24**, with the migration |
| OD14 — the harness matrix | not run | **WP13**, phase 0 |
| OD17 — which MCP servers a stateless relay reaches | not verified | **WP15**, phase 0 |
| Mock upstreams echoing headers | not built | **the seed** (D39) |

D31's data-plane rule and D32's pass-through mechanics are built and tested; they are not
in this table because there is nothing left of them to do.

## The one gap that reshapes this wave

**A model call cannot carry our credentials in a header today.** The runner wire's
`ModelCredentialBinding.kind` is `"environment"` and nothing else
(`services/runner/src/protocol.ts`), and the SDK agrees —
`EnvironmentCredentialBinding.kind` is `Literal["environment"]`
(`sdks/python/agenta/sdk/agents/connections/models.py`). So a model connection can say
"put this value in `OPENAI_API_KEY`" and cannot say "put this value in
`X-AG-Credentials`".

The MCP side already can: `McpCredential.binding` is `{kind: "header", name}`, which is
exactly the shape needed, and it is the precedent to copy rather than invent.

This is not a blocker and it is not small. It means **WP13 carries a wire change**, not
only a resolver change as `plan.md` assumed, and the change is symmetric with an existing
field rather than novel. Two consequences worth deciding before the package starts:

1. Whether the header binding is a new `kind` on `ModelCredentialBinding` (matching
   `McpCredentialBinding`) or a separate secret-headers channel on `ModelConnection`.
   The former is smaller and already has a precedent one interface away.
2. What each harness does with it. A header binding is only useful if the runner can write
   it into that harness's configuration — Claude Code, OpenCode and Codex each expose a
   custom-header mechanism, and each needs verifying against the release in use (OD14).

**The wire is already ahead of us on one thing.** `ModelConnection.credentialMode` has
`"runtime_provided"` — "the harness authenticates with its own login and we inject
nothing" — which is D32's subscription pass-through, modelled before the decision named it.
Wave 2 does not build pass-through, but it should not regress the field either.

**One validator will bite in development.** `ResolvedConnection` requires an `https`
`endpoint.base_url` whenever a resolved secret is `opaque_http`. A local gateway on `http://`
fails that check. Decide deliberately whether the loopback case is exempted or whether dev
runs over TLS; do not discover it in an acceptance test.

---

## Before anything starts

Wave 1's seed was a new domain's declarations. Wave 2's is smaller and has the same
property: **it changes a signature that several worktrees inherit, so it cannot be written
inside one of them.** One agent writes it on the base branch and everything else waits.

- [x] **Base branch from the current upstream release branch**, as in wave 1. Re-read the
      branch name; it advances. — `release/v0.112.1` merged into `feat/gateways`.
- [x] **The four rulings below are settled.** Each changed a shape more than one package
      depends on, so none could be deferred into a worktree.
- [x] **Write the gateway-credentials field** (D36) on the runner wire
      (`services/runner/src/protocol.ts`) and in the SDK
      (`sdks/python/agenta/sdk/agents/connections/models.py`), with its validator and its
      materialization. Declarations only; no caller changes.
- [x] **Exempt loopback from the https requirement** (D37), as an explicit branch in
      `ResolvedConnection`'s validator with the reason written on it.
- [x] **Add the header echo to both mock upstreams** (D39): one endpoint returning the
      headers of the request it received, in `core/gateways/{llms,mcps}/providers/mock/app.py`.
- [x] **Verify**: the credentials field round-trips SDK → wire → runner and is materialized,
      with a test that fails if any leg drops it. This is the specific failure the shape
      invites, so it is the specific test the seed owes.
- [x] **Commit, and record the SHA.** Every wave-2 worktree branches from it.

**The seed is `643c76bda2` on `feat/gateways`.** What it gives a package, concretely:

- `ResolvedConnection.gateway_credentials` (SDK) and `ModelConnection.gatewayCredentials`
  (wire), each `{header, value}` with `X-AG-Credentials` as the header default. The value is
  masked from every dump and repr.
- `ResolvedConnection.plaintext_headers()` and the runner's `materializeGatewayHeaders()` —
  the header counterparts of `plaintext_environment()`. A harness-config writer reads exactly
  one of them for the header it must set.
- The loopback exemption on **both** sides, applied to the provider secret as well as to the
  gateway credentials. It is loopback only: a compose-internal hostname over plain http is
  still refused, so a dev gateway a package reaches by service name needs TLS or a loopback
  route. Do not widen the check inside a package; it is a shared shape.
- The value seeds the runner's redaction deny-set, so it cannot be echoed back out of a run.
- `POST /__echo/v1/chat/completions` on the mock LLM upstream and `POST /__echo` on the mock
  MCP one, both returning the headers they received. Reachable **through** the gateway by
  pointing an endpoint's `base_url` at `/__echo`, which is what makes the `X-AG-Credentials`
  and pass-through assertions acceptance-level rather than unit-level.
- The shared golden `model_connection.gateway.json`, asserted from both legs
  (`test_gateway_credentials.py`, `gateway-credentials.test.ts`). A package that changes the
  field changes the golden and both tests, deliberately.

### D36 — SETTLED: our credentials are their own field, not a widened binding

`ResolvedCredential.binding` stays `EnvironmentCredentialBinding`. The gateway's credentials
travel as a distinct field on `ResolvedConnection` and on `ModelConnection`, carrying the
header name and the value.

**Why not widen the union.** `ResolvedConnection.plaintext_environment()` is the single
materialization point and every consumer calls it (`agents/interfaces.py`). A header-bound
credential has no environment variable, so widening the union without moving materialization
gives a value that validates, serializes, crosses the wire and **vanishes at the boundary** —
the same silent-drop class as a field a model ignores because it does not recognise it.

**Why a separate field is the honest shape.** These are our credentials, not an upstream's
secret, and the two are not interchangeable — one authenticates the caller into the gateway,
the other authenticates the gateway to a provider. `credentials` keeps meaning "the
provider's secrets"; the new field means "how the harness proves it is us". A harness
configuration writer then reads exactly one place for the header it must set.

**What the seed owes.** The field on both sides, its validator, and a test that fails if any
leg of SDK → wire → runner drops it. `credentialMode` keeps its three values and its
meaning; nothing about the provider's secrets changes.

### D37 — SETTLED: loopback is exempt from the https requirement, explicitly

`ResolvedConnection` keeps refusing an `opaque_http` credential over plain http, except when
the host is a loopback address. Written as an explicit branch with the reason on it, not as a
relaxed regex: the check exists so a provider secret cannot cross a plaintext hop to a remote
host, and a loopback hop has no remote to cross to. Development stays on http; nothing about
a deployed gateway changes.

### D38 — SETTLED: all three front doors, in WP23, together

`/v1/chat/completions`, `/v1/responses` and `/v1/messages`. Not sequenced, because the
sequencing was only ever about which upstreams to unblock first, and the answer is all of
them. WP24's per-provider verification (OD16) is therefore scoped against the full door set
from the start rather than re-scoped per door.

`/v1/models` stays where it is — it answers from the endpoint's allowlist and is not a
protocol front door.

### D39 — SETTLED: the seed owns the mock upstreams' header echo

Both mock upstreams gain one endpoint that reports the headers of the request it received.
It is in the seed rather than a package because two packages' acceptance tests read it and
neither owns WP5's tree, and because it is the only way the credentials rules are pinned end
to end rather than in unit tests alone.

---

## Fan-out

WP12 gates three packages; WP4 is independent of all of them and can start on day one.

| Worktree | Branch | Package | Owns |
| --- | --- | --- | --- |
| `gateways-wp12` | `feat/gateways-wp12` | SDK connection resolution | `sdks/python/agenta/sdk/agents/connections/` |
| `gateways-wp4` | `feat/gateways-wp4` | Audit events | the gateways' emission into `core/events/` |
| `gateways-wp13` | `feat/gateways-wp13` | Runner and harnesses | `services/runner/src/`, the wire, the harness configs |
| `gateways-wp14` | `feat/gateways-wp14` | Agent v0 | the remaining model caller |
| `gateways-wp15` | `feat/gateways-wp15` | MCP servers on the wire | the runner's MCP server configs |
| `gateways-wp23` | `feat/gateways-wp23` | Protocol front doors | `apis/fastapi/gateways/llms/proxy.py`, the per-protocol parsers |
| `gateways-wp24` | `feat/gateways-wp24` | The relay-only south port | `core/gateways/llms/providers/`, `registry.py`, the migration |

Each package has a spec and a task list: [WP4](specs-wp4.md) · [WP12](specs-wp12.md) ·
[WP13](specs-wp13.md) · [WP14](specs-wp14.md) · [WP15](specs-wp15.md) ·
[WP23](specs-wp23.md) · [WP24](specs-wp24.md). Read the spec before the tasks, and the tasks
before touching a file.

**WP12 — SDK connection resolution.** `resolve()` returns a gateway route: provider and
deployment naming the gateway, `endpoint.base_url` the gateway URL, and our own credentials in place of
the provider's secret. The SDK keeps every capability it has (D4), so this
is a change of *what the resolver returns*, not of what it can express — except for the
header binding above, which lands here and on the wire together.
*Depends on:* C1. *Blocks:* WP13, WP14, WP15.
*Done when:* a resolved connection for any provider names the gateway, and no provider key
appears in its output.

**WP4 — Audit events.** One event per call into the existing events domain (D22), carrying
the principal, the target, the decision and the outcome. The service already computes all
four — `GatewayOutcome` carries the status, the secret owner and its origin, and
`GatewayTarget` carries plane, namespace, name and model. Emission is the missing half.
*Depends on:* C1. *Blocks:* nothing.
*Done when:* one event per call, queryable through the existing surface, on both planes and
on the refusal paths as well as the success ones.

**WP13 — Runner and harnesses.** The runner carries a gateway route rather than provider
secrets. Verify the two properties that make this worth doing: the per-server secret arrays
collapse to one set of gateway credentials, and the redaction set shrinks accordingly.
*Depends on:* WP12.
*Done when:* a run reaches a model with no provider key anywhere in the sandbox, on both
the local and the Daytona sandbox.

**WP14 — Agent v0.** The remaining caller.
*Depends on:* WP12.

**WP23 — Protocol front doors.** `/v1/responses` and `/v1/messages` beside
`/v1/chat/completions` (D33). Each needs its own minimal body parse for the policy fields
(the model id, the stream flag), its own usage extraction, and its own ceiling binding —
Chat Completions names the ceiling `max_tokens`, Responses names it `max_output_tokens`.
Nothing else in the pipeline changes: resolution, filters, ceilings, secrets and audit are
all protocol-blind.
*Depends on:* C1. *Blocks:* WP24.
*Done when:* a request in each protocol relays byte for byte to an upstream that speaks it,
with usage recorded and the ceiling enforced.

**WP24 — The relay-only south port.** D34 forbids body conversion, so the
`passthrough`/`translated` split collapses into one relay with a routing strategy and an
authentication strategy per deployment. Carries OD16's verification as its first task —
per provider, does it accept the bytes a front door relays, can its URL be composed from
route fields, can its auth be applied without touching the body — and moves each provider
that passes. `TranslatedLLMAdapter` is deleted, not deprecated; litellm stays for cost
arithmetic and for signing where the scheme is a signature.
*Depends on:* WP23, because removing conversion before the front doors exist would make
Anthropic, Gemini, Bedrock and Vertex unreachable rather than reachable-another-way.
*Also carries:* `provider_key`'s `NOT NULL`, which loses its last justification when
`select_upstream`'s `direct` branch goes (entities.md §2.4).
*Done when:* no code path parses a request body except to read the policy fields, and the
providers OD16 cleared are reachable through the front door matching their shape.

**WP15 — MCP servers on the wire.** The runner's `McpServerConfig.connection.url` points at
a gateway MCP route and its `credentials` array carries ours. The binding this
needs already exists, which is why this is the smaller of the two runner packages.
Carries OD17's verification as its first task — per server, does it answer a plain stateless
POST, and does it need the SSE leg the gateway refuses — because D8 settled which revision we
build to and nothing settled what an older upstream does.
*Depends on:* WP12, and WP13's wire commit.

---

## Merges

**IM4 — after WP12.** Not deployed. It exists so WP13, WP14 and WP15 branch from one
resolver rather than three copies of an unmerged one.

**WP15 branches from WP13's wire commit, not from IM4.** The two share `protocol.ts`, and a
shared file edited in parallel is how a stack scrambles.

**IM5 → C2.** Deploy. All seven packages.

WP23 and WP24 are a pair and land in that order. They are in this wave rather than a later
one because D34 is a constraint on what the relay may do, and a constraint that is written
down but not enforced is worth nothing — every week it is unenforced is another call site
that assumes conversion is available.

---

## Acceptance at C2

From `plan.md`, unchanged, plus what wave 1's shape now makes checkable:

- A real agent run completes with **no provider secret anywhere in the sandbox** — asserted
  by inspecting the sandbox environment, not by inspecting our own resolver.
- The run's model calls and tool calls appear as **audit events with the right principal**.
- A run naming a **model it may not use** fails cleanly — the filter refuses before the
  upstream is dialled, and the failure names the model.
- A run whose endpoint is **deactivated** fails with the flag named, not with a timeout.
- `X-AG-Credentials` never reaches an upstream, and a caller's `Authorization` **does**
  when no secret resolved — pass-through, working. Both want a mock that echoes the headers
  it received, which WP5's mocks do not do yet; adding that echo is a prerequisite for
  asserting either at this level rather than only in unit tests.
- A request in each front door's protocol relays byte for byte, compared as bytes.

---

## Rules

The wave-1 rules in [`launch.md`](launch.md) hold unchanged — one package per worktree,
plain `git`, no cross-package edits, and the seed files nobody edits after. Three additions
specific to this wave:

- **No test ever calls a real LLM or a real MCP server.** Every layer — unit, integration,
  acceptance — dials a mock: WP5's `mock-llm-gateway` and `mock-mcp-gateway`, the in-process
  `MockLLMAdapter`, or a new mock variation the package adds. A provider a mock cannot yet
  imitate is a mock to extend, never a live call to make. A live call makes the suite pay,
  leak and flake on someone else's uptime, and an `xfail` on the provider's quota is a test
  that reports green while asserting nothing. This applies to fixture hostnames too: point
  them at a mock, so no future test can turn a placeholder into a dialled one.

- **The wire is shared.** WP13 and WP15 both touch `services/runner/src/protocol.ts`. The
  binding change belongs to WP13; WP15 consumes it. If they run in parallel, WP15 branches
  from WP13's wire commit rather than editing the file.
- **A harness is a fact, not an assumption.** Anything a package needs a harness to do —
  send a header, keep a subscription login across a base-URL override — is verified against
  the release in use before the package depends on it (OD14).
