# GPT-5.6 architecture brainstorm (verbatim output)

Date: 2026-07-20. Produced by GPT-5.6 (model `gpt-5.6-sol` via the Codex CLI, read-only,
high reasoning effort) from the brief in `brainstorm-brief.md`. This is the raw output,
kept unedited as a research input; the synthesis in `../architecture.md` states where we
adopt, adapt, or reject its proposals.

---

## Recommendation

Build channels as a conversational projection over four reusable platform primitives:

1. A credentialed external endpoint.
2. A binding from that endpoint to an agent and policy.
3. A durable correlation from an external conversation to a session.
4. A surface-agnostic activity ingress/delivery pipeline.

Do not generalize triggers and channels into one lifecycle abstraction. They should share transport, identity, credential, inbox/outbox, and agent-reference machinery while retaining different binding and execution semantics.

## 1. Primitive decomposition

### Option A — Explicit conversational primitives

This is my preferred decomposition.

#### `ChannelApp`

A credentialed bot identity installed on an external platform.

```text
ChannelApp
  id
  project_id
  provider                 slack | telegram | bridge:<namespace>
  native_tenant_id         Slack workspace, Teams tenant, etc.
  native_app_id
  native_bot_subject
  credential_ref           vault reference, never secret material
  transport_profile        webhook | socket | long_poll | bridge
  status
  configuration
```

Ownership: project.

Lifecycle: provisioned, verified, enabled, rotated, disabled, deleted.

A `ChannelApp` represents the identity that sends and receives messages—not the Slack provider globally and not an individual Slack channel. Multiple apps in one workspace naturally become multiple rows.

First-party and bridge-backed apps should use the same model.

#### `ChannelBinding`

The one active relationship from a `ChannelApp` to an agent reference.

```text
ChannelBinding
  id
  channel_app_id           unique among active bindings
  agent_reference_id
  session_lifetime_policy
  invocation_policy_id
  authorization_mode       invoking_user initially
  status
```

Ownership: project.

Lifecycle: draft, active, suspended, replaced.

Use the existing latest/reference binding machinery for `agent_reference_id`. Replacing an agent version should not recreate the platform app.

Child scope rules make the binding default-deny:

```text
ChannelScopeGrant
  binding_id
  native_scope_type        workspace | channel | dm | conversation
  native_scope_id
  invocation_mode          mention | explicit_command | always
  policy_overrides
```

Although this can be a separate table, it need not initially be a major public API noun.

#### `ConversationLink`

A durable correlation between an external conversation and an Agenta session.

```text
ConversationLink
  id
  binding_id
  native_conversation_key
  native_locator           structured provider locator
  session_id
  generation
  context_kind             personal | shared
  status                   active | expired | closed | superseded
  created_at
  last_activity_at
  closed_at
```

Use a unique constraint equivalent to:

```text
(binding_id, native_conversation_key, generation)
```

The conversation key must be derived through one core function. Adapters should supply a structured locator, not independently construct session keys.

`generation` matters because session lifetime is configurable. The same Slack thread may map to session 1 this month and session 2 after expiration, while retaining historical correlation.

Permit multiple links to point at one session. That accommodates future migrations, aliases, and continuing the session from another external surface without changing the basic model.

#### `ExternalIdentityLink`

Reuse `user_identities`, but strengthen its authority key. `(method, subject)` is likely too weak for enterprise platforms.

```text
issuer
external_tenant_id
external_subject
user_id
link_method
verified_at
revoked_at
```

The authoritative tuple should be something like:

```text
(provider issuer, external tenant, immutable external subject)
```

Never authorize by email or display name.

A session message should store both:

- The resolved Agenta principal, if any.
- An immutable snapshot of the external sender and display metadata.

Display metadata is evidence and UI data, not authority.

#### `InboxEvent`

The durable, idempotent receipt of an external activity.

```text
InboxEvent
  id
  channel_app_id
  external_event_id
  conversation_link_id
  event_type
  payload
  native_occurred_at
  received_at
  ingest_sequence
  status
```

Unique on `(channel_app_id, external_event_id)`.

This is necessary even if provider SDKs already retry. It creates a stable boundary between unreliable external delivery and session mutation.

#### `Delivery`

Every outbound projection, including an approval rendering.

```text
Delivery
  id
  channel_app_id
  conversation_link_id
  source_type              record | interaction | status | error
  source_id
  operation                create | update | delete
  idempotency_key
  canonical_activity
  status
  attempt_count
  native_message_id
  native_receipt
  last_error_code
```

A delivery may have multiple attempts and one final platform receipt.

Replace the unused `delivered_webhook` boolean with a relation to deliveries. An interaction can be projected into several surfaces or re-rendered after an update; a boolean cannot represent that.

