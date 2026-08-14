# Open designs

Design questions still open, with what each hinges on. Settled items move to `decisions.md`;
things tried and replaced move to `notes.md`.

Most of this list closed in one pass. What remains needs a product call rather than an
engineering one.

---

## Wave 1 rulings — surfaced by writing the package specs

Writing the nine specs against `entities.md` found ten places the design is **silent** rather than
wrong. None is a contradiction. Four change a signature the seed freezes and therefore must be
settled before the seed is written; the rest can be settled during wave 1.

### Settled before the seed — all four

**R1. `apis/fastapi/gateways/exceptions.py` has no owner. → The seed owns it.** Both proxies and
the CRUD routers need `handle_gateway_exceptions()`, so no single package can. It moves into the
seed like the DTOs, because shared infrastructure with three consumers is exactly what the seed is
for. The ownership table says so.

**R2. `LLMGatewayService`'s frozen constructor takes no vault dependency**, yet `list_endpoints`
must decide which generated endpoints exist, which under D20 means "those a key exists for".
**→ The resolver port gains one method; the service gains no dependency.**

```python
@abstractmethod
async def available_provider_keys(self, *, scope: AuthScope) -> Set[str]:
    """Provider keys with a resolvable project-owned secret. Names only, never a
    value — an existence test that must not read a secret (D20)."""
```

Handing the service a `VaultService` would give it two secret seams and defeat the port. The
question "does a key exist for this provider" is a secret-layer question, and the resolver is
the secret layer. The alternative — calling `resolve()` eleven times and catching
`SecretNotFoundError` — is control flow by exception and eleven vault reads per list.

Three packages gain a line: **WP2** implements it in `resolution.py`, **WP5** implements it in the
mock resolver from its dict, **WP7** calls it from `list_endpoints`.

**R3. `GET /v1/models` has no backing service method. → `list_models`, on the data-plane half of
`LLMGatewayService`, returning the allowlist.**

```python
async def list_models(self, *, scope, namespace, name) -> List[str]: ...
# Resolves the target, authorizes with USE_LLM_ENDPOINTS, and returns what
# policy will allow: the static catalogue's slugs for builtin, the allowlist for
# custom. No new DTO — the proxy shapes the OpenAI list body inline, as it has
# no wire models (§6).
```

It is per endpoint, not global — the route is `/{namespace}/{name}/v1/models` (§9). Owned by
**WP7**, called by **WP6**, exactly like `relay_chat_completion`.

**R4. `GatewayPolicyService.record()` sits on the C1 hot path, but its real body is a
wave 2 file. → WP3 ships it as a no-op that returns `None` and never raises.**

Note this is not actually a seed file: `core/gateways/policy/service.py` belongs to **WP3**, and the
seed carries only DTOs, types and interfaces. What the seed freezes is the *call*, which every wave
1 relay makes unconditionally. So wave 2 changes a body, never a call site — and no relay path can
be broken by an audit sink that does not exist yet.

### Can be settled during wave 1

**R5. The gateway's entitlement key does not exist. → It should not. Settled as D29: no entitlement
gate in wave 1.** Every user has both gateways, so the check would ask a question with one answer.
What entitlements will express here are *limits*, and a limit cannot be enforced before anything is
measured — so it ships with usage metering and billing, which `scope-checklist.md` already defers
together for the same reason. WP3 writes the permission check only; no placeholder key, because a
placeholder that always permits is something a later reader mistakes for enforcement.
`EntitlementDeniedError` stays declared and mapped, so the wave that adds limits changes a body
rather than a signature.

**R6. `PolicyDecision.reason` has no fixed vocabulary** beyond "stable and terse". Three packages
would otherwise each invent their own strings, and the audit attributes and the boundary's error
map both key off it. **Settled at kickoff by adopting WP3's two:** `"permission_denied"` and
`"entitlement_denied"` — the only two failure modes `authorize()` produces. WP4's audit attribute
builder and WP10's exception mapping read these verbatim rather than each choosing. A third value
needs a decision here, not a commit.

**R7. No SSRF guard was assigned for the gateway's own outbound relay** to a user-supplied custom
MCP server URL — the one item on this list that was a security gap rather than an unstated detail.
**Settled as D28: reuse `core/webhooks/utils.py`, call it at both ends.** Registration (**WP10**)
calls the no-DNS gate `validate_url_format_and_literal_ip`; relay (**WP8**) calls
`resolve_validated_webhook_ip` and connects to the literal IP it returns, keeping the `Host` header
and `sni_hostname` on the original name — the pinning `core/webhooks/delivery.py` already
demonstrates. Two refinements come from the runner's sibling guard: a host allowlist so a
self-hoster can permit one internal server without disabling the guard, and a distinct message for
"could not be resolved" so a DNS typo does not read as a security rejection.

The catch that makes this more than paperwork: `AGENTA_INSECURE_EGRESS_ALLOWED` defaults to `true`
and is set in no deployment configuration in this repo, so today the guard is inert everywhere it
runs. C1 verifies with it `false`, and setting it `false` on shared deployments is a
named action.

**R8. The Composio-backed MCP adapter has no owning package in wave 1** — and on inspection it
should not, because C1's reachable targets are our own servers and the mocks (D23). It
belongs to whichever wave first makes a brokered server reachable. Worth stating so its absence
reads as intent rather than omission.

