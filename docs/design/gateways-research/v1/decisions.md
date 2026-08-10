# Open decisions

Nothing here is settled. Each entry states the decision, what it actually hinges on, and a
current leaning with the reason. The leanings are arguments to attack, not conclusions.

---

## D1. One gateway service, or two?

They share six concerns and differ only in protocol surface. The options are one deployable
with two ingress surfaces, two deployables sharing a library, or two independent services.

**Hinges on** whether the policy plane is genuinely shared. If model policy and tool policy
turn out to have different principals, different lifetimes, or different failure modes, the
sharing is cosmetic and two services are honest.

**Leaning: one service, two protocol surfaces, one policy core.** The concerns are the same
six over different nouns, and building the plane twice is the specific failure this research
exists to avoid. But note the counter-pressure in D2 — the two surfaces have very different
performance profiles, and that is the strongest argument for splitting them.

---

## D2. Where does it sit?

The main API already holds the vault, RBAC, entitlements, and tracing — everything the
policy plane needs. It is also Python, and an LLM gateway is a long-lived streaming proxy
carrying every token of every run.

**Hinges on** whether we are willing to couple latency-sensitive token streaming to the
control plane's deploy cadence and failure domain. A slow control-plane deploy becoming a
stall in every agent's token stream is a materially different operational posture than what
exists today.

**Leaning: split the planes rather than the gateways.** A thin data plane that does routing,
credential injection, and streaming, and a control plane in the API that owns identity,
policy, and audit — with the data plane consulting cached policy decisions the way the
existing two-layer entitlement check already does (a cached soft check at ingestion, a hard
check behind it). That pattern is already proven in this codebase and is the closest
precedent.

---

## D3. Build the LLM gateway, or embed one?

The tool-side research answered the analogous question with "embed rather than build, and
own the auth layer." Symmetry suggests the same answer here, and the candidates are mature.

**Hinges on** three things: whether an embedded gateway can be driven headlessly from our
backend without inheriting a second UI and a second data model; whether its license permits
bundling into a self-hosted distribution; and whether its policy hooks are rich enough to
express our principal, or whether we would end up bypassing them.

**Leaning: embed for routing and provider adapters, own the policy plane.** The provider
adapter surface — every provider's quirks, streaming differences, and reseller auth schemes
— is exactly the commodity, continuously-drifting work that is miserable to own and freely
available. The principal, policy, and audit are the parts that are specific to us and that
no embedded gateway will model the way we need. Owning the wrong half of this is the
expensive mistake in both directions.

Worth checking before committing: a proxy of this shape is already present in the API's
dependency tree as a library. Whether that is usable as an in-process routing layer, or
whether it only makes sense as its own service, materially changes the cost of this option.

---

## D4. What is the principal?

The blocking one. Today the finest grain is the project; a governance gateway needs to
answer "who called this."

Candidates: project (today), user, run, agent instance, or a tuple of several. The audit
record, the policy inputs, and the metering dimension all take their shape from this
answer.

**Hinges on** whether per-user attribution requires per-user *credentials*. It does not —
attribution and credential ownership are separable, and conflating them is what makes this
look harder than it is. A run can be attributed to a user while still using a
project-owned connection, provided the token minted for the run carries the user.

**Leaning: a tuple — (organization, project, user, run) — minted per run, carried on the
gateway token, with the credential binding kept separate.** This gives governance and
compliance the attribution they need without forcing a per-user re-authorization of every
existing connection. Whether per-user *credentials* are also wanted is a genuinely separate
product decision that should not block this one.

---

## D5. Does the workflow path transit the gateway too?

Harness runs and workflow runs reach models by different paths. Governing only the first
leaves the busier one ungoverned.

**Hinges on** whether the SDK can route through the gateway without losing the local
development story — a workflow running on a developer's machine against a self-hosted
instance still has to work, and it currently reaches providers directly.

**Leaning: yes, and it is the better first target.** It is in-process, in our own SDK,
with no sandbox and no harness in the way — a cleaner integration than the runner path and
a faster way to prove the gateway is real. The runner path has the stronger security
argument; the workflow path has the shorter one.

---

## D6. Self-hosted posture

The self-hosted story is the reason the tool-side research exists, and a gateway that
requires our cloud would negate it.

**Hinges on** whether the gateway is a component of the self-hosted deployment (the
self-hoster's own gateway, their own keys, their own policy) or a service we run. These
are different products wearing one name.

**Leaning: a component, with the hosted instance being the same component we operate.** Any
other answer reintroduces exactly the dependency the tool-side research set out to remove,
and it would be incoherent to conclude "do not depend on a closed hosted gateway for tools"
while shipping one for models.

---

## D7. Failure posture

A gateway on the critical path of every model call and every tool call is a new single
point of failure, replacing N provider dependencies with one of ours.

**Hinges on** whether we accept fail-closed. For a governance boundary, fail-open defeats
the purpose — but a gateway outage then stops every run, including ones whose policy would
trivially have passed.

**Leaning: fail-closed on policy, with the data plane able to serve cached decisions
through a control-plane outage.** This is D2's split doing real work: the streaming path
survives a control-plane deploy, and only genuinely undecidable calls fail. Worth deciding
explicitly rather than discovering it during an incident.

---

## D8. Migration and coexistence

Existing runs inject provider credentials directly. Gateway-routed runs will not.

**Hinges on** whether both modes coexist indefinitely or the direct path is removed. Some
cases may have to stay direct — a harness authenticating with its own subscription login
already injects nothing and has no credential for a gateway to hold.

**Leaning: coexist, selected per connection, defaulting to direct until the gateway is
proven.** The wire supports both without a new field (Finding 1), which makes this a
resolver-side switch and a per-run rollback rather than a migration. Removing the direct
path is a much later decision that should be made on evidence.

---

## Verification backlog

Claims carried from prior research that should be re-verified before they carry design
weight:

- The exact scoping of tool connections, and whether anything already distinguishes users
  within a project.
- Whether the proxy library already in the dependency tree is usable in-process (D3).
- How a subscription-authenticated harness behaves if pointed at a gateway (D8).
- Whether the workflow model path has any policy check today, or none at all (D5).
