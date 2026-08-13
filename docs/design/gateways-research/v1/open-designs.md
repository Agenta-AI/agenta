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

**R2. `LlmGatewayService`'s frozen constructor takes no vault dependency**, yet `list_endpoints`
must decide which generated endpoints exist, which under D20 means "those a key exists for".
**→ The resolver port gains one method; the service gains no dependency.**

```python
@abstractmethod
async def available_provider_keys(self, *, scope: AuthScope) -> Set[str]:
    """Provider keys with a resolvable project-owned secret. Names only, never a
    value — an existence test that must not read a credential (D20)."""
```

Handing the service a `VaultService` would give it two credential seams and defeat the port. The
question "does a key exist for this provider" is a credential-layer question, and the resolver is
the credential layer. The alternative — calling `resolve()` eleven times and catching
`CredentialNotFoundError` — is control flow by exception and eleven vault reads per list.

Three packages gain a line: **WP2** implements it in `resolution.py`, **WP5** implements it in the
mock resolver from its dict, **WP7** calls it from `list_endpoints`.

**R3. `GET /v1/models` has no backing service method. → `list_models`, on the data-plane half of
`LlmGatewayService`, returning the allowlist.**

```python
async def list_models(self, *, scope, namespace, name) -> List[str]: ...
# Resolves the target, authorizes with USE_LLM_ENDPOINTS, and returns what
# policy will allow: the static catalogue's slugs for builtin, model_slugs for
# custom. No new DTO — the proxy shapes the OpenAI list body inline, as it has
# no wire models (§6).
```

It is per endpoint, not global — the route is `/{namespace}/{name}/v1/models` (§9). Owned by
**WP7**, called by **WP6**, exactly like `relay_chat_completion`.

**R4. `GatewayPolicyService.record()` sits on the checkpoint A hot path, but its real body is a
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
runs. Checkpoint A verifies with it `false`, and setting it `false` on shared deployments is a
named action.

**R8. The Composio-backed MCP adapter has no owning package in wave 1** — and on inspection it
should not, because checkpoint A's reachable targets are our own servers and the mocks (D23). It
belongs to whichever wave first makes a brokered server reachable. Worth stating so its absence
reads as intent rather than omission.

**R9. `litellm` is not a direct dependency of the API**, only transitive through the SDK package.
If routing runs in the API process, that service declares it (`raw/model-call-sites.md` notes the
same thing).

**R12. `McpGatewayService`'s frozen constructor omitted `connections_service`** — surfaced by
building it. §8 mandates that `list_endpoints` resolve a builtin entry's state *"through the
existing connections service"*, and `relay` resolve a builtin target the same way, so the
behaviour the document requires cannot be written from the listed dependencies. **Settled: the
constructor gains it**, as a concrete service object — §8's own paragraph says cross-domain
composition passes concrete services and that the interface rule bites at the DAO and adapter
seams, not between services. §8 now lists it.

This is the same class of gap as R2, and the two were settled differently on purpose. R2's
question was *does a credential exist*, which is the credential layer's own question, so it became
a method on the port rather than a second dependency. R12's is *what does the integrations domain
say about this connection*, which no port of ours can answer. The blast radius is one line in the
composition root: the proxies and routers receive the service, they do not construct it.

**R13. The seed put the two upstream registries in `interfaces.py` as well as `registry.py`.**
§7.1 presents the south ports and their registries in one code block headed `interfaces.py`, so
the transcription carried the registry classes there; but §0's file layout is explicit —
`interfaces.py` holds *"the DAO interface + the south port"* and `registry.py` holds *"adapter key
-> interface"*. The result is two classes of each name, the `interfaces.py` pair being
never-implemented stubs that would win silently if imported. **The stubs come out at the merge**,
leaving the real ones in `registry.py`. Deferred to M2 rather than fixed mid-flight, because the
packages that own `registry.py` were still writing when it was found.

**R11. §9's exception-mapping table is narrower than §5's exception set** — surfaced by writing
the seed. The table names six categories; `CredentialNotFoundError`, `CredentialInvalidError` and
`McpScopeInsufficientError` are not among them, and a fall-through would answer a project with no
provider key with a 500, on checkpoint A's hot path.

**Mapped to 409 in the seed, on §5's own words** rather than on invention: "the second says *you
could, once someone connects* … maps to the needs-auth / needs-input interaction path (D17)", which
is the same interaction status `McpAuthRequiredError` already takes. `CredentialInvalidError`
follows D18 identically. Confirm before checkpoint A; a different status is a one-file change.

Note this is the CRUD boundary's mapping. Both proxies translate into their own surface's error
shape (§9), where WP6's spec already maps a missing credential to a 404 `credential_missing` in the
OpenAI body — the two are different wire contracts, not a contradiction, but they should be read
together once both exist.

**R10. Two small resolution behaviours are undefined:** the tie-break when two secrets of the same
kind match one provider, and whether resolution validates that a grant reference's endpoint is
actually OAuth-protected.

---

## Open

### OD10. What is in the first increment of each gateway

Both gateways are being built. What is open is what each one does first, and the checklist in
`scope-checklist.md` is where that gets marked.

The MCP side has a shape: **the first checkpoint has no OAuth**, and OAuth becomes its own
checkpoint carrying consent, step-up and callback reachability together — the last one so it can
be tested in development at all. With the static secret kind also deferred, the first
checkpoint's reachable targets are our own servers and the mocks (D23), which is a complete set
rather than a gap.

**Blocks the work-package list**, which cannot be sequenced without it.

### OD13. Does a set of direct built-in MCP servers exist from the start

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

### OD2. Is a user's own secret the norm or the exception — parked

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
  one (D14). No static MCP kind in this scope, and no kind at all for the inbound credential.
- **The inbound credential** — minted, ephemeral, never stored, using the signer that already
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