#### `DelegationContext`

This is a first-class invocation contract, though it may not require a standalone table:

```json
{
  "subject": {"user_id": "usr_123"},
  "actor": {"agent_id": "agt_456"},
  "mode": "user_delegation",
  "identity_link_id": "idn_789",
  "credential_or_grant_ref": "grant_123",
  "audience": {
    "kind": "shared_conversation",
    "conversation_link_id": "conv_123"
  }
}
```

It must be created per turn, not attached permanently to the shared session. Different team members invoking the same session must produce different authorization contexts.

### Option B — Generic integration endpoint and route

Generalize further:

```text
IntegrationEndpoint
  provider, credentials, transport, native tenant/app identity

IntegrationRoute
  endpoint -> target
  mode: event | conversation
  policy

Correlation
  external locator -> internal resource

Exchange
  inbound or outbound activity plus delivery state
```

Triggers and channels would both use these nouns.

Advantages:

- Fewer top-level concepts.
- A single extension and credential model.
- Potentially useful for email ingestion, ticketing systems, GitHub Apps, and future event sources.

Costs:

- `IntegrationRoute` quickly accumulates mode-dependent fields.
- Trigger correlation means “event caused a run”; channel correlation means “conversation owns evolving state.”
- Retry, replay, activation, version binding, and authorization rules differ substantially.
- Operators and API users see generic terms that conceal important behavior.

This can work as an internal storage/kernel model, but I would not expose it as the primary product API.

### Option C — Extend `Connection` and `TriggerSubscription`

Use the existing `Connection` as the app and add a conversational mode to `TriggerSubscription`.

This minimizes initial schema work but ranks last. It conflates:

- A user’s connection to a data provider.
- A bot installation that receives messages.
- A one-shot event subscription.
- A durable conversational route.

The resulting nullable state machine would be difficult to authorize, explain, and evolve.

### Ranking

1. Explicit `ChannelApp` + `ChannelBinding` + `ConversationLink`, backed by generic inbox/outbox infrastructure.
2. Generic integration kernel with channel-specific public APIs.
3. Extending trigger subscriptions directly.

## 2. Generalization opportunities

### Make session ingress surface-agnostic

Introduce one atomic core operation:

```text
resolve conversation
→ deduplicate external event
→ authorize sender
→ resolve/create session
→ append attributed message
→ enqueue or begin turn
```

Possible API:

```http
POST /v1/session-ingress
```

```json
{
  "source": {
    "kind": "channel",
    "endpoint_id": "app_123",
    "event_id": "Ev456"
  },
  "conversation": {
    "provider": "slack",
    "tenant_id": "T1",
    "channel_id": "C1",
    "thread_id": "1712345.0001",
    "context_kind": "shared"
  },
  "sender": {
    "provider_subject": "U1",
    "display": {"name": "Alice"}
  },
  "activity": {
    "type": "message",
    "content": [{"type": "text", "text": "Please deploy it"}]
  }
}
```

Return `202` with:

```json
{
  "disposition": "accepted",
  "session_id": "ses_123",
  "turn_id": "turn_456",
  "duplicate": false
}
```

For trusted callers that already know the session:

```http
POST /v1/sessions/{session_id}/messages:invoke
```

Both should call the same application service.

### Move transcript hydration into sessions

Server-side hydration is a prerequisite, not a channel feature. The session should own its transcript and construct execution context from stored records.

Caller-supplied history can remain as a compatibility mode, but it should not be the canonical path.

### Add structured sender and provenance to records

A record needs more than `sender_id`:

```json
{
  "sender": {
    "kind": "human",
    "user_id": "usr_123",
    "identity_link_id": "idn_456",
    "external": {
      "provider": "slack",
      "tenant_id": "T1",
      "subject": "U1"
    },
    "display": {"name": "Alice"}
  },
  "origin": {
    "surface": "channel",
    "conversation_link_id": "conv_123",
    "native_message_id": "1712345.1000"
  }
}
```

This becomes useful for web continuation, audit, evaluation, exports, and multi-user sessions generally.

### Add a session mailbox

The likely missing runtime primitive is not a Slack adapter; it is durable session scheduling.

A shared thread can receive another message while:

- A run is streaming.
- An approval is pending.
- A prior inbound message is still queued.
- Two users mention the agent nearly simultaneously.

Each session needs an ordered mailbox with explicit policy:

```text
serialize | queue | coalesce | reject | interrupt
```

MVP should probably serialize accepted user activities per session. Do not let each adapter invent concurrency behavior.

### Generalize the outbound activity projection

Keep the raw SSE frame stream, but derive a smaller typed activity stream for external surfaces:

```text
message
status
tool_activity
interaction
result
error
```