**R9. `litellm` is not a direct dependency of the API**, only transitive through the SDK package.
If routing runs in the API process, that service declares it (`raw/model-call-sites.md` notes the
same thing).

**R12. `MCPGatewayService`'s frozen constructor omitted `connections_service`** — surfaced by
building it. §8 mandates that `list_endpoints` resolve a builtin entry's state *"through the
existing connections service"*, and `relay` resolve a builtin target the same way, so the
behaviour the document requires cannot be written from the listed dependencies. **Settled: the
constructor gains it**, as a concrete service object — §8's own paragraph says cross-domain
composition passes concrete services and that the interface rule bites at the DAO and adapter
seams, not between services. §8 now lists it.

This is the same class of gap as R2, and the two were settled differently on purpose. R2's
question was *does a secret exist*, which is the secret layer's own question, so it became
a method on the port rather than a second dependency. R12's is *what does the integrations domain
say about this connection*, which no port of ours can answer. The blast radius is one line in the
composition root: the proxies and routers receive the service, they do not construct it.

**R13. The seed put the two upstream registries in `interfaces.py` as well as `registry.py`.**
§7.1 presents the south ports and their registries in one code block headed `interfaces.py`, so
the transcription carried the registry classes there; but §0's file layout is explicit —
`interfaces.py` holds *"the DAO interface + the south port"* and `registry.py` holds *"adapter key
-> interface"*. The result is two classes of each name, the `interfaces.py` pair being
never-implemented stubs that would win silently if imported. **The stubs come out at the merge**,
leaving the real ones in `registry.py`. Deferred to IM2 rather than fixed mid-flight, because the
packages that own `registry.py` were still writing when it was found.

**R11. §9's exception-mapping table is narrower than §5's exception set** — surfaced by writing
the seed. The table names six categories; `SecretNotFoundError`, `SecretInvalidError` and
`MCPScopeInsufficientError` are not among them, and a fall-through would answer a project with no
provider key with a 500, on C1's hot path.

**Mapped to 409 in the seed, on §5's own words** rather than on invention: "the second says *you
could, once someone connects* … maps to the needs-auth / needs-input interaction path (D17)", which
is the same interaction status `MCPAuthRequiredError` already takes. `SecretInvalidError`
follows D18 identically. Confirm before C1; a different status is a one-file change.

**SETTLED at 409, on all three surfaces.** The CRUD decorator and the MCP proxy already agreed;
the LLM proxy was the outlier at 404, and its justifying comment claimed the decorator gave 404
too, which it never did. A caller branching on status was told "not found" — permanent — for a
state that resolves the moment someone connects a key, and got a different answer from each
plane for one failure. The two surfaces still carry different error *bodies*, which is the real
distinction; the status is now the same.

**R10. Two small resolution behaviours are undefined:** the tie-break when two secrets of the same
kind match one provider, and whether resolution validates that a grant reference's endpoint is
actually OAuth-protected.

---

## Open

### OD10. What is in the first increment of each gateway — CLOSED, overtaken

Answered by two shipped waves rather than by argument. C1 stood both gateways up; C2 made them the
only way out. The work-package list this design said it blocked exists, has been executed twice,
and is now planned a third time in `workstreams/launch-3.md`. The original question, for the
record:

Both gateways are being built. What is open is what each one does first, and the checklist in
`scope-checklist.md` is where that gets marked.

The MCP side has a shape: **the first checkpoint has no OAuth**, and OAuth becomes its own
checkpoint carrying consent, step-up and callback reachability together — the last one so it can
be tested in development at all. With the static secret kind also deferred, the first
checkpoint's reachable targets are our own servers and the mocks (D23), which is a complete set
rather than a gap.

**Blocks the work-package list**, which cannot be sequenced without it.

### OD13. Does a set of direct built-in MCP servers exist from the start — CLOSED

**Yes, and through Composio rather than a curated direct set**, for as long as Composio's own
terms permit including its servers under `builtin`. That answers the shipping question without
taking on the per-server catalogue this design was weighing, so the maintenance argument against
it does not apply.

**This is the namespace split working, not a gap in it.** Composio brokers the authorization for
`builtin`; our own OAuth client is what authorizes a `custom` server — one a user brings by URL.
The two are different suppliers for different namespaces, so "our client is only reached through
`custom`" is its purpose rather than a shortfall in coverage.

The original question, for the record:

`builtin` means Composio-backed (D27), so a user clicks an icon and never types a URL, and nothing
new is curated. The open part is whether a **small set of servers we reach directly** ships
alongside it, or waits.

**Why it might not wait.** With `builtin` meaning only Composio, our own OAuth client is exercised
by nothing except a server a user pastes in by hand, which is the least-travelled path and the one
least likely to be exercised before a customer hits it. Shipping a handful of direct servers is how
that code gets used on purpose rather than by accident. It is also the difference between owning
the vendor relationship and reselling one.

**Why it might.** It is the only part of the built-in story that carries ongoing maintenance.

**The maintenance is smaller than it looks, and the pattern is already in the repo.** Only five
fields per server are stored — name, icon, description or category, and URL — because the OAuth
endpoints and the supported scopes are fetched from the server itself at configuration time
(D27). The URLs can be generated from the official public registry, which publishes name, URL and
description. Icons need not be curated either: an openly licensed brand-icon set covers a few
thousand vendors as plain files with no API call, though its coverage of the vendors we want is
unverified.

