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

### Must be settled before the seed

**R1. `apis/fastapi/gateways/exceptions.py` has no owner.** Both proxies and the CRUD routers need
`handle_gateway_exceptions()`, so no single package can own the file. **Resolved by assignment:**
it moves into the seed, like the DTOs, because shared infrastructure with three consumers is
exactly what the seed is for. The ownership table now says so.

**R2. `LlmGatewayService`'s frozen constructor takes no vault dependency**, yet `list_endpoints`
must decide which generated endpoints exist, which under D20 means "those a key exists for". Either
the constructor gains the dependency or the method's contract changes. A signature the seed freezes,
so it cannot be deferred.

**R3. `GET /v1/models` has no backing service method.** The route's behaviour is described; the call
it makes is not. Two packages need it.

**R4. `GatewayPolicyService.record()` sits on the checkpoint A hot path, but its real body is a
wave 2 package's file.** Every wave 1 relay calls it. It has to be a safe non-raising no-op rather
than the not-implemented default the rest of the seed uses, and that exception to the seed's own
rule should be explicit rather than inferred.

### Can be settled during wave 1

**R5. The gateway's entitlement key does not exist.** No flag or counter in the entitlements types
fits, and the nearest candidate is the legacy credits counter that D24 says must not be reused.
`architecture.md` already marks the exact call open. The call *shape* is specified; the key is a
placeholder.

**R6. `PolicyDecision.reason` has no fixed vocabulary** beyond "stable and terse". Three packages
will otherwise each invent their own strings, and the audit attributes and the boundary's error map
both key off it.

**R7. No SSRF guard is assigned for the gateway's own outbound relay** to a user-supplied custom
MCP server URL. The runner already guards exactly this risk before handing a URL to a harness, and
the gateway now becomes the thing making that outbound call. Both the registration path and the
relay path need it, and neither package's scope currently names it. **This is the one item on this
list that is a security gap rather than an unstated detail.**

**R8. The Composio-backed MCP adapter has no owning package in wave 1** — and on inspection it
should not, because checkpoint A's reachable targets are our own servers and the fakes (D23). It
belongs to whichever wave first makes a brokered server reachable. Worth stating so its absence
reads as intent rather than omission.

**R9. `litellm` is not a direct dependency of the API**, only transitive through the SDK package.
If routing runs in the API process, that service declares it (`raw/model-call-sites.md` notes the
same thing).

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
checkpoint's reachable targets are our own servers and the fakes (D23), which is a complete set
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
