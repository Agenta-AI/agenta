# Decisions

Settled entries state what is decided and why. Open entries state what the decision hinges
on and a current leaning — those leanings are arguments to attack, not conclusions.

---

## Settled

### S1. Everything transits the gateway, always

There is no direct path and no bypass. Every model call and every tool call made by
anything on the platform goes to the gateway first, and the gateway decides what happens
next.

This explicitly includes the cases that are "custom" today. A custom or self-hosted
provider does not become an exception — the call goes to our gateway, and the gateway's
adapter then calls the custom endpoint. Same for a cloud reseller, same for an
OpenAI-compatible third party, same for a self-hosted model server. What is custom is the
adapter behind the gateway, never the route to it.

**Why it has to be absolute:** a governance boundary with an exception is not a boundary.
If any path can reach a provider directly, then no claim about policy, audit, spend, or
credential containment holds — the answer to "did every call get checked" becomes "every
call except those." One bypass costs the entire property.

**What this costs:** changes throughout, not in one place. Every current call site that
resolves a credential and calls a provider becomes a call site that calls the gateway.
That is the actual scope of this work and it should not be understated.

### S2. The principal is `AuthScope`, and it is user-scoped

Every authenticated call into the platform already resolves `organization_id`,
`workspace_id`, `project_id`, and `user_id` together, and is rejected if any is missing.
The gateways inherit this unchanged. There is no new principal to design, and no
project-only identity to work around.

Which stored credential the gateway then uses on the caller's behalf is a separate binding
and a separate decision (D3). Caller identity and credential ownership are independent.

### S3. Ports and adapters, everywhere, including inside the SDK

The SDK keeps every capability it has today — including injecting secrets and fetching
secrets. Those capabilities are not removed and the calling code does not change shape.
What changes is the implementation behind the port: the adapter that used to resolve a
credential and call a provider now calls the gateway.

Nothing here is "in-process." A caller depends on a port; the adapter behind it talks to
the gateway.

### S4. Agent runs and workflows are separate callers

They are different callers of the same gateway, with different ports, and they must be
designed separately. Reasoning about them as one path produces conclusions that are wrong
for both.

---

## Open

### D1. One gateway service, or two?

Model traffic and tool traffic share the same six concerns and differ only in protocol
surface. Options: one deployable with two ingress surfaces, two deployables sharing a
library, or two independent services.

**Hinges on** whether the policy plane is genuinely shared. Given S2 settles the principal
as identical for both, the main remaining difference is performance profile — model traffic
is long-lived token streaming, tool traffic is request/response.

**Leaning: one policy core, two protocol surfaces.** Whether that ships as one deployable
or two is an operational choice that can follow later; what matters is that the policy
implementation is single.

### D2. Where does the policy plane run relative to the data path?

The main API holds the vault, RBAC, entitlements, and tracing — everything policy needs.
It is also the thing whose deploys would then sit in the path of every token of every run.

**Hinges on** whether we accept coupling streaming traffic to control-plane deploys and
failures.

**Leaning: split the planes.** A thin data plane that routes, injects credentials, and
streams; a control plane in the API that owns identity, policy, and audit; the data plane
serving cached policy decisions. The existing two-layer entitlement check — a cached soft
check at ingestion, a hard check behind it — is the same pattern and the closest precedent
in this codebase.

### D3. Which credential does the gateway select, given a caller?

S2 settles who is calling. This is the separate question of what the gateway uses on their
behalf: a credential owned by the project, by the user, or selected by policy from either.

**Hinges on** a product question rather than a technical one — whether users are meant to
bring their own provider credentials, or consume a shared organizational one under quota.
Both are implementable; they imply different vault shapes and different metering.

**Leaning: policy-selected, defaulting to the project-owned credential.** This preserves
current behaviour by default while making per-user credentials expressible without a
redesign.

### D4. Build the provider adapters, or embed an existing gateway?

The prior tool-side research concluded "embed rather than build, and own the auth layer."
The question is whether the same answer holds for model providers.

**Hinges on** whether an embedded gateway can be driven headlessly without inheriting a
second data model and a second UI; whether its license permits bundling into a self-hosted
distribution; and whether its policy hooks can express `AuthScope`, or whether we would end
up bypassing them and maintaining a fork.

**Leaning: embed the provider adapters, own the policy plane.** Provider quirks, streaming
differences, and reseller auth schemes are commodity work that drifts constantly and is
freely available. Policy and audit are ours. Owning the wrong half is the expensive mistake
in either direction.

Worth verifying first: a proxy of this shape already exists in the API's dependency tree as
a library. Whether it is usable as an in-process routing layer or only as a separate
service materially changes this option's cost.

### D5. Self-hosted posture

**Hinges on** whether the gateway is a component of a self-hosted deployment or a service
we operate.

**Leaning: a component — the hosted instance runs the same component we ship.** Any other
answer reintroduces exactly the hosted dependency the tool-side research set out to remove,
and it would be incoherent to reject a closed hosted gateway for tools while shipping one
for models.

### D6. Failure posture

Given S1, the gateway is on the critical path of everything. It replaces N provider
dependencies with one of ours.

**Hinges on** whether we accept fail-closed. For a governance boundary fail-open defeats
the purpose, but a gateway outage then stops every run.

**Leaning: fail-closed on policy, with the data plane serving cached decisions through a
control-plane outage.** This is D2's split doing real work — streaming survives a
control-plane deploy, and only genuinely undecidable calls fail.

### D7. Sequencing

S1 is the end state, not a first commit. Nothing about the end state tells us what order to
convert call sites in.

**Hinges on** which call sites are cheapest to convert and which prove the most. The
security argument is strongest where long-lived cloud credentials currently enter
agent-controlled sandboxes; the cheapest conversion is likely elsewhere.

**Leaning: none yet.** This should be decided once the port shapes for each caller class
(S4) are drawn.

---

## Verification backlog

- Whether the proxy library already in the dependency tree is usable in-process (D4).
- How a subscription-authenticated harness — one that authenticates with its own login and
  has no credential to inject — behaves under S1.
- What policy checks, if any, exist on each current model call site today.
- The upstream scoping of stored third-party connections, as input to D3.