The refresh mechanism exists already, for the model catalogue: a large generated data file next to
small hand-curated ones, plus a skill carrying the generator script. An MCP server catalogue is
the same shape at a fraction of the size — realistically twenty to forty entries, the servers
people actually ask for, not a connector marketplace.

**Recommendation:** ship a small direct set, for the reason above rather than for coverage. Its
size is a product call.

### OD14. Which harnesses can carry a second identity signal without losing their vendor login — CLOSED (WP13 phase 0)

D32 settles that subscription pass-through is a real funding shape and why it cannot be a
namespace. What it cannot settle is whether any given harness can actually be configured for it,
because that is a fact about releases, not about design.

**Correction to this document's own harness list.** OD14 as originally written named "Codex,
Claude Code, OpenCode." OpenCode is not a harness this codebase drives — there is no OpenCode
package, adapter, or ACP bridge anywhere in the tree (`grep -ri opencode` outside this document
and specs-wp13.md finds nothing). The runner's actual third harness, alongside Claude Code and
Codex, is **Pi** (`@earendil-works/pi-coding-agent`, ACP agent id `"pi"`, wire harness ids
`pi_core`/`pi_agenta`) — confirmed against `services/oss/src/agent`'s `HarnessType` enum
(`sdks/python/agenta/sdk/agents/dtos.py`: `PI`/`CLAUDE`/`AGENTA`/`CODEX`, no `OPENCODE` member)
and the runner's own `acpAgent` mapping (`run-plan.ts`). The matrix below is run against Pi,
Claude Code and Codex — the harnesses that exist — not OpenCode.

Two things must be simultaneously true per harness: it sends `X-AG-Credentials` on model
requests, **and** pointing its base URL at us does not make it abandon its vendor subscription
login in favour of an API-key path. The second is the one that quietly fails — a harness that
treats a custom base URL as "the user configured a raw API endpoint" will stop sending the
subscription session entirely, and the symptom is an auth error from the vendor, not from us.

**The matrix, run against the pinned releases in `services/runner/package.json`:**

| Harness | Release | Custom header + base-URL override | Subscription survives base-URL override |
| --- | --- | --- | --- |
| Pi | `@earendil-works/pi-coding-agent@0.80.6` (`pi-ai@0.80.6`) | **Yes.** `models.json`'s provider config carries `headers: Record<string,string>` alongside `baseUrl`, first-class (bundled `docs/models.md`/`docs/custom-provider.md`, "Custom Headers" section). Verified directly in the pinned package's own bundled docs, not inferred. | N/A — the header rides a NEW provider entry (named after the connection slug); it does not touch the operator's own OAuth-provider entries, so there is no login to lose. |
| Claude Code | `@agentclientprotocol/claude-agent-acp@0.58.1` | **Yes.** `ANTHROPIC_CUSTOM_HEADERS` (newline-separated `Name: Value` pairs) alongside `ANTHROPIC_BASE_URL`. Verified by reading the pinned bridge's own compiled source (`dist/acp-agent.js`, `createEnvForGateway`): it sets exactly this pair for its own `"gateway"` ACP method, so this is a mechanism the pinned release already exercises, not a guess. | **No.** The same function sets a placeholder `ANTHROPIC_AUTH_TOKEN` "to bypass claude login requirement" whenever it builds this env — overriding the base URL forces the API-key-shaped path; the underlying Claude Code SDK does not keep sending the subscription session once `ANTHROPIC_BASE_URL` is set. |
| Codex | `@openai/codex@0.145.0` / `@agentclientprotocol/codex-acp@1.1.7` | **Yes.** A custom `[model_providers.<id>]` table in `config.toml` supports `base_url`, `env_key` (bearer token, indirection via an env var name) and `env_http_headers` (arbitrary header name -> env var name). Cross-checked against this repo's own prior Codex-harness research (`docs/design/codex-harness/decisions.md` D-002: "codex 0.145 supports a custom model provider with `env_key`... the WebSocket-upgrade caveat disappears (custom providers do not attempt it)") and codex-rs's public `ModelProviderInfo` struct. | **No, but moot.** Subscription mode authenticates from the BUILT-IN provider's mounted OAuth login exclusively (this repo's own D-002 ruling: "Subscription mode is unchanged (the operator's own login file via symlink)"); a custom `model_providers` entry with `base_url` is a structurally separate, mutually exclusive provider selection. There is no run that overrides the base URL and also expects the built-in login to answer. |

**Conclusion: no harness fails the matrix for wave 2's own need.** All three carry a custom
header alongside a base-URL override, which is all `credentialMode: "none"` (the gateway route)
needs. None of the three lets a base-URL override coexist with a preserved subscription login —
but wave 2 does not build subscription pass-through (D32, explicitly deferred) and never asks a
harness to combine the two, so this is not a wave-2 blocker. It IS the exact fact D32's own text
predicted would be needed before pass-through could be built, and it is now recorded for whoever
picks that up.

**The fallback if a harness fails the matrix** is the local-agent shape: a small local process
between harness and gateway that holds the gateway identity and leaves the harness's own vendor
login untouched. Not needed for wave 2 — no harness failed the matrix for wave 2's actual
requirement (header + override, no subscription combination attempted).

### OD15. Pass-through is not a mode at all — it is the default when nothing overwrites — CLOSED