Avoid exporting hidden chain-of-thought as a `thought` activity. A `status` or curated progress summary is safer and portable.

Adapters render these activities according to capabilities. The web app can consume the same projection.

### Keep triggers and channels as siblings

They should share:

- Credential references.
- External endpoint registration.
- HMAC/replay protection.
- Durable inbox and outbox.
- Retry and delivery logs.
- Agent/workflow references.
- Trace and audit envelopes.

They should not share one subscription state machine.

```text
TriggerSubscription:
  external event -> one workflow invocation

ChannelBinding:
  external conversation -> durable session and repeated turns
```

### Reuse webhook delivery infrastructure, not webhook semantics

Channel sends are addressed commands with receipts, not broadcast webhook events. Reuse the retry engine, signing, outbox, and logs; create channel-specific delivery records and policies.

## 3. Extension wire contract

### Preferred topology: bridge dials Agenta

The default bridge transport should be a long-lived outbound WSS connection:

```text
Third-party bridge ──WSS──> Agenta channel gateway
```

This supports egress-only deployments, bidirectional commands, reconnect/resume, and fast acknowledgement.

Also offer an HTTP profile for environments that prefer webhooks:

```text
POST bridge -> Agenta ingress
POST Agenta -> bridge delivery endpoint
```

Both profiles carry the same envelopes.

### Envelope

Use CloudEvents 1.0 as the outer envelope and define Agenta channel activities as the data schema.

```json
{
  "specversion": "1.0",
  "id": "wecom:event:98234",
  "source": "agenta-channel://bridge/acme-wecom/install-123",
  "type": "io.agenta.channel.message.received.v1",
  "subject": "conversation/group-456",
  "time": "2026-07-20T10:00:00Z",
  "datacontenttype": "application/json",
  "traceparent": "00-...",
  "data": {}
}
```

Useful event types:

```text
message.received
message.updated
message.deleted
reaction.received
interaction.responded
membership.changed

delivery.requested
delivery.accepted
delivery.succeeded
delivery.failed

checkpoint.committed
installation.status_changed
```

### Canonical activity

Keep the content vocabulary deliberately small:

```json
{
  "conversation": {
    "id": "group-456",
    "thread_id": "thread-789",
    "kind": "group"
  },
  "sender": {
    "id": "native-user-1",
    "kind": "human",
    "display_name": "Alice"
  },
  "activity": {
    "type": "message",
    "content": [
      {"type": "text", "text": "Can you check this?"},
      {
        "type": "attachment",
        "media_type": "image/png",
        "asset_ref": "asset-123"
      }
    ],
    "mentions": [
      {"kind": "app", "id": "native-bot-1"}
    ]
  },
  "native": {
    "message_id": "msg-98234",
    "occurred_at": "2026-07-20T09:59:59Z"
  }
}
```

Platform-specific data should use named, versioned extensions:

```json
{
  "extensions": [
    {
      "schema": "urn:example:wecom:quoted-message:v1",
      "data": {}
    }
  ]
}
```

Do not provide an unrestricted `metadata` or `channelData` bag that core logic quietly begins depending on.

### Capability declaration

On connection:

```json
{
  "type": "bridge.hello",
  "protocol_versions": ["1.1", "1.0"],
  "bridge": {
    "name": "acme-wecom",
    "version": "2.3.0"
  },
  "capabilities": {
    "threads": true,
    "message_update": true,
    "message_delete": false,
    "buttons": true,
    "selects": false,
    "files": {
      "receive": true,
      "send": true,
      "max_bytes": 20971520
    },
    "text": {
      "format": "markdown_subset",
      "max_chars": 4096
    },
    "delivery_receipts": true
  }
}
```

Capabilities should be data and contract-tested. Core selects a supported rendering; the bridge does not dictate approval semantics.

### Delivery command

```json
{
  "specversion": "1.0",
  "id": "delivery-command-123",
  "type": "io.agenta.channel.delivery.requested.v1",
  "source": "agenta://project/prj-1",
  "subject": "conversation/group-456/thread-789",
  "data": {
    "idempotency_key": "interaction:int-1:revision-2",
    "operation": "create",
    "activity": {
      "type": "interaction",
      "content": [{"type": "text", "text": "Approve deployment?"}],
      "actions": [
        {"id": "approve", "label": "Approve", "style": "primary"},
        {"id": "reject", "label": "Reject", "style": "danger"}
      ]
    }
  }
}
```

The result must include the native platform identifier:

```json
{
  "type": "io.agenta.channel.delivery.succeeded.v1",
  "data": {
    "command_id": "delivery-command-123",
    "native_message_id": "platform-msg-999"
  }
}
```

### Delivery and ordering rules

