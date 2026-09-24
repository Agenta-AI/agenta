# Brainstorm brief: channel primitives for Agenta

This is the input brief given to GPT-5.6 (via the Codex CLI) for a divergent
architecture brainstorm. Its output is in `gpt56-brainstorm.md`.

## Context

Agenta is an open-source, self-hostable LLM engineering platform (FastAPI backend,
Next.js frontend, Python SDK). It has an agent runtime: agents run in sandboxes,
sessions are server-side objects (streams of turns; turns contain records; special
records called interactions represent approvals), the wire format is an SSE frame
stream, and approvals are durable addressable objects with a respond endpoint that
resumes the run. We are designing a "channels" feature: connect an agent to
messaging surfaces (Slack first, Telegram second, then Teams/Discord/email, with
Chinese platforms like WeCom/Feishu via third-party extensibility). An @mention in
a channel opens a session; the thread maps to that session; the whole team writes
into it; the same session can be continued from the web app; approvals render as
buttons in the channel.

## Fixed product decisions (do not relitigate)

1. A group thread gets ONE shared session with per-message speaker attribution.
2. The agent acts with the INVOKING USER's permissions (per-user account linking
   between channel identity and Agenta identity). Architecture must keep the door
   open for agent-own-identity and service-account modes later.
3. One platform app = one agent (bot identity). Multiple apps per workspace must
   be supported. Self-hosted users always create their own platform apps (bring
   your own app); cloud may ship a ready-made app.
4. DMs allowed. DM = personal context; channel = shared context.
5. Session lifetime is a config setting, not a design fork.
6. Group-visible replies must never use resources only one member may access
   (rule out of MVP scope, but the architecture must accommodate it).

## Existing primitives to build on (from our codebase audit)

- Sessions: server-side streams/turns/records; external callers can already post
  a message into a session and trigger a turn via `/invoke` with a session id and
  a project credential. Missing: server-side context hydration from stored
  transcript (currently the caller ships history), and a `sender` field on
  records (speaker attribution).
- Approvals: durable interaction objects; `POST .../interactions/{id}/respond`
  resumes the run server-side. An unused `delivered_webhook` flag exists.
- Outbound webhooks: subscription registry, HMAC signing, retries, delivery logs.
  Adding new event types is cheap.
- Ingress precedent: a Composio trigger receiver (public path, HMAC verify with
  replay protection, 202-accept, queue, dispatcher builds a workflow request).
- Identity: `user_identities` table maps `(method, subject) -> user_id`; built
  for exactly this kind of external-identity linking. Per-user project API keys
  are today's only delegation primitive; an internal short-lived JWT exists
  without a public minting path.
- Connections: a `ConnectionsService` with provider kinds `composio | agenta`;
  the native (`agenta`) slot is unimplemented. Secrets are project-scoped in a
  vault.
- Reference/latest-binding: `TriggerSubscription` binds an external event source
  to a workflow revision by reference. Channels need a sibling ("this channel app
  drives this agent"), not an extension (triggers fire one run; channels converse
  in a session).

## Patterns extracted from research (competitors, OSS gateways, integration SDKs, enterprise)

- Everyone converges on: thread = session; mention gating; thread-scoped context;
  normalized message schema (small type vocabulary) + per-channel translator +
  channel-native escape hatch; session keyed by (channel instance, native
  conversation id) through ONE core function; fast ack (10s SLO); typed activity
  stream for progress (Linear's thought/action/elicitation/response/error is the
  best reference).
- Adapter contract: record of optional declared facets (capabilities as data,
  contract-tested) beats fat base classes. Every send returns a receipt with the
  platform message id. Closed error vocabulary (forbidden, rate_limited,
  too_long). Named escape hatches, not open bags.
- Extensibility: the winning third-party story for self-hosted products is a
  versioned WIRE contract (Chatwoot API channel, Direct Line), not code plugins:
  a bridge is a small stateless service the user runs; additive schema evolution
  (senders may add, receivers must ignore); bundled first-party channels should
  eat the same contract. In-process plugins (OpenClaw npm + peer deps) work but
  are RCE-equivalent trust.
- Approvals: core owns the approval state machine and a shared callback grammar;
  adapters only render (buttons where possible, text fallback); who-may-approve
  is authorized separately from rendering.
- Enterprise: egress-only transports (Slack Socket Mode, Telegram long polling)
  as default; Teams is the exception needing public HTTPS; bring-your-own-app =
  tokens never touch the vendor; channel tokens in the existing secrets
  subsystem with rotation; credentials never inside the agent execution context
  (gateway holds tokens, pins replies to the originating thread); identity
  mapping is deterministic code, checked per-invocation against the IdP; audit
  events carry subject + actor (agent X for user Y); default-deny (no agent
  answers anywhere until explicitly bound); content minimization.

## What we want from you (divergent brainstorm, not review)

You are especially good at architecture and standard, reusable design components.
Push us toward general primitives, not point solutions.

1. **Primitive decomposition.** Propose the minimal set of first-class nouns
   (e.g. ChannelApp? Connection? Binding? ConversationLink? IdentityLink?
   Delivery?) with ownership, lifecycle, and relations. Where should each live
   given the existing primitives above? Offer at least two alternative
   decompositions and argue the trade-offs.
2. **Generalization opportunities.** Which existing Agenta APIs should become
   more general instead of channels adding parallel machinery? (e.g. should
   "post into a session from an external surface" become a first-class
   surface-agnostic API? Should triggers and channel bindings share a
   "subscription" abstraction or stay siblings?)
3. **The extension wire contract.** Sketch the bridge protocol for third-party
   channels (self-hosted users adding WeCom/Feishu without touching core):
   direction of connections (bridge dials out vs receives webhooks), event
   shapes, capability declaration, versioning, auth, idempotency, ordering.
   Name any existing standards worth adopting or imitating outright (Matrix
   application services? Bot Framework Activity? CloudEvents? anything else).
4. **Enterprise posture.** Anything in the primitive design itself (not ops)
   that a CISO review would force us to redo if we get it wrong now.
5. **Blind spots.** Alternative decompositions or prior art we have not
   considered; the standard component we would regret not using; the part of
   this design most likely to be wrong in two years.

Be concrete: name the nouns, sketch the tables/endpoints/payloads where useful,
and rank options. Terse is fine; completeness over polish.