Settled as written below: there is no mode to store, because pass-through is what already happens
when the gateway has no secret to inject.

The question was where a pass-through target keeps its mode, given that pass-through's
natural targets are `standard` endpoints, which are generated and have no row (D20). It
keeps it nowhere, and there is no mode to keep: **it is what already happens when the
gateway has no secret to inject.**

**The rule, in full:**

- The data plane reads `X-AG-Credentials` and nothing else (D31), so every other header on
  an inbound request belongs to the caller.
- The relay strips `X-AG-Credentials` and forwards the rest.
- If the endpoint resolves a secret, the adapter overwrites that provider's own auth header
  with it. If it does not, whatever the caller sent stands and reaches the upstream.
- Everything else is unchanged. The target must still resolve and be active, the model
  filter still applies, the ceiling still applies, and the audit event still fires with
  `secret_origin` recording that no secret of ours paid.

**Nothing has to recognise a provider's auth header on the way in.** Detecting
pass-through would require knowing that Anthropic reads `x-api-key` while OpenAI reads
`Authorization: Bearer`, and being wrong in either direction is a leak or a broken call.
Requiring our own header on the data plane removes the question: there is nothing to
detect, because there is no branch. A provider's auth header is named only on the
*injection* side, by the adapter that already knows which secret it holds.

The passthrough adapter forwards `x-api-key` and every other caller header today. The one
thing standing between current behaviour and this rule is that `Authorization` is stripped
unconditionally, which is a line to change when a caller has a reason to send one.

**What this does not decide** is whether an operator may forbid it — a project that does not
want its spend quietly split across personal subscriptions needs a governance flag, which is
a policy question rather than a routing one, and nobody has asked for it.

The passthrough adapter already forwards `x-api-key` and every other caller header; the only
thing standing between today's behaviour and this rule is that `Authorization` is stripped
unconditionally.

**What a column would still be worth** is the opposite statement: an operator forbidding
pass-through on a target, so a project cannot quietly split its spend across personal
subscriptions. That is a policy flag rather than a mode, it belongs with the other
governance flags, and nobody has asked for it.

### OD16. Which upstreams a relay-only gateway actually reaches — CLOSED by WP24

D34 forbids body conversion outright and keeps routing and authentication, which settles the
principle. What is open is the consequence: **which upstreams remain reachable, through
which front door, once nothing may rewrite a body.**

This is a per-provider fact and not an argument. For each upstream, three questions:

1. **Does it accept the bytes a front door would relay?** Azure OpenAI takes the OpenAI
   body unchanged, so Chat Completions reaches it today. A Bedrock Anthropic model takes the
   Anthropic Messages body, so it needs the `/v1/messages` front door and reaches nothing
   before that. The answer is read from the provider's own request schema, not inferred from
   which adapter currently handles it.
2. **Can the URL be composed from route fields?** Azure needs `base_url`, the deployment
   name and an API version; Bedrock needs the region and the model id. Whether the model id
   comes from the path or the body changes what the relay has to touch — and if it must come
   out of the body, that provider fails question 1 rather than passing this one.
3. **Can its auth be applied without touching the body?** A header, however named, is
   trivial. A signature over the request is allowed but is real work, and SigV4 signs the
   body it is given, which is compatible with relaying it and not with rewriting it.

**The expected shape of the answer**, to be confirmed rather than assumed: Azure moves to a
plain relay with URL composition and a renamed auth header. Bedrock and Vertex become
reachable through the front door matching the body they take, with signing. The `direct`
providers whose wire is not OpenAI's — Anthropic, Gemini, Cohere — are reachable only
through their own front doors, and are not reachable at all until those land.

**The cost worth stating plainly.** Until the second front door exists, the gateway reaches
OpenAI-shaped upstreams and OpenAI-compatible custom endpoints, and nothing else. That is a
smaller set than today's provider table suggests, and it is the honest consequence of D34
rather than a gap in it.

**What this unblocks if it resolves the expected way.** `select_upstream`'s `direct` branch
is the last thing on a stored row that reads `provider_key` (entities.md §2.4). With the
split gone, the column decides nothing and becomes a label — at which point its `NOT NULL`
should go with it.

---

**CLOSED (WP24, phase 0).** All three front doors ship (D38), so every provider below is
checked against whichever door matches its own wire, not only Chat Completions. Sourced
from each provider's own current documentation (dated where the fact is recent), not from
what today's adapter does.

**The headline result is the opposite of the doc's "expected shape" above: nearly
everything clears, and the reason is that four of the six `_DIRECT_TRANSLATED_PROVIDERS`
already ship an OpenAI-compatible endpoint of their own, and Anthropic's native wire now
has a matching front door.** litellm's translated path was carrying providers that do not
need translation at all — they need a base URL and a bearer header, exactly what the
passthrough adapter already does. The `passthrough`/`translated` split was never a
provider-shape boundary; it was "does litellm's default base URL happen to work", which is
a different question.

