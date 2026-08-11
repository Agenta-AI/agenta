# Gateways: work packages

Assumes the rest of `v1/`. Packages, not a schedule — no sizing, and no sequencing beyond
what the dependencies force.

A package is a unit that can be built, reviewed and merged on its own. Where two packages
could be one, they are split if they can land independently or belong to different owners.

**Status: candidate packages.** The set below is a proposal and will not survive contact with
`entities.md` and `policy.md` unchanged.

The two questions that previously gated it are now answered (`raw/model-call-sites.md`): there
are four model call paths, three of them in one SDK file, and the routing library runs
in-process, so the model plane is a library integration rather than a service.

Two consequences for the packages below: the model north port needs an **embeddings** route as
well as chat, and the `llm_v0` handler's module-level key assignment must be converted before
anything shares a process.

---

## Prerequisite: the seed

Interfaces land first, on the base branch, before any package starts — the credential
resolution signature, the adapter ports, the domain exceptions — all declared and all
unimplemented. Every worktree branches from that commit so interface dependencies do not
serialise the work.

This is the one thing that must be right before anything begins, because every package
inherits it. The **credential lookup signature** is the critical part: it must take the owner
as a parameter from the outset even while the only answer is the project.

---

## Candidate packages

### WP0 — Secret kinds

The two new kinds and their stack: enum values, settings DTOs and wrappers, union arms,
validator branches. No gateway code.

**Depends on:** nothing. **Blocks:** WP2, WP3.
**Done when:** both kinds round-trip through the secrets service encrypted, and an invalid
payload for either kind is rejected by the validator rather than persisted.

### WP1 — Credential resolution

The resolve function and its three modes, returning credential, owner and payer. Pure logic
over the secrets service, so it is fully unit testable — and it must be, because the
interesting cases are the failures: a required user credential absent, a project-only entry
with a user credential present, and neither present.

**Depends on:** WP0. **Blocks:** WP2, WP3.
**Done when:** each mode resolves as specified, failures surface as the existing needs-input
or needs-auth states naming the missing owner, and no path silently returns no credential.

### WP2 — MCP server registry and the client

The registry, its stack, and the SDK's OAuth client wired to a storage adapter over the
secrets service, with the connect callbacks pointed at the dashboard flow rather than a local
browser.

**Depends on:** WP0, WP1. **Blocks:** WP4.
**Done when:** a static-credential server and an OAuth-protected server both register,
connect, list tools and execute one, and a refresh happens without user interaction.

### WP3 — Model plane domain

The domain the codebase does not have: ports, registry, service, and the provider-settings
builder moved out of the SDK.

**Depends on:** WP1. **Blocks:** WP5.
**Done when:** every provider and deployment pair reachable today is reachable through the
domain, including the cloud-reseller credential shapes, with the endpoint guard preserved.

### WP4 — Tool north port

The MCP surface: routing on headers, allowlist enforcement, list composition.

**Depends on:** WP2, and the endpoint-shape decision. **Blocks:** nothing.

### WP5 — Model north port

The OpenAI-compatible surface, including streaming.

**Depends on:** WP3, and the in-process question. **Blocks:** nothing.

### WP6 — Policy core

Identity threading, the authorization calls, the audit record, the meter keys, and decision
caching.

**Depends on:** WP1. **Blocks:** nothing, but every other package is incomplete without it.
*This one is least specified and most likely to split.*

### WP7 — Caller conversion

One package per caller class, converting each to transit the gateway. **Cannot be scoped
until the call-site count exists.**

### WP8 — Owner dimension

User-level credentials: the secrets service change, the lookup answering something other than
the project, and the dashboard's per-user view.

**Depends on:** WP1. **Explicitly not scheduled** — designed so that it is additive when
wanted.

---

## Integration checkpoints

*To establish.* Channels used checkpoints as the moments the system does something
end-to-end, distinct from packages. The equivalents here are probably: one static-credential
MCP server works end to end; one OAuth server works including refresh; one model call transits
the gateway; the first caller is fully converted; every caller is converted and the direct
path can be removed.

The last is the only one that makes the transit rule true, and it should be named as such.

---

## Not packages

- The tool catalog. Settled as out of scope.
- Triggers. A separate subsystem for structural reasons.
- Retention. Real, flagged in `entities.md`, and larger than this design.
