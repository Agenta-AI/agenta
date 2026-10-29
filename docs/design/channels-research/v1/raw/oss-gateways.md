# Open-source channel gateways: adapter architecture deep dive

> Research date: 2026-07-20. All claims below were verified against source code on the
> projects' default branches on this date unless marked **[unverified]**. File paths refer
> to paths inside each project's repository.

This document studies four open-source projects that all solve the same problem Agenta's
channels feature must solve: connect an AI agent (or a message pipeline) to many chat
platforms (Slack, Telegram, WhatsApp, WeCom, ...) behind one interface, key conversations
into sessions, and let the community add platforms the core team cannot build or test
themselves. The four projects were chosen because they represent four distinct
architectural answers:

| Project | What it is | Language | License | Stars (2026-07) |
|---|---|---|---|---|
| [LangBot](https://github.com/langbot-app/LangBot) | Production IM-bot platform (the Dify-endorsed gateway); bots × pipelines × adapters | Python | Apache-2.0 | ~17k |
| [matterbridge](https://github.com/42wim/matterbridge) | Veteran chat *bridge* (relays messages between ~30 protocols, no AI) | Go | Apache-2.0 | ~7.5k |
| [OpenClaw](https://github.com/openclaw/openclaw) | Personal AI assistant with ~25 bundled chat channels and a plugin ecosystem | TypeScript | MIT | ~380k |
| [Hermes Agent](https://github.com/NousResearch/hermes-agent) | Nous Research's personal agent; CLI + gateway serving many messengers | Python | MIT | ~217k |

All four licenses (Apache-2.0, MIT) permit Agenta to vendor code, imitate interfaces, or
port designs, including into a commercially licensed product, provided attribution/notice
obligations are met. Interface shapes themselves are not copyrightable in any practical
sense relevant here; imitating any of these contracts is safe.

Terminology used throughout:

- **Adapter** (also "bridge", "platform", "channel plugin" depending on project): the
  per-platform code that translates between a platform's native API and the host's
  normalized message model.
- **Normalization**: converting platform-native events/messages into one shared internal
  shape, and back on send.
- **Session keying**: the rule that maps an inbound message's (platform, chat, thread,
  user) coordinates onto a conversation/session identifier.
- **In-process plugin**: adapter code loaded into the host process (shared memory, shared
  crash domain). **Out-of-process adapter**: a separate program that talks to the host
  over a wire protocol (HTTP/WebSocket), so it can be written in any language and
  deployed/versioned independently.

---

## 1. LangBot

LangBot (formerly QChatGPT) is the closest of the four to Agenta's shape: a hosted
platform where a user configures **bots** (a platform account + adapter + config) and
**pipelines** (the message-processing chain that calls the LLM/agent), and the platform
routes inbound messages from bots into pipelines. Its README markets exactly the surface
Agenta wants: Discord / Slack / LINE / Telegram / WeChat (personal + WeCom + Official
Account) / Feishu / DingTalk / QQ / Matrix.

### 1.1 The adapter contract

The base class lives in a separately versioned SDK package, `langbot_plugin`
([langbot-app/langbot-plugin-sdk](https://github.com/langbot-app/langbot-plugin-sdk),
`src/langbot_plugin/api/definition/abstract/platform/adapter.py`). This is a deliberate
choice: the adapter interface and the entity types it speaks are published as a pip
package, so adapter code (and plugins) depend on a versioned contract, not on LangBot
internals.

`AbstractMessagePlatformAdapter` (a pydantic model + ABC) has this surface:

- `send_message(target_type: str, target_id: str, message: MessageChain)` — proactive
  send; `target_type` is `"person"` or `"group"`.
- `reply_message(message_source: MessageEvent, message: MessageChain, quote_origin: bool)`
  — reply in the context of an inbound event.
- `reply_message_chunk(message_source, bot_message, message, quote_origin, is_final)` —
  streaming reply (non-abstract; default raises). Paired with
  `is_stream_output_supported() -> bool`, the **only formal capability probe in the v1
  contract** — everything else is duck-typed (see below).
- `create_message_card(message_id, event)` — optional; used by platforms with card
  messages (Feishu/DingTalk-style); default returns False.
- `register_listener(event_type, callback)` / `unregister_listener(...)` — the host
  subscribes to typed events (`FriendMessage`, `GroupMessage`, `FeedbackEvent`); the
  adapter fires callbacks. Inbound is push-based via listener registration, not a queue.
- `run_async()` — the adapter's long-running loop (polling or webhook server).
- `kill()` — shutdown; returning False vetoes hot-reload of the adapter.
- `is_muted(group_id)` — platform-specific moderation probe, default False.

Two converter base classes formalize normalization *inside* each adapter:
`AbstractMessageConverter` and `AbstractEventConverter`, each with static
`yiri2target(...)` and `target2yiri(...)` methods ("yiri" is the internal name for the
normalized model, inherited from the mirai/YiriMirai QQ-bot lineage). The normalized
message model is a **MessageChain**: an ordered list of typed segments (`Plain`, `At`,
`AtAll`, `Image`, `Voice`, `File`, `Quote`, `Face`, `Forward`, `Source`, `Unknown`) —
mirai's design, and a good one: mentions, quotes, and media are structured components,
not markdown conventions.

Notably absent from the contract: edit, delete, reactions, threads, buttons. Those exist
only inside individual adapters (e.g. Telegram inline keyboards for streaming) and do not
escape to the pipeline. This is the v1 contract's main weakness and the reason for the
EBA redesign (§1.4).

### 1.2 Registration, config schema, and how adapters ship

Each built-in adapter is one `.py` + one `.yaml` manifest + one icon in
`src/langbot/pkg/platform/sources/` (e.g. `telegram.py` + `telegram.yaml`). The manifest
is a Kubernetes-style document:

```yaml
apiVersion: v1
kind: MessagePlatformAdapter
metadata:
  name: telegram
  label: { en_US: Telegram, zh_Hans: 电报, ... }   # i18n at the manifest level
  icon: telegram.svg
spec:
  categories: [popular, global]
  help_links: { zh: ..., en: ... }
  config:
    - name: token
      type: string
      required: true
    - name: enable-stream-reply
      type: boolean
      default: false
execution:
  python: { path: ./telegram.py, attr: TelegramAdapter }
```

`spec.config` is a typed form schema; the dashboard renders adapter config forms
generically from it (`DynamicFormComponent`), so adding an adapter requires **zero
frontend work**. A discovery engine (`src/langbot/pkg/discover/engine.py`) recursively
scans manifest directories, tags each component with an `owner` (`builtin` by default),
and `PlatformManager` (`src/langbot/pkg/platform/botmgr.py`) builds
`adapter_dict[name] -> adapter class` from all components of kind
`MessagePlatformAdapter`. Bots are DB rows (`adapter` name + `adapter_config` JSON);
loading a bot instantiates `adapter_class(bot_entity.adapter_config, logger)`.

How community adapters get added: **in-tree, by PR** — the manifest+file convention plus
the discovery engine makes each adapter a self-contained drop-in directory entry, and the
repository carries an in-repo skill (`skills/skills/langbot-eba-adapter-dev/SKILL.md`)
that is effectively a contributor runbook for writing and *acceptance-testing* an
adapter. There is no mechanism for a third-party pip package to register a platform
adapter without a PR **[unverified — no such loading path was found in the discovery
engine; the plugin runtime registers tools/commands/events, not platform adapters]**.
The out-of-process escape hatches are §1.5.

A telling detail in `botmgr.py`: the host probes adapters with `hasattr` for optional
extensions (`get_launcher_id(event)` to override session keying, `set_bot_uuid(...)` for
the unified webhook router, `handle_unified_webhook(...)`). Optional capability grew by
duck typing because the ABC could not be extended without breaking existing adapters —
the standard failure mode of a minimal base class in a growing system.

### 1.3 Session keying: launcher model + scope templates

LangBot's concept ladder (documented in `docs/review/box-session-scope.md`):

```
Platform message
  → Query        (query_id: int, one per inbound message)
    → Session    (launcher_type + launcher_id — one per chat window)
      → Conversation (uuid — one dialogue context within a Session)
```

- `launcher_type` ∈ {`person`, `group`}; `launcher_id` is the peer/group id. In a group,
  **all users share one Session** (keyed by group id); the individual `sender_id` is
  tracked but does not affect routing.
- `SessionManager` (`src/langbot/pkg/provider/session/sessionmgr.py`) matches sessions by
  `(launcher_type, launcher_id)`, holds a per-session `asyncio.Semaphore` for
  concurrency, and a `using_conversation` pointer — the session⇄conversation split means
  "reset" just points the session at a new conversation without losing history.
- The canonical string form `"{launcher_type}_{launcher_id}"` (e.g. `group_123456`)
  appears everywhere: access control lists (`bansess` pipeline stage supports
  `group_*`, `person_*`, and `*_<id>` wildcards), monitoring session ids, sandbox ids.
- Adapters can override keying via the optional `get_launcher_id(event)` hook — this is
  how platform-specific scoping (e.g. Telegram forum topics) escapes the two-level model.

The most transferable idea is the **session-scope template**. For sandbox/container
scoping they made the scope an explicit, user-configurable template over well-known
variables, resolved per message:

```
{launcher_type}_{launcher_id}                    # per chat (default)
{launcher_type}_{launcher_id}_{sender_id}        # per user within a chat
{launcher_type}_{launcher_id}_{conversation_id}  # per conversation context
{query_id}                                       # per message (fully isolated)
```

presented in the dashboard as a select with human labels ("Per chat (Recommended)", "Per
user in chat", ...). Their scenario table (personal assistant → per user; group shared
assistant → per group; teaching bot → per student across chats; one-off exec → per
message) is a direct proof that **no fixed session granularity covers all products** —
the scope must be configuration, not a hardcoded rule.

Additionally, bots carry ordered **pipeline routing rules** (`botmgr.py:
resolve_pipeline_uuid`): first-match rules over `launcher_type` / `launcher_id` /
`message_content` / `message_has_element` with operators (eq, neq, contains, regex, ...),
a fallback default pipeline, and a `__discard__` sentinel to silently drop. So one bot
account can route DMs to one agent and group mentions to another — a channel→agent
routing table, not a 1:1 binding.

### 1.4 The EBA redesign: what their v1 taught them

The in-repo skill `langbot-eba-adapter-dev` documents the successor architecture
("Event-Based Agents") being rolled out adapter by adapter (reference implementation:
Telegram; layout `pkg/platform/adapters/<platform>/` with `adapter.py`, `api_impl.py`,
`event_converter.py`, `message_converter.py`, `platform_api.py`, `manifest.yaml`)
**[the skill is on master; the per-adapter EBA directories were not present on master at
research time — mid-migration]**. The redesign is a checklist of everything the v1
contract lacked:

- **Manifest-declared capabilities**: `spec.supported_events`,
  `spec.supported_apis.required/optional`, `spec.platform_specific_apis` — and a test
  rule that the manifest must match `supported_events()` / `supported_apis()` at runtime.
  "Do not declare an event or API in the manifest unless it has an implementation path
  and an acceptance entry."
- **A wider common event vocabulary**: `MessageReceivedEvent`, `MessageEditedEvent`,
  `MessageDeletedEvent`, `MessageReactionEvent`, `MemberJoinedEvent`,
  `BotInvitedToGroupEvent`, plus `PlatformSpecificEvent` (compact `action` + structured
  `data`) as the typed escape hatch for events that cannot map cleanly.
- **A wider common API set** in `api_impl.py`: send, reply, edit, delete, forward,
  user/group/member lookup, moderation, upload, leave group — with the hard rule that
  unsupported common APIs must raise an explicit `NotSupportedError`, never silently
  no-op.
- **A platform-specific API escape hatch** behind one generic entry point:
  `call_platform_api(action, params)` — declared per-action in the manifest, callable
  from plugins through the SDK. Channel-specific power is reachable, but it is named,
  enumerated, and testable rather than leaking as bespoke methods.
- **The core rule** stated verbatim: "Do not let platform-native event or message shapes
  leak into LangBot's common path... Raw platform objects may remain only in
  `source_platform_object` for debugging or platform-specific escape hatches."
- An acceptance-evidence taxonomy (`plugin-e2e-ui` vs `plugin-e2e-protocol` vs
  `adapter-live` vs `unit` vs `not-supported` vs `blocked`) — they learned that adapter
  correctness claims need per-component, per-direction evidence against real platform
  UIs, and that "protocol-injected" tests must not be counted as UI-level coverage.

### 1.5 Out-of-process paths: the `http_bot` adapter

LangBot's answer to "drive a pipeline from a system we don't have an adapter for" is a
**generic HTTP adapter**, designed in `docs/HTTP_BOT_ADAPTER_DESIGN.md` and shipped as
`src/langbot/pkg/platform/sources/http_bot.py` (+ `http_bot_signing.py`,
`docs/platforms/http-bot.md`, an OpenAPI fragment, and ≤50-line reference clients). It is
the single most Agenta-relevant artifact in the repo. Key decisions:

- **Asymmetric HTTP, not RPC**: inbound `POST /bots/<uuid>` with
  `{session_id, session_type, sender, message: MessageChain}` returns `202 Accepted`;
  outbound replies are delivered as 1..M signed POSTs to a **config-only callback URL**
  (`{session_id, reply_to, sequence, is_final, stream, message}`). The asymmetry exists
  because the pipeline's semantics are N→1 (aggregation/debouncing of rapid-fire
  messages into one turn) and 1→M (a turn emits multiple replies/chunks) — shapes a
  synchronous request/response cannot express. A lossy opt-in `/sync` endpoint exists
  for trivial callers.
- **Caller-defined session identity**: the external system supplies `session_id` (e.g. a
  ticket number), mapping 1:1 to a LangBot session; `POST /bots/<uuid>/reset` keyed by
  `session_id` ends it. This inverted the platform-adapter assumption (platform ids →
  session) into an integration key the caller owns.
- **Server-to-server auth done plainly**: HMAC-SHA256 over `"{timestamp}.{body}"`, ±300s
  replay window, idempotency-key dedup, constant-time compare; callback URL is config
  only (SSRF closed), per-session ordered outbound queue with bounded backlog (drop
  oldest + warn) so a dead callback cannot exhaust memory.
- The design explicitly refused to bend an existing vendor adapter into a "generic
  mode": "Bending one of them into a 'generic' mode would couple a public integration
  surface to one vendor's quirks."

Two more escape hatches: a built-in `websocket` adapter that acts as a proxy bot for the
dashboard/embeddable web widget, and a `webhook_pusher` that can fan inbound events out
to external webhooks and *skip the pipeline* if the webhook claims the message — i.e.
tap-and-override for external systems.

---

## 2. matterbridge

matterbridge is the elder: a message *relay* between ~30 protocols (IRC, XMPP, Slack,
Discord, Telegram, Matrix, Mattermost, WhatsApp, ...), begun 2016. There is no AI and no
session concept — its unit is the **gateway**: a named set of (account, channel) pairs
whose messages are mirrored into each other. It is worth studying precisely because it
ran the "support 30 protocols in one binary" experiment to completion.

### 2.1 The Bridger interface: four methods and a channel

`bridge/bridge.go`:

```go
type Bridger interface {
    Send(msg config.Message) (string, error)   // returns platform message ID
    Connect() error
    JoinChannel(channel config.ChannelInfo) error
    Disconnect() error
}
type Factory func(*Config) Bridger             // per-protocol constructor
```

Outbound is one method; **inbound is not a method at all** — every bridge is handed
`Remote chan config.Message` (in `bridge.Config`) and pushes normalized messages into it;
a single `Router.handleReceive()` goroutine fans them out. `Send` returning the platform
message ID is load-bearing: it feeds the edit/reply mapping (§2.3).

The normalized message (`bridge/config/config.go`) is a small flat struct:

```go
type Message struct {
    Text, Channel, Username, UserID, Avatar, Account string
    Event, Protocol, Gateway, ParentID, ID           string
    Timestamp time.Time
    Extra     map[string][]interface{}
}
```

- `Account` is `"protocol.name"` (e.g. `telegram.mytg`) — instance identity travels on
  every message.
- `Event` is a string enum (`join_leave`, `topic_change`, `user_action` (/me),
  `msg_delete`, `file_delete`, `user_typing`, `failure`, `rejoin_channels`,
  `get_channel_members`, `notice_irc`, ...). Events double as **control messages**: the
  router *sends* `get_channel_members` to bridges, and bridges emit `failure` /
  `rejoin_channels` to request router action. One channel, two directions of intent —
  compact but muddles data-plane and control-plane.
- `ParentID` carries threading; the constant `msg-parent-not-found` marks "source was a
  thread reply but we can't resolve the parent here" so destination bridges can degrade
  explicitly.
- `Extra` is the untyped junk drawer (files as `config.FileInfo`, attachments, failure
  payloads). Everything that didn't fit the flat struct went here.

Capability declaration barely exists: `gateway/bridgemap/bridgemap.go` holds
`UserTypingSupport = map[string]struct{}{}` — a set of protocol names — and that is the
entire capability model. Everything else is handled by bridges silently dropping what
they cannot render.

### 2.2 Registration and build-time modularity

Each protocol registers via an `init()` in a tiny per-protocol file in
`gateway/bridgemap/` guarded by a build tag:

```go
// +build !notelegram
func init() { FullMap["telegram"] = btelegram.New }
```

so distributors can compile protocols out (`-tags nowhatsapp,nomsteams`). This is the
Go-idiomatic equivalent of a plugin registry — compile-time, in-tree only. Third parties
add protocols by PR; there is no runtime plugin mechanism (the API bridge is the runtime
escape hatch, §2.4).

### 2.3 The gateway: where cross-platform edits/replies live

`gateway/gateway.go` + `gateway/router.go` hold the only clever data structure in the
codebase: an LRU cache (5000 entries) mapping a **canonical message ID**
(`"<protocol> <ID>"` of the origin message) to the list of `(bridge, ID, ChannelID)`
tuples produced when that message was relayed. On an edit or a threaded reply, the
router looks up the canonical ID and rewrites `msg.ID` / `msg.ParentID` per destination
(`getDestMsgID`), so each platform edits *its own* copy. Cross-platform edit/delete/reply
identity is a **gateway-core concern backed by an ID-mapping store, not an adapter
concern** — adapters only ever see their native IDs. Agenta will need exactly this table
(session-scoped) the moment approvals or streamed messages must be edited in place.

Normalization-on-the-way-out is also core, config-driven: `RemoteNickFormat` templating
(`{NICK}`, `{PROTOCOL}`, `{GATEWAY}`, `{NOPINGNICK}` — zero-width-space insertion to
defeat pings), regex `ReplaceMessages`/`ReplaceNicks`, and — notable — an embedded
scripting hook: [Tengo](https://github.com/d5/tengo) scripts (`Tengo.InMessage`,
`Tengo.OutMessage`) can rewrite or drop any message at the in/out boundary. That is
their "policy without forking" mechanism, and users did lean on it for filtering and
routing hacks.

Config is TOML parsed by Viper into per-protocol `map[string]Protocol` tables. The
`Protocol` struct is the cautionary tale: ~90 flat fields, each annotated with a comment
listing which protocols it applies to (`Charset string // irc`,
`PreserveThreading bool // slack`, `MediaConvertTgs string // telegram` ...). Every
protocol's knobs were merged into one shared namespace, so the config surface grew
monotonically and undiscoverably. This is what per-adapter config schemas (LangBot's
manifest `spec.config`, OpenClaw's per-plugin `configSchema`) exist to prevent.

### 2.4 The API bridge: the out-of-process escape hatch

`bridge/api/api.go` (~245 lines) implements the `Bridger` interface as an HTTP/WebSocket
server, making "external program" just another protocol in a gateway:

- `POST /api/message` — inject a message into the gateway (fields: text, username,
  avatar, gateway; server stamps Account/Timestamp and forces `Protocol="api"`).
- `GET /api/messages` — drain buffered messages (ring buffer, destructive read).
- `GET /api/stream` — chunked streaming JSON of messages as they arrive.
- `GET /api/websocket` — full-duplex JSON messages both ways.
- Static bearer token auth; `Buffer` config for ring size.

Anything that can speak HTTP can therefore join a bridge network without touching Go —
this is how community projects hung Minecraft servers, web widgets, and custom bots onto
matterbridge. The design is crude (destructive GET, single-consumer stream bug
acknowledged in a TODO, no delivery guarantees, no session concept) but the *shape* —
"the normalized message model, exposed verbatim over HTTP/WS as a first-class adapter" —
is the minimal viable out-of-process adapter mechanism, and it proved highly generative.

### 2.5 What the maintenance history teaches

- The last release is v1.26.0 (2023); the maintainer has been inactive since ~Sep 2024
  and the community openly asks "Is Matterbridge no longer maintained?"
  ([issue #2212](https://github.com/42wim/matterbridge/issues/2212))
  **[unverified detail: exact inactivity date, from search snippets]**.
- The failure mode was not the core (the router barely changed for years) but the **30
  adapters**, each pinned to a third-party client library that rots (WhatsApp/Steam
  breakage, Slack legacy tokens, MSTeams auth churn). Every protocol library upgrade was
  the maintainer's problem because everything was in-tree and released as one binary.
- Lesson for Agenta: the sustainable unit of ownership is the adapter, not the gateway.
  An architecture where adapters version and release independently of core (OpenClaw's
  npm plugins, Hermes's plugin dirs) distributes exactly the burden that killed
  matterbridge; an architecture where the wire contract is the product (the API bridge)
  outlives any adapter.

---

## 3. OpenClaw

OpenClaw is the largest and most current specimen: a personal AI assistant whose Gateway
process hosts ~25 chat channels (telegram, whatsapp, slack, discord, signal, imessage,
feishu, googlechat, matrix, mattermost, msteams, irc, line, nostr, qqbot, sms,
synology-chat, tlon, twitch, zalo, zalouser, webhooks, ...). It is also the project that
went through a public security crisis (Jan–Feb 2026) and whose current architecture
reflects the response.

### 3.1 Everything is a plugin — including bundled channels

The repo's structure is the message: `src/channels/` is core runtime (dispatch, session
recording, streaming, gating), while **every actual channel lives in `extensions/<id>/`
as an npm package** (`@openclaw/telegram` etc.) with an `openclaw.plugin.json` manifest,
its own `package.json` (owning its runtime deps), and an entry that calls
`api.registerChannel(...)`. Bundled channels go through **the same boundary third-party
plugins use** — `extensions/AGENTS.md` opens with "Treat it as the same boundary that
third-party plugins see" and bans imports from `src/**` or another extension's
internals; extension code may import only `openclaw/plugin-sdk/*` subpaths and its own
files. CI enforces the boundary (CodeQL configs named `plugin-boundary-critical`,
`channel-runtime-boundary-critical`; package-boundary tsconfigs; contract tests that
assert which plugin owns which surface).

The plugin model (from `docs/plugins/architecture.md`):

- **Four-layer load pipeline**: manifest discovery (reads `openclaw.plugin.json` without
  executing code) → enablement/validation → runtime loading (in-process `require`; Jiti
  as a TS fallback) → registry consumption by the rest of the app. Config validation and
  setup UIs work from **manifest metadata alone** — a hard split between control-plane
  metadata and runtime code ("Plugin availability should come from manifest ownership
  plus targeted activation", not import-time side effects).
- **Capability registries**: a plugin registers against typed capability contracts
  (`registerProvider`, `registerChannel`, `registerSpeechProvider`, ...). Core owns each
  capability contract; plugins own implementations; duplicate ownership is rejected at
  registration; contract tests pin bundled ownership. Their stated design question for
  any new domain: "what is the core capability contract?" — never "which vendor do we
  hardcode?".
- **Trust model stated bluntly**: native plugins run in-process, unsandboxed — "a
  malicious native plugin is equivalent to arbitrary code execution inside the OpenClaw
  process." Mitigations are allowlists (`plugins.allow`, which trusts plugin *ids*),
  explicit install paths, and treating workspace plugins as dev-only.

### 3.2 The channel plugin contract: composition of ~25 optional facets

`src/channels/plugins/types.plugin.ts` defines `ChannelPlugin` — not a base class but a
**record of optional adapter objects**, each a narrow interface:

```ts
export type ChannelPlugin<ResolvedAccount = any> = {
  id: ChannelId;
  meta: ChannelMeta;                 // label, docs path, aliases, markdownCapable, ...
  capabilities: ChannelCapabilities; // declarative feature matrix (below)
  config: ChannelConfigAdapter;      // required: account resolution
  configSchema?: ChannelConfigSchema;
  setup?; setupWizard?; pairing?; security?; allowlist?;
  groups?; mentions?; outbound?; status?; gateway?; auth?;
  approvalCapability?; elevated?; commands?; lifecycle?; secrets?;
  doctor?; bindings?; conversationBindings?;
  streaming?; threading?; message?; messaging?;
  agentPrompt?; directory?; resolver?; actions?; heartbeat?; agentTools?;
  reload?: { configPrefixes: string[]; accountScopedRestart?: boolean };
  defaults?: { queue?: { debounceMs?: number } };
};
```

Only `id`, `meta`, `capabilities`, and `config` are required; everything else is a facet
a channel adds when the platform supports it. The declarative capability matrix
(`types.core.ts`):

```ts
export type ChannelCapabilities = {
  chatTypes: Array<ChatType | "thread">;
  polls?; reactions?; edit?; unsend?; reply?; effects?;
  groupManagement?; threads?; media?; nativeCommands?; blockStreaming?;
  tts?: { voice?: ... };
};
```

plus finer-grained declared capabilities on the message adapter
(`message.live.capabilities`: `draftPreview`, `previewFinalization`, `progressUpdates`,
`nativeStreaming`, `quietFinalization`; finalizer capabilities: `finalEdit`,
`normalFallback`, `discardPending`, ...) — and, critically, **capability declarations
are backed by contract-test proof obligations** ("drift between the declared and actual
behavior is a contract test failure";
`verifyChannelMessageLiveCapabilityAdapterProofs(...)`).

The most instructive boundary decision is the **shared `message` tool**
(docs/plugins/architecture.md §"Channel plugins and the shared message tool"): channel
plugins do *not* register their own send/edit/react agent-tools. Core owns one `message`
tool (schema, prompt wiring, session/thread bookkeeping, dispatch); each channel plugin
owns *discovery* (`ChannelMessageActionAdapter.describeMessageTool(...)` returns the
actions, capabilities, and schema fragments valid for the current account/room/thread/
requester) and *execution* (its action adapter performs the final send). Action names
are a **closed, core-owned vocabulary** ("Plugins add action names through a core PR;
runtime registration is intentionally unsupported") so every surface can render every
action. This is the cleanest resolution seen anywhere of the tension "agent tools must
be uniform" vs "channels differ": one tool, channel-scoped dynamic discovery, closed
verb set, channel-owned execution.

Threading/session grammar is likewise split: core owns "the outer session-key shape and
generic `:thread:` bookkeeping"; the channel plugin owns "provider-specific conversation
ids — how thread ids encode into conversation ids or inherit from parents"
(`ChannelThreadingAdapter`: `resolveAutoThreadId`, `resolveReplyToMode`
(`off|first|all|batched`), `resolveReplyTransport`, `buildToolContext`). Session keys
follow `agent:<agentId>:<channel>:<peerKind>:<peerId>` (parsed in
`src/sessions/session-key-utils.ts`, with special heads for `cron:`, `subagent:`,
`acp:`); `src/channels/thread-binding-id.ts` shows conversation bindings prefixed by
account id (`<accountId>:<conversationId>`) — multi-account is in the identity path
everywhere (`ResolvedAccount` generic, `accountScopedRestart`).

Approvals are a first-class channel facet: `ChannelApprovalCapability`
(`types.adapters.ts`) covers rendering (`render`), native delivery
(`native`/`nativeRuntime`/`delivery` — e.g. buttons), **actor authorization**
(`authorizeActorAction({senderId, action: "approve", approvalKind: "exec"|"plugin"})` →
`{authorized, reason}`), availability probing, and per-channel approve-command behavior.
The security lesson is baked into the shape: *who may approve* is decided per channel
per sender, separately from *how the approval is rendered*.

Reliability machinery is SDK-provided, not per-channel folklore
(`docs/plugins/sdk-channel-plugins.md`): a durable ingress queue
(`createChannelIngressMonitor` — enqueue the **raw transport envelope** at a single
receive chokepoint, "no normalization at receive time", ack gated on the durable append,
one serialized lane per conversation, dedupe by `(queue_name, event_id)` with
tombstones), transport classes (ack-gated webhook vs awaited polling vs non-replay
sockets) with prescribed retention, and `createIngressEffectOnce` for exactly-once side
effects across crash-replays. Agenta does not need this depth on day one, but the
*receive-raw-then-normalize-on-drain* ordering is worth adopting early: it makes replay
and reprocessing possible forever after.

### 3.3 Third-party proof point: the official WeCom plugin

The strongest external validation of the plugin boundary:
[WecomTeam/wecom-openclaw-plugin](https://github.com/WecomTeam/wecom-openclaw-plugin) —
"OpenClaw's official WeCom (企业微信) plugin, developed and maintained by the WeCom team"
(i.e. Tencent's own product team shipping a channel OpenClaw's maintainers could not
build). Published as npm package
[`@wecom/wecom-openclaw-plugin`](https://www.npmjs.com/package/@wecom/wecom-openclaw-plugin),
installed with `openclaw plugins install @wecom/wecom-openclaw-plugin`. Mechanics
verified in its source:

- `openclaw.plugin.json` declares `{"id": ..., "channels": ["wecom"], "contracts":
  {"tools": ["wecom_mcp"]}, "skills": ["./skills"], "configSchema": {...}}` — the
  manifest declares channel ownership, an agent tool, and bundled skills without
  executing code.
- `index.ts` imports only `openclaw/plugin-sdk/*` and calls
  `api.registerChannel({ plugin: wecomPlugin })` in `register(api)`.
- Version sync with the host is an npm **peer dependency**:
  `"peerDependencies": {"openclaw": ">=2026.3.28"}` — the plugin states the minimum host
  contract it needs; the SDK's typed subpaths are the compatibility surface. Tencent
  also ships their own installer (`npx @wecom/wecom-openclaw-cli install`).
- The plugin bundles domain skills (wecom-doc, wecom-schedule, wecom-meeting, ...) —
  a channel plugin is also the vendor's distribution vehicle for platform-specific
  agent capabilities, not just transport.

Community distribution at scale runs through **ClawHub**, the plugin/skill registry
(workflows `plugin-clawhub-new.yml` / `plugin-clawhub-release.yml` in the main repo;
`src/plugins/clawhub.ts` implements install records and error codes).

### 3.4 The security crisis and what it did to the architecture

Context (from public reporting; architecture conclusions verified in-repo): within weeks
of OpenClaw going viral (Jan 2026), scanners found tens of thousands of Gateways exposed
to the internet (Censys: ~1k → 21k+ exposed instances in the last week of January;
larger counts reported later); **CVE-2026-25253** (CVSS 8.8, patched v2026.1.29) was a
one-click RCE where the Control UI trusted a `gatewayUrl` query parameter and
auto-connected, leaking the stored gateway auth token over WebSocket even on
localhost-bound instances; and the **ClawHavoc** campaign planted 341 malicious skills
(~12% of ClawHub at the time) delivering the AMOS macOS stealer
([Conscia summary](https://conscia.com/blog/the-openclaw-security-crisis/),
[Adversa timeline](https://adversa.ai/blog/openclaw-security-101-vulnerabilities-hardening-2026/),
[DigitalOcean overview](https://www.digitalocean.com/resources/articles/openclaw-security-challenges))
**[figures unverified beyond press coverage]**.

The architectural responses visible in today's tree:

- **Chat plane vs control plane separation**: the messaging channels (chat plane) are
  gated per sender by pairing/allowlists, while Gateway RPC methods (control plane) are
  scoped: channel plugins declare `gatewayMethods` with `OperatorScope` on each
  descriptor (`gatewayMethodDescriptors: {name, scope}` in `types.plugin.ts`), and the
  hardening guidance is uniformly "never expose the Gateway/Control UI; tunnel + token
  auth" — the default posture is loopback bind.
- **DM pairing as a channel-contract concern**: unknown senders don't reach the agent;
  `pairing?: ChannelPairingAdapter` (approval-code flow) and
  `security?: ChannelSecurityAdapter` (DM policy, allowlists,
  `direct-dm-guard-policy.ts`, `message-access/` decision modules in core) exist for
  every channel because inbound-DM prompt injection is treated as the top attack path.
- **Trusted-identity plumbing**: the shared message tool receives a *trusted* inbound
  `requesterSenderId`; `SessionSource`-equivalent context marks what came from where;
  mention-gating and command-gating live in core (`mention-gating.ts`,
  `command-gating.ts`) so a channel cannot forget them.
- **Supply-chain posture**: bundled-plugin trust "is resolved from the source snapshot —
  the manifest and code on disk at load time — rather than from install metadata," and
  the docs are explicit that in-process plugins are RCE-equivalent (the honest framing
  Agenta should copy rather than pretending in-process plugins can be sandboxed).

---

## 4. Hermes Agent

Hermes is Nous Research's personal agent: one agent core with a CLI/TUI, a desktop app,
and a **gateway** process that fronts messengers (Telegram, Discord, WhatsApp (two
transports), Signal, Slack, Matrix, LINE, Teams, Google Chat, IRC, QQ, WeChat/Weixin,
BlueBubbles/iMessage, SMS, an API server, a generic webhook...). Python, MIT.

### 4.1 Adapter contract: a fat base class with capability attributes

`gateway/platforms/base.py` (~5,900 lines) defines `BasePlatformAdapter(ABC)`. Required
surface (per `gateway/platforms/ADDING_A_PLATFORM.md`):

- `connect() -> bool`, `disconnect()`,
  `send(chat_id, text, ...) -> SendResult`, `send_typing(chat_id)`,
  `send_image(...)`, `get_chat_info(chat_id)`; plus a module-level
  `check_<platform>_requirements()` dependency probe.
- Optional with default stubs: `send_document/voice/video/animation/image_file`,
  `edit_message`, `delete_message`, `create_handoff_thread`.
- Inbound: the adapter constructs a `MessageEvent` and calls
  `self.handle_message(event)`; the gateway injects handlers via
  `set_message_handler(...)`, `set_authorization_check(...)`, `set_session_store(...)`.

Capabilities are **class attributes and probe methods** on the base:
`MAX_MESSAGE_LENGTH`, `message_len_fn` (chars vs UTF-16 — Telegram counts UTF-16 code
units), `supports_code_blocks`, `supports_status_text`, `supports_async_delivery`,
`supports_inchannel_continuable`, `supports_draft_streaming()`,
`prefers_fresh_final_streaming()`, `streaming_overflow_limit()`,
`enforces_own_access_policy` / `authorization_is_upstream` (who gates senders). The base
class carries an enormous shared behavior library: typing heartbeat (`_keep_typing`,
overridable for platform quirks like LINE's 60s reply-token window), send retry with
`SendResult.retryable`/`retry_after` (FloodWait), text debouncing, media extraction from
model output (parsing `![...]` and file-path directives out of the text), ephemeral
replies (`EphemeralReply` with TTL), post-delivery callbacks keyed by session.

`MessageEvent` (normalized inbound) is a dataclass: `text`, `message_type`,
`source: SessionSource`, `raw_message` (native escape hatch), `message_id`,
`media_urls/types` (local cached files, for vision), reply context
(`reply_to_message_id/text/author/is_own_message`), `auto_skill` (per-chat skill
bindings), `channel_prompt` (per-channel ephemeral system prompt), `channel_context`
(history backfill), `internal` (synthetic events bypass authz), and a free-form
`metadata` dict. `SendResult` carries `message_id`, `retryable`, `retry_after`,
`continuation_message_ids` (oversize split), and `error_kind` from a **closed
platform-neutral error vocabulary** (`too_long`, `bad_format`, `forbidden`, `not_found`,
`rate_limited`, `transient`, `unknown`) so the gateway can decide once, centrally, how to
react to a failure class.

Interactive/approval UX is a set of optional adapter methods that **degrade to plain
text** when not overridden: `send_clarify(question, choices, ...)` (multi-choice
buttons), `send_exec_approval(command, session_key, ...)` (Approve/Deny for dangerous
commands), `send_slash_confirm(...)` (Once/Always/Cancel), `send_model_picker`,
`send_choice_picker`. Button-callback payloads follow a shared convention across
adapters (`cl:<id>:<idx>`, `appr:<id>:<choice>`, `sc:<choice>:<id>`) so one gateway-side
resolver (`tools/approval.resolve_gateway_approval` etc.) handles taps from every
platform. This is the most complete worked example of **approvals-through-adapters**:
core owns the approval state machine and callback grammar; the adapter owns only the
rendering (buttons vs text) and the routing of taps back.

### 4.2 Two extension paths, and the 16-point cautionary tale

`gateway/platforms/ADDING_A_PLATFORM.md` opens with the split:

- **Plugin path (recommended for community/third-party)**: a directory in
  `~/.hermes/plugins/<name>/` (or `plugins/platforms/<name>/` for bundled) containing
  `plugin.yaml` + `adapter.py`; the adapter subclasses `BasePlatformAdapter` and the
  entry point `register(ctx)` calls `ctx.register_platform(...)` on a `PluginContext`
  (`hermes_cli/plugins.py`, which also exposes `register_tool`, `register_command`,
  `register_hook`, `register_middleware`, provider registrations, etc.). "This requires
  **zero changes to core Hermes code**." The registry
  (`gateway/platform_registry.py`) supports deferred loading and replaces the old
  hardcoded enum-based dispatch. `plugin.yaml` declares metadata plus `requires_env` /
  `optional_env` as rich entries (description, prompt, password flag, URL) that
  auto-populate the setup wizard — config schema as manifest again. Optional hooks
  cover the edges that used to require core edits: `env_enablement_fn`,
  `apply_yaml_config_fn` (plugin owns its YAML schema), `cron_deliver_env_var` +
  `standalone_sender_fn` (out-of-gateway cron delivery). Bundled channels (Telegram,
  Discord, Slack, WhatsApp, Matrix) have themselves been migrated into
  `plugins/platforms/` — same dogfooding move as OpenClaw's `extensions/`.
- **Built-in path (core contributors only)**: a checklist of **16 integration points**
  across 14 files (Platform enum, adapter factory, two authorization maps, session
  source, system-prompt hints, toolset registration, cron delivery map, send-tool map,
  channel directory, status display, setup wizard, redaction patterns, docs, tests) —
  ending with the advice to *grep the codebase for other platforms' names to find what
  you missed*. This list is the single best argument for the plugin path: it is what
  "add a channel" costs when channel identity is scattered through core instead of
  declared in one manifest.

### 4.3 Session keying and identity

`gateway/session.py` defines `SessionSource` — the richest cross-platform identity
struct of the four projects: `platform`, `chat_id`, `chat_name`,
`chat_type` (`dm|group|channel|thread`), `user_id`, `user_name`, `thread_id`,
`chat_topic`, `user_id_alt` (platform-specific *stable* alt id — Signal UUID, Feishu
union_id), `chat_id_alt`, `is_bot`, `scope_id` (platform-neutral workspace/guild/server
discriminator, renamed from `guild_id` with a documented dual-read/dual-write wire
migration), `parent_chat_id`, `message_id`, `role_authorized`, `profile` (multi-tenant
namespace), and `delivered_via_upstream_relay` — a **wire-invisible trust bit**
deliberately excluded from serialization so a remote peer can never forge it.

`build_session_key(source, group_sessions_per_user=True, thread_sessions_per_user=False,
profile=None)` is "the single source of truth for session key construction":

```
agent:<profile>:<platform>:<chat_type>[:<chat_id>][:<thread_id>][:<user_id>]
```

- DMs: keyed by chat_id (falling back to sender id — the docstring records the
  cross-user-history-bleed bug that fallback fixed).
- Groups: keyed by chat_id, **plus user_id by default** (`group_sessions_per_user=True`
  — each participant gets a private session inside a group).
- Threads: keyed by chat_id + thread_id, and **shared by default**
  (`thread_sessions_per_user=False`) — "threads are shared across all participants...
  the expected UX for threaded conversations (Telegram forum topics, Discord threads,
  Slack threads)."
- WhatsApp ids are canonicalized (JID/LID alias flips) before keying — identity
  normalization must happen *before* session keying or one human becomes two sessions.
- `profile` occupies the historical `main` slot (`agent:main:...`), giving multi-profile
  multiplexing without changing key shape.

The two booleans are per-platform config (`extra.group_sessions_per_user` etc.) — the
same lesson as LangBot's scope template: session granularity is configuration with
opinionated defaults, and *the group default (per-user) differs from the thread default
(shared)* on purpose.

### 4.4 Global session IDs and cross-surface handoff (CLI ⇄ messenger)

The mechanism that makes "move a session between surfaces" work is a strict two-level
identity split, shared storage, and a tiny state machine:

- **`session_id`** is the global, surface-independent identity of a transcript, stored
  in a shared SQLite DB (`~/.hermes/state.db`, `hermes_state.py` — sessions table,
  messages, FTS). CLI runs and gateway runs write into the same DB.
- **`session_key`** is the surface-scoped routing name (above). The gateway's
  `SessionStore` (`sessions.json` + the DB) maps `session_key → SessionEntry`, where
  `SessionEntry` holds `session_id`, the **origin `SessionSource` for delivery
  routing**, token/cost counters, expiry/auto-reset flags, `resume_pending` (gateway
  restart recovery), and a persisted per-session `model_override` (explicitly
  credentials-free).
- **Handoff is rebinding a session_key to a different session_id.** The sessions table
  carries `handoff_state / handoff_platform / handoff_error` columns with the state
  machine `None → pending → running → (completed|failed)`
  (`tests/hermes_cli/test_session_handoff.py`). CLI side: `request_handoff(session_id,
  "telegram")` then poll `get_handoff_state`. Gateway side
  (`gateway/run.py:_handoff_watcher`, polling every 2s through an async DB facade):
  `list_pending_handoffs` → `claim_handoff` (atomic pending→running) →
  `_process_handoff(row)` → `complete_handoff`/`fail_handoff`.
- `_process_handoff` (gateway/run.py) is the worked example of cross-surface resume:
  resolve the live adapter for the target platform; require a configured **home
  channel** (per-platform default chat, set by `/sethome`); ask the adapter to
  `create_handoff_thread(home_chat_id, "Hermes — <title>")` so the moved conversation
  gets its own scrollback (adapters return None when the platform can't thread —
  Matrix/WhatsApp/Signal/SMS — and the flow degrades to the home channel); build the
  destination `SessionSource` and compute its `session_key` **with the same
  build_session_key rules the adapter will use for the user's next real message** (the
  code comments record a Telegram DM-topic bug from getting this wrong);
  `switch_session(session_key, cli_session_id)` re-points the key at the CLI transcript;
  evict the cached agent for that key; then dispatch a **synthetic internal
  `MessageEvent`** ("Session was just handed off from CLI... confirm you're working here
  and summarize") through the normal pipeline so the agent greets on the new surface
  with full history.

The transferable design: resume/handoff requires (a) transcript identity independent of
surface identity, (b) a store that maps surface→transcript and can be re-pointed
atomically, (c) delivery-routing metadata (`origin`/home channel) persisted per surface,
and (d) computing the destination's session key via the exact same function inbound
messages will use.

### 4.5 RelayAdapter: the out-of-process generalization

`gateway/relay/` (marked EXPERIMENTAL) is Hermes converging on the same idea as
matterbridge's API bridge, but capability-aware. `RelayAdapter`
(`gateway/relay/adapter.py`) is **one generic `BasePlatformAdapter`** with no
platform-specific code; a remote **connector** process (which owns the actual Discord/
Telegram/... connection) connects over an authenticated WebSocket and, at handshake,
sends a `CapabilityDescriptor` (`gateway/relay/descriptor.py`):

```python
@dataclass(frozen=True)
class CapabilityDescriptor:
    contract_version: int          # additive-only evolution while experimental
    platform: str; label: str
    max_message_length: int        # 0/negative normalized to 4096 at the trust boundary
    supports_draft_streaming: bool
    supports_edit: bool            # False ⇒ consumer degrades to message-per-segment
    supports_threads: bool         # create_handoff_thread capability
    markdown_dialect: str          # "markdown_v2", "discord", "plain", ...
    len_unit: str                  # "chars" | "utf16"
    emoji: str; platform_hint: str; pii_safe: bool
    supports_context: bool = False
```

The descriptor is frozen (capabilities fixed for the connection lifetime), JSON with
unknown-key filtering (forward compatible), versioned by `contract_version`, and
explicitly documented as a *projection* of the in-process capability surface
(`PlatformEntry` + the adapter's capability methods). Degenerate values from a hostile
connector are normalized at the trust boundary. "There is NO per-platform gateway code:
the connector is the only side that knows 'this chat_id maps to a Discord channel'."
The relay also shows the security seam for out-of-process adapters: the
`delivered_via_upstream_relay` trust flag is set locally by the transport and never
accepted from the wire.

---

## 5. Interface design lessons for Agenta

Synthesis across the four projects, phrased as guidance for Agenta's channel-provider
interface (channels feature: agent bound to Slack/Telegram/..., @mention opens a
session, thread = session, approvals in-channel).

### 5.1 What the adapter contract should contain

1. **A structured message model, not markdown-with-conventions.** All four converged on
   segments/components (LangBot's MessageChain; OpenClaw's structured components +
   per-channel markdown capability; Hermes's media/reply fields). Mentions, quotes,
   media, and "reply-to" must be typed parts; text formatting is a per-channel dialect
   declared as a capability (`markdown_dialect` in Hermes's descriptor,
   `markdownCapable` in OpenClaw's meta).
2. **A small required core, wide optional facets.** The required surface everywhere is
   tiny: identity/meta, config resolution, connect/lifecycle, send-text, and inbound
   dispatch. Everything else — edit, delete, reactions, threads, buttons, polls, typing,
   streaming — is optional and *declared*. OpenClaw's composition-of-adapter-objects
   beats both fat inheritance (Hermes's 5,900-line base class, where shared behavior and
   contract are entangled) and a minimal ABC that later grows `hasattr` probes
   (LangBot v1). Prefer `channel = { meta, capabilities, config, outbound, threading?,
   approvals?, streaming?, ... }` records over subclassing.
3. **Declared capabilities with teeth.** A `capabilities` object
   (chatTypes, threads, edit, buttons, reactions, media, nativeCommands, streaming mode,
   max message length + length unit) that core *reads to plan behavior* (streaming via
   edit vs message-per-chunk; buttons vs numbered-text fallback), and that tests hold
   the adapter to (OpenClaw's capability-proof contract tests; LangBot EBA's
   manifest-must-match-runtime rule). Silent no-ops are the failure mode; LangBot's
   `NotSupportedError` rule is the antidote.
4. **Inbound as normalized events into a core-owned pipeline, with the raw payload
   attached.** Adapter converts native → `MessageReceivedEvent`-style objects (plus
   edited/deleted/reaction/member events when available) and hands them to core; core
   owns gating (mention/command), debouncing/aggregation, session resolution, and
   dispatch. Keep `raw`/`source_platform_object` on the event for debugging and
   platform-specific escape hatches — every project does this.
5. **Send returns a receipt.** Platform message id(s) back from every send (matterbridge
   returns it from `Send`; OpenClaw's `MessageReceipt`; Hermes's `SendResult` with
   `continuation_message_ids`), because edits, threads, approval-message updates, and
   dedupe all hinge on it. Include a closed, platform-neutral `error_kind` vocabulary
   (Hermes) so core reacts to failure classes centrally.
6. **Session keying lives in core; the channel owns only the conversation grammar.**
   One core function builds the session key (Hermes's `build_session_key`; OpenClaw's
   "core owns the outer session-key shape"); the channel contributes only how its native
   ids map to (chat_id, chat_type, thread_id, stable user id) — including id
   canonicalization (WhatsApp JID/LID) *before* keying. Make granularity configurable
   with opinionated defaults: thread = shared session (Agenta's "thread = session"
   matches everyone's default), group outside threads = per-user or per-group as
   config, and consider LangBot's template idea (`{chat}`, `{chat}_{user}`,
   `{conversation}`) for the scope knob rather than an enum of booleans.
7. **Approvals as a first-class facet with core-owned grammar.** Core owns the approval
   state machine, the callback-payload grammar (Hermes's `appr:<id>:<choice>` shared
   across platforms), and actor authorization policy hooks (OpenClaw's
   `authorizeActorAction({senderId, approvalKind})`); the channel owns rendering
   (buttons where supported, degrade to "reply 1/2" text otherwise) and routing taps
   back. Never let a channel implement its own approval semantics.
8. **Config schema as data in a manifest, i18n-ready, with secret marking** (LangBot's
   `spec.config`, Hermes's `requires_env`/`optional_env` rich entries, OpenClaw's
   `configSchema`) so the dashboard renders channel setup forms generically and a
   third-party channel gets UI for free. Multi-account (several Slack workspaces) must
   be in the identity model from day one (OpenClaw's `accountId` everywhere; Agenta
   should key everything by `(channel, accountId)`).

### 5.2 What the contract should NOT contain

- **No per-platform fields in shared config** — matterbridge's 90-field `Protocol`
  struct with `// slack` comments is the canonical anti-pattern. Channel-specific knobs
  belong in the channel's own schema.
- **No open-ended untyped extension bags as the primary mechanism** — matterbridge's
  `Extra map[string][]interface{}` became the dumping ground. An escape hatch should be
  *named and enumerated*: LangBot EBA's `call_platform_api(action, params)` with
  manifest-declared actions, or OpenClaw's closed message-action vocabulary extended by
  core PR, not arbitrary runtime registration.
- **No channel-registered agent tools for messaging** — one shared core `message` tool
  with channel-scoped discovery (OpenClaw) keeps the agent-facing surface uniform and
  auditable. Channels contribute schema fragments and execute actions; they do not mint
  verbs.
- **No behavior library in the contract.** Retry, typing heartbeats, debouncing,
  media caching, chunking should be host/SDK helpers channels *use*, not obligations
  hidden in a base class channels must inherit.
- **No trust decisions from the wire.** Trust flags (Hermes's
  `delivered_via_upstream_relay`) and requester identity must be stamped by the host at
  the boundary, never deserialized from adapter or connector input; capability values
  from remote adapters must be normalized at the trust boundary (Hermes's
  `max_message_length <= 0 → 4096`).

### 5.3 The extension mechanism: what actually works for third parties

The observed spectrum, worst to best:

1. **In-tree only, identity scattered through core** (matterbridge; Hermes's legacy
   path): every channel costs a 16-point shotgun-surgery checklist and every adapter's
   bit-rot lands on the core maintainer — the failure mode that ended matterbridge.
2. **In-tree drop-in with manifest + discovery** (LangBot): cheap to contribute, zero
   frontend cost, but still couples release cadence and maintenance to core.
3. **In-process packages against a versioned SDK** (OpenClaw; Hermes plugins): the
   sweet spot for rich channels. The load-bearing ingredients, all of which Agenta
   should copy if it goes this route: (a) *bundled channels use the same boundary* —
   dogfooding is what keeps the SDK honest; (b) a **code-free manifest** declaring
   ownership (`channels: ["wecom"]`), config schema, and assets so validation/UI need
   no execution; (c) typed SDK subpaths as the only import surface, enforced by CI;
   (d) versioning via peer-dependency range on the host (`openclaw >= 2026.3.28`);
   (e) honesty that in-process = full trust (RCE-equivalent), mitigated by allowlists
   and a registry with review (and ClawHavoc shows registry review must be real).
   Proof it works: Tencent's WeCom team shipped and maintains the WeCom channel with
   zero core changes.
4. **Out-of-process over a wire contract** (matterbridge API bridge, LangBot http_bot,
   Hermes RelayAdapter): the only path that is language-agnostic, crash-isolated,
   independently deployable, and safe for untrusted third parties — and the only one a
   *hosted* Agenta can offer customers. The synthesis of the three designs is the
   recommended Agenta mechanism: **one generic "remote channel" adapter in core**, where
   the external connector (customer-run, any language) connects outbound over
   authenticated WebSocket/HTTP, presents a **frozen, versioned CapabilityDescriptor**
   at handshake (platform name, max length + length unit, edit/threads/buttons/
   streaming support, markdown dialect), then exchanges the normalized message model
   both ways — with caller-meaningful session ids (LangBot's `session_id`), signed
   webhooks + `sequence`/`is_final` for the HTTP variant (LangBot's contract is the
   best-documented reference), and host-stamped trust bits. Given self-hosted users and
   platforms like WeCom/Feishu whose connectivity requirements (China network, XML
   crypto callbacks) Agenta cannot test, the out-of-process contract is not an escape
   hatch but the primary third-party story; an in-process (or in-tree) interface can
   remain the path for first-party channels.

### 5.4 Open questions this research raises for Agenta

- Where does Agenta's normalized model sit on the richness spectrum? matterbridge's
  13-field flat message was too poor (everything fell into `Extra`); OpenClaw's
  25-facet contract took a large team and years. A LangBot-EBA-sized middle (message
  chain + ~8 event types + declared capability matrix) looks like the right v1.
- Does the approval flow need *native* interactive rendering per channel at v1, or is
  Hermes-style graceful degradation ("reply 1 to approve") acceptable until the
  Slack/Telegram button adapters mature?
- Should Agenta adopt receive-raw-then-normalize durable ingress (OpenClaw) from the
  start, or accept at-most-once in v1? The dedupe key design
  (`(queue, event_id)` + logical message key) is much harder to retrofit than to build
  in.
- Multi-account and multi-agent are both in the session key in the mature systems
  (OpenClaw: `agent:<agentId>:<channel>...` + accountId bindings). Agenta needs to
  decide now whether agent id and channel account id are part of conversation identity.
- If Agenta imitates the CapabilityDescriptor handshake, what is the versioning story —
  Hermes uses `contract_version` + additive-only evolution + unknown-key filtering;
  that combination is cheap and sufficient.