| Provider | Q1: accepts the relayed bytes | Q2: URL from route fields | Q3: auth without touching body | Verdict |
| --- | --- | --- | --- | --- |
| `anthropic` | Yes — its own wire *is* Messages; reachable at `/v1/messages` now that the door exists. | Yes — fixed base URL, no per-row fields needed. | Yes — `x-api-key` header (Anthropic's own name for the same job as Azure's `api-key`), no `anthropic-version` header injected by us (the caller sends it, same as any other vendor-specific header a harness speaking Anthropic's protocol already knows to send). | **Cleared.** Messages door. |
| `gemini` | Yes — Google ships an OpenAI-compatible endpoint (`/v1beta/openai/chat/completions`, confirmed current). | Yes — fixed base URL. | Yes — plain bearer `Authorization`. | **Cleared.** Chat Completions door, via the compat endpoint (not `generateContent`). |
| `cohere` | Yes — Cohere ships a "Compatibility API" (`api.cohere.ai/compatibility/v1`, confirmed current) built for exactly this. | Yes — fixed base URL. | Yes — plain bearer `Authorization`. | **Cleared.** Chat Completions door, via the compat endpoint (not v2 chat). |
| `deepinfra` | Yes — DeepInfra's documented base URL is already OpenAI-compatible (`api.deepinfra.com/v1/openai`). | Yes — fixed base URL. | Yes — plain bearer `Authorization`. | **Cleared.** Was miscategorized as translated; it was always OpenAI-shaped. |
| `perplexityai` | Yes — `api.perplexity.ai/chat/completions` is documented as an OpenAI-SDK-compatible alias of Perplexity's own Sonar endpoint. | Yes — fixed base URL. | Yes — plain bearer `Authorization`. | **Cleared.** Same miscategorization as DeepInfra. |
| `minimax` | Yes — MiniMax documents an OpenAI-compatible Chat Completions route (`api.minimax.io/v1/chat/completions`). | Yes — fixed base URL. | Yes — plain bearer `Authorization`. | **Cleared.** Same miscategorization. |
| `azure` | Yes — Azure OpenAI's deployed-model wire is the OpenAI Chat Completions body, unchanged. | Yes — `base_url` + `/openai/deployments/{model}/chat/completions` + `?api-version=` from `route.api_version`. The deployment name is `route.model`, matching the existing catalogue convention (entities.md §2.4's Azure example never carries a separate deployment field). | Yes — `api-key` header, not `Authorization`, no signature. | **Cleared,** as the doc expected. |
| `bedrock` | Yes, via `bedrock-mantle`: AWS's current-generation Bedrock endpoint (`bedrock-mantle.{region}.api.aws`) speaks OpenAI Chat Completions for most models and Anthropic Messages for Claude models, both unmodified bodies. The older `InvokeModel` wire (`/model/{id}/invoke`) still requires an injected `anthropic_version` field for Claude models, which we do not add — a caller building a Bedrock-flavored Messages body itself (D34's "translation moves to the client") can still reach `InvokeModel`, but the mantle path needs nothing extra from the caller and is the one this package wires. | Yes — `https://bedrock-mantle.{region}.api.aws` + protocol path, region from `route.region`. | Yes — **plain bearer**, not SigV4: mantle accepts a Bedrock API key as `Authorization: Bearer <key>` (falling back to SigV4 only when no key is supplied, which this design never does). Confirmed by AWS's own docs and by litellm's `bedrock_mantle` provider module, vendored in this repo. | **Cleared, and simpler than the doc's expected shape** — no signing needed for the deployment this package wires. |
| `vertex_ai` (Gemini) | Yes — Vertex ships the same OpenAI-compatible layer as the direct Gemini API, at `.../endpoints/openapi/chat/completions`. | Yes — `https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/endpoints/openapi`, region from `route.region`, project from `route.extras["vertex_project"]`. | Yes — bearer, but the token is minted (a service-account OAuth2 access token), never presented as a static secret. Token minting is real work and is the "signing where the scheme is a signature" carve-out D34 names; this package reuses litellm's own Vertex credential helper (`VertexBase.get_access_token_async`) rather than its request/response transformation, so the body is still never touched. | **Cleared.** Chat Completions door. |
| `vertex_ai` (Claude) | Conditionally — Anthropic's Vertex wire (`:rawPredict`/`:streamRawPredict`) needs an injected `anthropic_version: "vertex-2023-10-16"` field the plain Anthropic Messages API does not use. Same shape as Bedrock's legacy `InvokeModel`: reachable only if the caller builds a Vertex-flavored Messages body itself. | Same as above. | Same as above. | **Not wired by this package.** A caller-side concern per D34; nothing here special-cases it. |
| `sagemaker` | **No, categorically.** `InvokeEndpoint` has no platform-level request schema — AWS documents it as opaque bytes forwarded verbatim to whatever container the customer deployed. There is no "SageMaker's own wire" to check against a front door; the answer is "maybe", per deployment, which is not a fact this design can pin. | Yes in principle — endpoint name in the URL path, region for the host — but moot given Q1. | Yes — SigV4, real work, allowed. | **Not cleared.** Recorded unreachable: `select_upstream` raises, naming that SageMaker has no fixed protocol rather than naming a specific one it needs. |

**A second finding, not one of the three questions but blocking regardless.** Every
provider's catalogued model ids (`supported_llm_models`) carry litellm's own routing
prefix (`"anthropic/claude-sonnet-5"`, `"groq/moonshotai/kimi-k2-instruct-0905"`, …) —
needed for `litellm.acompletion`'s dispatch, meaningless to the upstream itself. Relaying
one of these ids byte-for-byte in the request body reaches the real upstream with a model
id it does not recognise, for every direct provider, not only the six moved off
`translated` — this was already latent in the existing `passthrough` set (`groq`,
`together_ai`, `openrouter`, `mistral`). D34 forbids fixing this at relay time (touching
the body); the fix is upstream of the relay, in what the catalogue advertises. `catalog.py`
now strips each provider's own litellm prefix from its allowlist, using the SDK's existing
`litellm_provider_prefixes` table in reverse, so the id a caller copies from the allowlist
is the id the real upstream expects.

