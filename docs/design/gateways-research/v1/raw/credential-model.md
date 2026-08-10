# Credential model: what the gateway hides, and what it cannot

The goal is a gateway that is as transparent as possible: the caller presents one
credential — ours — and the gateway works out what the upstream needs and supplies it. This
document states how far that goal reaches and where it stops.

## The caller's side is uniform, always

Whatever the upstream needs, the caller sends the same thing: a gateway URL, a token minted
by us, and optionally non-secret headers. The caller never learns whether the server behind
it uses a static key or OAuth, never holds an upstream credential, and never changes shape
when an upstream server switches auth scheme.

This holds for both planes. A model route and an MCP route differ in protocol, not in how
the caller authenticates to us.

One consequence worth naming: the runner wire's per-server `credentials` array collapses to
a single gateway token. The typed secret-header machinery on the wire stops carrying
upstream secrets, because there are none to carry.

## Two axes, not one

"API key or OAuth" is the axis people reach for first, and on its own it is wrong. It
conflates two independent properties:

| | **Static credential** | **OAuth** |
|---|---|---|
| **Shared** (org/project owns it) | operator API key — a service the org calls as itself | rare, but real: a shared workspace grant |
| **Per-user** (each user has their own) | personal access token — common, and often mistaken for "shared" | the standard case: acting as the user in their own account |

A static credential is **not** automatically shared, and OAuth is **not** automatically
per-user. Personal access tokens are static and per-user; some OAuth grants are
organizational. If the model has one axis, per-user PATs end up either wrongly shared or
wrongly forced through an OAuth path they do not need.

So a registry entry carries both: **how** to authenticate (`static` | `oauth`) and **who
owns** the resulting credential (`shared` | `per_user`). The gateway needs both to pick a
credential: the first says what to do, the second says whose to look up, keyed against the
`AuthScope` already present on every call.

**Status of each axis.** The auth-scheme axis already exists in the codebase — see
`existing-gateway-model.md` — so it is not a proposal. The ownership axis does **not**:
connections and secrets are project-level today, which means every entry is effectively
`shared`. User-level credentials are a wanted later addition for user-specific model and MCP
authentication.

The design consequence is narrow but important: **the credential lookup should take the
owner as a parameter from the start**, and answer "the project" for now. Retrofitting a
per-user dimension into a lookup that assumes the project is the expensive version of that
change. Nothing on the caller side needs to wait, since `AuthScope` already carries the user
on every call.

## What the gateway handles without anyone noticing

Once a credential exists, everything is invisible to the caller:

- Selecting the right credential for this principal and this upstream.
- Injecting it in whatever form the upstream wants — header, bearer token, signed request.
- Refreshing an expired OAuth access token and retrying.
- Retrying transient upstream failures.
- Enforcing the tool allowlist and the policy checks before anything leaves.
- Recording the call against the principal for audit and metering.

This is the steady state, and it is the overwhelming majority of calls. For this part the
transparency goal is fully achievable.

## What the gateway cannot hide

**Consent needs a human, once.** A three-legged OAuth grant requires a person in a browser
approving access. The gateway can store the result forever and refresh it indefinitely, but
it cannot mint the first token by itself, and no amount of internal configuration changes
that. Transparency on the consent path is not achievable — only *relocatable*.

There are exactly two moments this bites:

1. **First use.** No credential exists for this owner and this server.
2. **Step-up.** A credential exists, but the specific call needs a permission the owner
   never granted. The current MCP revision specifies this precisely: the server answers
   `403` with `insufficient_scope` and the scopes it needs, and the client is expected to
   re-authorize with the union of old and new scopes. So "already connected" does not
   guarantee "will not need a human again."

Everything else about OAuth — refresh, expiry, retry, storage, audience binding — the
gateway absorbs.

### How often is "once"

Consent is per **credential owner**, which the ownership axis already defines: once per
(user, upstream) for a `per_user` entry, once per (project, upstream) for a `shared` one.
A `shared` entry means one person consents and the whole project inherits it; a `per_user`
entry means every member consents for themselves, and an admin cannot do it on their
behalf.

Two details make the count less tidy than "once":

- **Consent and tokens are counted differently.** Tokens are audience-bound — each is
  minted for one specific server URI — so storage is keyed per (owner, server). But a
  single human interaction at an authorization server can yield tokens for several
  resources it governs. So a vendor running several MCP servers behind one authorization
  server may cost one consent and several stored tokens.
- **Step-up adds moments after the first.** The required scopes for a call may be
  determined dynamically from the request's own arguments, so they cannot always be known
  in advance.

## Open questions

### Q1. Where does consent happen? — largely settled

**In the dashboard, before a run.** Connecting a server is a management action, not a
runtime one. A run that reaches an unconnected server fails with something actionable, the
user connects in the dashboard, and re-runs. This matches how connections already work and
keeps runs free of browser interactions.

Two consequences to design for rather than decide:

- A `per_user` entry means the dashboard needs a per-user connection view, and a project's
  agent is not usable by a new team member until that member connects for themselves. An
  admin cannot pre-connect on their behalf. This is an onboarding step, and it should be
  visible as one.
- Runs need a pre-flight check. If the gateway can tell before starting that a required
  server has no live credential for this user, the run should fail immediately with the
  list of servers to connect, rather than part-way through when the agent first reaches for
  a tool.

**What is still open is step-up**, because required scopes can depend on a call's own
arguments and so cannot always be pre-granted. Three ways to handle it:

1. **Over-request at connect time** — ask for the server's full advertised scope set in the
   dashboard, so step-up almost never fires. Trades least privilege for uninterrupted runs.
2. **Fail actionably** — treat a scope challenge like an unconnected server: fail the call,
   name the missing permission, send the user to the dashboard to re-consent.
3. **Pause mid-run** — the approval machinery and the protocol's input-required pattern
   could carry it, at the cost of a different run lifecycle.

The specification recommends least privilege with incremental step-up, which is option 2 or
3. For an agent platform, option 1 is the pragmatic default and can be reconsidered per
server. Worth an explicit decision rather than a default.

### Q2. One endpoint or one per server?

Either the gateway exposes a single endpoint whose tool list is the merge of every
registered server's tools, with names namespaced per server to avoid collisions, or it
exposes one endpoint per registered server.

Header-based routing makes the merged endpoint cheap to implement — the target rides a
header, so routing needs no body parsing. But the merged list has to be namespaced, and
namespacing changes the tool names the model sees, which affects prompts and any
per-tool permission rules. One endpoint per server avoids renaming entirely at the cost of
more configuration.

### Q3. Whose credential, when the entry says `per_user`?

Settled in shape by the two axes above, but the product question remains: is per-user the
default, with shared as the exception, or the reverse? This decides the migration story for
every connection that exists today.

### Q4. What does a self-hoster behind a firewall do?

To complete an OAuth flow the gateway needs a publicly reachable redirect URI, and to use
the modern registration mechanism it needs a public HTTPS URL serving its client metadata.
A self-hosted deployment with no public address cannot do either.

Static-credential servers are unaffected, which means the honest self-hosted story may be
"static credentials work everywhere; OAuth needs a reachable deployment." That is a
documentation and packaging decision as much as a design one.

### Q5. What does the caller see when a credential is dead?

A revoked or unrefreshable token has to surface as something a human can act on, not a
generic upstream error. Related: does a dead credential remove that server's tools from the
list, or leave them present and failing? Removing them is kinder to the model's context but
makes the tool list vary by credential health.

## Summary

The gateway is fully transparent on the **data path** and cannot be transparent on the
**consent path**. Every design choice above is really a choice about where to put the
consent moment, not whether to have one.