- Delivery is at-least-once.
- Every inbound event has a stable external event ID.
- Every outbound command has an idempotency key.
- Ordering is guaranteed only per conversation, never globally.
- Core assigns `ingest_sequence` after durable acceptance.
- Updates and deletes reference the original native message ID.
- The session mailbox determines execution order.
- Acknowledgement is two-stage: durable acceptance, then eventual delivery result.
- Reconnecting bridges resume from a core-owned cursor/checkpoint.
- Long-poll offsets should be checkpointed in core so bridges can remain replaceable.

### Authentication

Support:

- Scoped bridge bearer credentials.
- mTLS for managed enterprise deployments.
- Rotation with overlapping credential validity.
- HTTP message signatures for the HTTP profile.
- Installation-specific authorization: one bridge must not impersonate another installation.

The bridge credential authorizes transport. It does not authorize the external human. Human authorization comes from deterministic identity resolution on every invocation or approval response.

### Standards to adopt or imitate

Adopt:

- CloudEvents for envelopes.
- W3C Trace Context.
- AsyncAPI for protocol documentation.
- A standard HTTP signature scheme for webhook mode.

Borrow selectively:

- Matrix Application Service transaction IDs, batching, and replay behavior.
- Bot Framework Activity’s conversation reference and small activity vocabulary.
- Direct Line’s cursor/watermark and reconnect model.

Do not adopt wholesale:

- Bot Framework Activity: too broad and dependent on `channelData`.
- Matrix: excellent federation model, excessive as Agenta’s internal conversation model.
- ActivityPub: optimized for federated publication, not authorized agent invocation.

## 4. Enterprise posture that affects the primitives

### Represent subject, actor, and audience separately

Every turn and audit event needs:

```text
subject: user whose authority is being exercised
actor: agent performing the action
audience: people allowed to receive the result
```

“Agent X acting for user Y in shared conversation Z” must be representable everywhere.

### Add visibility and provenance now

To accommodate the fixed group-disclosure rule, context and results need machine-readable visibility:

```text
conversation_visible
user_private
restricted_to_principals
service_internal
```

Tool outputs should carry their authorization source and visibility. Derived output needs conservative propagation or an explicit release check.

MVP may reject private-resource use in group conversations, but without provenance fields the eventual policy cannot be implemented reliably.

### Authorize every interaction response independently

Approval buttons are presentation only. On click:

1. Verify platform authenticity and replay protection.
2. Resolve the clicking platform subject.
3. Re-evaluate the interaction’s approver policy.
4. Record subject, actor, audience, decision, and native event.
5. Atomically consume or update the interaction.
6. Resume the run.

Never treat possession of a callback value as authorization.

### Make scope default-deny

A valid app credential must not imply permission to answer everywhere the app is installed. `ChannelScopeGrant` should be explicit and auditable.

### Pin egress to the originating conversation

The agent runtime should never select platform credentials or destination IDs. It emits an activity against a conversation link; the channel gateway resolves the credential and native destination.

### Design deletion and revocation semantics

Deleting an identity link, disabling an app, removing a channel grant, and deleting a user should have explicit effects on:

- Future invocations.
- Pending approvals.
- Queued deliveries.
- Existing session history.
- Audit retention.

Use tombstones where audit requirements prohibit hard deletion.

## 5. Blind spots and likely future failures

### The session mailbox is easy to miss

Concurrency, pending approvals, edits, and rapid team messages will expose it immediately. Treat scheduling as a core session concern.

### A “conversation” is not always a thread

Email forks, Teams conversation references, Slack thread roots, Telegram topics, and message migrations differ. Store structured native locators and aliases, not a single `thread_id` string.

### Membership changes after context is created

The current channel membership and the audience when a message was produced may differ. Store audience snapshots where required, while consulting live membership for new disclosures.

### Edits and deletions cannot simply mutate history

Agent context may already have consumed the original message. Preserve an append-only event trail and expose corrected projections rather than silently rewriting audit history.

### Files need a separate security boundary

Do not pass platform download URLs or credentials into the sandbox. The gateway should fetch, scan, minimize, store, and issue a scoped asset reference.

### Bot loops and synthetic users

Adapters must identify bot-authored messages and the local app identity. Core should have loop detection and explicit policies for bot-to-bot messages.

### Progress is not chain-of-thought

External activity streams should contain curated status and tool events, not private model reasoning.

### The likely two-year mistake

The greatest risk is treating channels as request/reply chat adapters. Messaging surfaces are evolving activity systems with edits, reactions, files, forms, membership, delayed delivery, and asynchronous workflows.

Make `Activity`, `ConversationLink`, `InboxEvent`, and `Delivery` the stable core. Slack-specific messages should remain projections at the edge.