**Moves existing providers only, per spec.** `deepinfra`, `perplexityai` and `minimax` were
never translated in fact, only in classification — moving them is correcting a
misclassification, not adding a provider. `sagemaker`'s removal is a correction in the same
direction: it was never really reachable through `translated` either, since litellm's
SageMaker handler assumes an OpenAI/HF-TGI-shaped container that is a deployment choice,
not a platform guarantee — `translated` was silently narrower than its name implied.

### OD17. Which MCP servers a stateless relay actually reaches — CLOSED by WP15

The MCP twin of OD16, and open for the same reason: D8 settled which revision we **build**
to, and nothing settled what happens when an upstream server speaks an **older** one.

The gateway is stateless end to end. `POST` is the only relaying verb; `GET` and `DELETE`
on both proxy paths are refused rather than proxied, because those are the SSE and
session-teardown legs the 2026-07-28 revision removed. Routing reads `MCP-Method` and
`MCP-Name` from headers and never parses the body — which is what lets the tool filter
refuse a call before the upstream is dialled, and is not something a session-based revision
would allow.

**Verdict: the reachable set is not a session-revision problem.** Every server WP15 is
tested against, and every real-world candidate probed against its own documentation or
live, answers a plain stateless POST. Nothing in the probed set needed detect-and-refuse or
session carrying, so D8 stands unchanged and this closes without reopening it.

Per-server findings, against the three questions (plain stateless POST; header-based
routing vs. body-only method; SSE needed for ordinary calls):

1. **`mock-mcp-gateway` (WP5, wave 1's tested target).** Source: its own implementation
   (`core/gateways/mcps/providers/mock/app.py`). Stateless JSON mode by construction: one
   JSON-RPC request in, one `application/json` response out (`202` for a notification), no
   `Mcp-Session-Id`, no initialize handshake before `tools/list`. `GET`/`DELETE` answer
   `405` at the mock itself, matching the gateway's own refusal. **Reachable.**

2. **DeepWiki (`mcp.deepwiki.com/mcp`), unauthenticated, live-probed** (a plain `POST
   tools/list`, no session header, no prior `initialize` call): answered `200` with the
   full tool list on the first request. The response rides a single `text/event-stream`
   event on the POST's own connection rather than a bare JSON body — allowed by the current
   spec for a stateless responder, and relayed byte-for-byte by `HttpMCPAdapter`, which
   never inspects content-type. No session id was minted or required. **Reachable**, and
   representative of "the handful we expect to route first": a real, unauthenticated,
   current-revision server with no operator-side setup.

3. **Context7 (`mcp.context7.com/mcp`).** Documented as OAuth-gated on first connect. Out of
   this package's reachable set on the auth axis (D23: wave 1 is unauthenticated servers and
   the mocks) before its session behaviour is even relevant — wave 3's problem (WP16–WP20),
   not this one's. Not probed further.

**Why this doesn't reopen D8.** The failure mode OD17 worried about — a server half-working
by accident, POST succeeding while the GET leg it needs is refused — was not observed
because no probed server needed the GET leg for an ordinary call. Nothing here found a
server on the prior (session-carrying) revision at all, so there was no "large stale group"
to trade a cheap refusal against carrying state for. If a genuinely stale server turns up
later, it fails cleanly today (`GET`/`DELETE` refused, `POST` alone is not enough for it to
complete a handshake) rather than half-working — the confusing case OD17 flagged did not
materialize in this set, so re-deciding D8 stays out of scope here as the spec required.

### OD18. Does a harness's SDK preserve the gateway's refusal body in its error text — CLOSED by WP25

OD14 verified that each harness sends OUR credentials header outbound. It said nothing about
the return trip: whether the JSON body the gateway attaches to a pre-dial refusal
(`{"error":{"message","type","code",...}}`, `apis/fastapi/gateways/llms/proxy.py`
`_map_domain_exception`) survives into the text the harness reports, which is the only signal
`gateway-error.ts`'s `parseGatewayErrorDetail` has to recover the cause from. Verified against
the same pinned releases OD14 used (`services/runner/package.json`), by reading each harness's
own error-formatting source rather than by a live call.

