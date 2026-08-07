# Channels v2

Design for Slack, Telegram, Discord, Teams, and WhatsApp agents, verified
against both the Agenta codebase and the six target platforms.

**Status: draft for review.** The decisions are settled. Slack is the first
channel and the bridge is proved against it; what remains open is which channel
follows, and when the runner takes the input-sequencing work that channels ships
without.

## Posture

Five claims anchor the design and constrain everything downstream of them:

1. **Egress-only is not Agenta's posture.** Public HMAC-verified webhook
   receivers already exist and are already routed (Composio, Stripe). Ingress
   is a plain HTTP route, not Socket Mode or a separate always-on gateway
   service.
2. **Approvals are not a subsystem.** Interactions travel as ordinary events on
   the response stream, and answers arrive as ordinary messages.
3. **One app is not one agent.** The app is a transport; it does not constrain
   the gateway-bot shape the product wants.
4. **Session lifetime is not a TTL.** It is a scope, and a user gesture.
5. **There is no `sender` field.** Attribution is formatting at the boundary
   plus the existing `created_by_id`.

The design itself is smaller, not larger: an ingress route, two workers, seven
tables plus one reused, and a capability-declaring adapter per platform.

## Reading order

1. **`decisions.md`** — what is settled, and the rationale load-bearing enough
   to constrain future work. Everything else assumes these.
2. **`architecture.md`** — the shape: boundaries, the two mappings, and the path
   a message takes in each direction.
3. **`entities.md`** — the data model and its full stack, layer by layer
   (dbas, dbes, dtos, types, models, daos, services, routers).
4. **`capabilities.md`** — what every adapter declares, and how core uses it to
   decide what is offerable.
5. **`contract.md`** — the wire contract for out-of-process bridges.
6. **`channels.md`** — everything platform-specific: per-channel behaviour, use cases,
   and how each degrades. The other documents stay platform-neutral by pushing
   their platform facts here.
7. **`plan.md`** — the work packages and what depends on what. No sizing, no
   schedule.
8. **`notes.md`** — replaced designs and open observations. Read it only when a
   shape here looks wrong and you want to know whether it was already tried.
9. **`workstreams/`** — one `specs-wp{k}.md` and `tasks-wp{k}.md` per package, so
   a package can be handed to someone with no context beyond this folder. Its
   `README.md` carries the file-ownership table and the parallel-work rules.
10. **`findings.md`** — the open defects and gaps found while building, with the
    evidence for each. Written during development, not after: a cross-package
    seam that nobody records is one that gets rediscovered at the next merge.

**Every document except `decisions.md` and `notes.md` states only what is.** They
carry no history and no record of alternatives: a shape that was proposed and
replaced lives in `notes.md`, and rationale that constrains future work lives in
`decisions.md`.

## Scope

In: Slack as the first channel, built in process and then run again behind the
bridge to prove the wire contract against a known-good reference; Telegram,
Discord, Teams and WhatsApp modelled and verified in `channels.md` as follow-ups;
Linear studied as the reference for how a well-designed surface behaves.
Third-party surfaces via the bridge contract.

Out: cross-channel shared sessions (deliberately — see `architecture.md`), retention
(Agenta has no operational retention today; channels inherits that and is likely
to be what eventually forces it), and the runner-side input sequencing work,
which is a separate package this design depends on but does not specify.