1. **Pi (`@earendil-works/pi-ai@0.80.6`, pinned via `pi-coding-agent@0.80.6`). Preserves it.**
   Two independent paths, both confirmed from source:
   - The OpenAI-shaped API clients (`api/openai-completions.js`, `api/openai-responses.js`)
     route every provider error through a shared `normalizeProviderError`/`formatProviderError`
     pair (`utils/error-body.js`), written explicitly for "endpoints behind a proxy / gateway"
     (the file's own header comment) — it reads the SDK's parsed body field and
     `JSON.stringify`s it into the message whenever the SDK's own message does not already
     carry it.
   - The Anthropic-shaped client (`api/anthropic-messages.js`) uses `@anthropic-ai/sdk@0.111.0`
     directly, whose `APIError.makeMessage` (`core/error.js`) falls back to
     `JSON.stringify(errorResponse)` whenever the parsed body has no top-level `message` key —
     true for our gateway's `{"error":{...}}` shape, which nests `message` one level down. The
     full body reaches `error.message` verbatim.

2. **Claude Code (`@agentclientprotocol/claude-agent-acp@0.58.1`, CLI driven by
   `@anthropic-ai/claude-agent-sdk@0.3.205`). Not independently verifiable from source, and
   recorded as such rather than assumed.** The ACP bridge itself does not reformat: on a failed
   turn it forwards the CLI's own `result` string unmodified into `RequestError.internalError`
   (`dist/acp-agent.js`, the `subtype: "success"` / `is_error` branch). What that string
   contains is decided inside the Claude Code CLI binary, which `@anthropic-ai/claude-agent-sdk`
   downloads and runs as a compiled, closed-source executable (`extractFromBunfs.js`) — there is
   no bundled source to read, matching the limit OD14 hit on the same package for the
   subscription-login question. Since the CLI is Anthropic's own client against Anthropic's own
   Messages API, it is a reasonable inference that it shares `@anthropic-ai/sdk`'s
   body-in-message convention verified above for Pi — but that is an inference, not a reading,
   and is recorded as unverified per this package's own rule (a harness is a fact, not an
   assumption). `tests/unit/gateway-error-harness-formats.test.ts` covers the format Pi and the
   Anthropic SDK are confirmed to produce, exercised as a stand-in for Claude Code's most likely
   shape, and is flagged in-file as unconfirmed for Claude Code specifically.

3. **Codex (`@openai/codex@0.145.0`, ACP bridge `@agentclientprotocol/codex-acp@1.1.7`). Does
   NOT preserve the body — confirmed, not inferred.** `codex-rs`'s HTTP error path
   (`codex-rs/protocol/src/error.rs`, `UnexpectedResponseError::extract_error_message`, read at
   tag `rust-v0.145.0`, matching the pinned npm version) actively parses the response body as
   JSON and keeps only `error.message`, discarding `code`, `type`, and every other field before
   formatting `"unexpected status {status}: {message}"`. The ACP bridge forwards that already-
   stripped string as-is (`dist/index.js`, `createErrorEvent`, `params.error.message`). No brace
   survives for `parseGatewayErrorDetail`'s body scan to find. **This is not the end of the
   story** — see the marker fallback below, which this finding motivated.

**First consequence, then corrected: the marker fallback.** The first cut of this package
recorded Codex's gap as a known degradation and stopped there. That does not meet WP25's own
"done when" — WP19's step-up interaction is built on this channel, and a refusal that reaches
Codex with no `code` is a run that cannot ask the user to fix it. The fix is on our side, and
Codex's own finding points at it: `error.message` survives on every harness examined, Codex
included — codex-rs keeps exactly that one field. So the gateway now renders every TYPED
refusal's `message` with a single machine-readable marker appended
(`⟦agenta_code:<code>⟧`, `_with_code_marker`, `proxy.py`), and `gateway-error.ts` scans for it
as a **fallback**, after the JSON-body parse:

- **U+27E6/U+27E7** (MATHEMATICAL LEFT/RIGHT WHITE SQUARE BRACKET) were picked because they
  never occur in ordinary error prose, a model's own output, JSON delimiters (`{}`/`[]`), or
  markdown — nothing else can produce this exact byte sequence or be mistaken for it, and it
  cannot collide with the separate `{...}` body scan (different bracket characters entirely).
- **The body path stays primary.** It carries `retryable`, `next_step` and `details`, none of
  which a bare code can express; the marker path recovers `code` only.
- **Excluded from `upstream_error`.** D16 forwards the upstream's own detail untouched, and
  this surface must not inject text into a body it promised not to touch.
- **A real gap surfaced along the way.** Building the marker meant rendering every typed
  refusal's message, which required enumerating them — and `SecretInvalidError` (the LLM
  plane's actual "rejected credential": a secret that exists but is revoked or failed refresh,
  `policy/types.py`) turned out to be raised by the shared resolver but never caught by
  `_map_domain_exception` OR listed in `_DOMAIN_EXCEPTIONS`. It would have reached the caller
  as an unhandled 500, not a typed refusal at all. Fixed alongside the marker: `secret_invalid`
  is now mapped (409, same status family as `secret_missing`) and carries the marker like every
  other typed code.

**What is still lost on a marker-only harness.** `retryable` and `next_step` and `details` do
not survive Codex — the marker fallback returns `code` and a (marker-stripped) `message` only,
never backfilled from `NEXT_STEPS`, so a caller can tell "code only" from "the full envelope."
WP19 must degrade to a generic step-up prompt when `next_step`/`details` are absent rather than
assume a specific one exists.

**Claude Code's unknown behavior matters less now.** Item 2's limit (the CLI is a closed-source
compiled binary) still stands and is not resolved here — but since the marker rides inside the
one field (`message`) every harness examined keeps, `code` survives on Claude Code whether or
not its SDK also preserves the full JSON body. The unverified question narrows to
`retryable`/`next_step`/`details`, which were never load-bearing for WP19's own need (a code to
act on).

**Consequence for the runner.** `gateway-error.ts` gained the marker fallback described above;
its body-path parser is otherwise unchanged — already correct for the bodies that do survive.
`tests/unit/gateway-error-harness-formats.test.ts` pins both paths per refusal: the Pi/Anthropic-
SDK shape recovering the full envelope via the body, and Codex's stripped shape (with the marker
still inside `message`) recovering `code` alone via the marker, with `next_step`/`details`
asserted absent. A future edit that changes either SDK's formatting, or the gateway's marker
rendering, fails a test instead of degrading silently.

### OD2. Is a user's own secret the norm or the exception — CLOSED

**Project-level secrets are the model.** User-level secrets are out of scope and recorded as such
in [`out-of-scope.md`](out-of-scope.md). Whether a user puts their own personal credential into a
project-level secret rather than an account one is their choice, not a distinction the platform
draws.

The original framing, for the record:

User-owned secrets are not implemented, so this waits until they are. The mechanism is designed
in `secrets.md` and the lookup already takes an owner (D10), so nothing is foreclosed.

Per-endpoint tokens arrive with this, not before.

### OD6. OAuth callback reachability — CLOSED, and it was never a real problem

**Nothing to build.** The user is already looking at the Agenta interface in a browser when they
click connect, so the address that got them there is one their browser reaches. The authorization
server never fetches the redirect target; it only sends the browser somewhere it has already
been. Cloud has a domain, a self-hosted production deployment has a domain, and development has
the tunnel that is already wired into the compose files. See D26.

The one thing that can genuinely fail is unrelated to the redirect: the newer client-registration
mechanism has the **authorization server** fetch a client identity document over the internet, so
a deployment on an internal-only domain cannot use it. The fallback is registering outbound, and
D26 makes that the standing rule.

Two questions were wrong rather than open, and `notes.md` records both: this was written up first
as a firewall problem, then as a private-address problem, and the deployment shape both worried
about — a production web application with no address — does not exist.

To establish at implementation time, neither blocking: whether the servers we care about still
accept the older outbound registration, and whether any of them reject a redirect target on a
non-public domain.

Belongs to the OAuth wave, not the first one.

### OD12. Should a clamped parameter be silent — CLOSED

**No. A governance ceiling rejects, visibly. It never silently lowers a value.** Settled as D25;
the evidence is below, since the question was to be answered by looking at comparable gateways
rather than by assertion.

**The question conflates two different collisions**, and the ecosystem answers them differently.

*A stated value colliding with a physical limit.* Asking for more output tokens than the context
window can hold is impossible rather than forbidden. Here the direction of travel is to clamp:
the OpenAI-compatible reading treats the output ceiling as an upper bound rather than a demand,
and inference servers that reject instead are being asked to clamp so that callers who set a
safety cap are not punished for it. This case is the upstream's to handle, not ours.

*A stated value colliding with an operator's ceiling.* This is what our ceilings are, and every
comparable gateway rejects. A managed API gateway's token-limit policy answers a rate breach with
"too many requests" and an exhausted quota with "forbidden" — two distinct statuses, neither of
them a quiet edit. Another gateway's prompt-guard plugin answers a denied or non-allowed prompt
with "bad request", and its size limiter rejects the whole request rather than truncating it.

**Why that split is right for us and not merely conventional.** A governance ceiling exists to be
accounted for. Silently lowering a value produces a run whose output differs from what was asked
for, with nothing in the result explaining why — and the compliance claim the ceiling exists to
support becomes unverifiable from the caller's side. Worse, the caller cannot tell a policy
ceiling from a bad prompt, so the failure is invisible exactly where it is most expensive.

The objection that rejecting "breaks a harness that did nothing wrong" is real and is answered by
the error rather than by silence: the denial names the ceiling, the value asked for and the value
allowed, so the caller can retry correctly on the first attempt.

**Consequence for the north ports.** Both surfaces have externally-fixed error shapes, so this
needs a denial that fits inside them and still carries the three facts above. That is
`contract.md`'s open item on expressing a policy denial, and this closes half of it — the content
is settled even where the envelope is not.

---

## Closed in this pass

- **MCP endpoint shape** — one URL per server, namespaced identifier, transparent pass-through
  (D16). A merged endpoint with renamed tools was rejected.
- **Step-up scopes** — scope selection at connect time plus an interaction at step-up (D17).
  Failing with an error was rejected; it is the same situation as a missing connection, where we
  already do not fail.
- **Dead secrets** — tools stay listed and the call fails (D18). Hiding tools was rejected.
- **New secret kinds** — `oauth_provider` and `oauth_grant`, two kinds rather than sub-kinds of
  one (D14). No static MCP kind in this scope, and no kind at all for the inbound credentials.
- **The inbound credentials** — minted, ephemeral, never stored, using the signer that already
  exists (D13).
- **Embeddings in the model registry** — deferred with the whole evaluator path, which is out of
  the current scope (D15).

## Closed earlier

- **Where the policy plane runs**, and **how a policy decision is cached** — both settled by the
  parallel credits design (`raw/related-work.md`).
- **The token store** — there is none; the gateways reference secrets by id (D3).
- **Spend attribution mechanism** — `secret_origin` carries it.
- **The model call-site count** and **whether the routing library runs in-process** —
  `raw/model-call-sites.md`.

## Not open questions

Two items previously listed here as prerequisites were neither prerequisites nor design
questions. Both are **outcomes the gateway enables**, and `notes.md` records why the reasoning
was backwards.
