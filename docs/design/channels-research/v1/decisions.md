# Channels: decision record

Date: 2026-07-20. Status: decisions taken from Mahmoud's review of
`early-findings.md` (PR review, 2026-07-20), plus two fact corrections from the
verification pass. This document supersedes the open questions in
`early-findings.md` section 6; the architecture in `architecture.md` treats
everything here as fixed.

## Decisions

**D1. Group sessions are shared.** A group thread gets one session that the whole
team writes into, with per-message speaker attribution. The companion safety rule
(a reply visible to the group must never use resources only one member may
access) is out of scope for the MVP, but the architecture must be able to enforce
it later without redesign. Today this costs nothing extra: all credentials and
tools enter a run through one resolution point in the SDK, so the future rule is
a filter in one place.

**D2. The agent acts with the invoking user's permissions.** When Alice asks the
agent to do something, the agent runs with Alice's Agenta identity and her
permissions, which requires linking her channel identity (her Slack user id) to
her Agenta account. This is the enterprise-correct model: per-person least
privilege and a clean audit trail. The architecture keeps two doors open without
implementing them now: agent-own-identity (the agent as a first-class principal
with its own permissions, Linear's model) and admin-provisioned service accounts
(Claude Tag's model).

**D3. One platform app is one agent.** A Slack app (or Telegram bot, or email
address) is the identity of exactly one agent: its own name, its own avatar. The
platform must support many apps per workspace, so a team can install three agents
as three visibly distinct bots. Self-hosted users always create their own
platform apps from manifests we ship (which is also the security posture: their
tokens never touch us); the cloud edition may additionally offer a ready-made
app for zero-setup starts. A "router agent" that dispatches to other agents is
something users can build and we can bias templates toward; it is not a platform
primitive.

**D4. DMs are allowed.** A DM with an agent is personal context; a channel is
shared context. The two contexts stay separate in memory and in resource access.

**D5. Session lifetime is configuration.** Idle timeouts, explicit new-session
commands, and stale states are settings on the platform, not design forks.

**D6. Continuity rides on the existing session subsystem.** Mahmoud's review
challenged the claim that cross-surface continuity is hard; the codebase audit
(`raw/agenta-primitives.md`) largely confirms his view. External services can
already post into a session and trigger a turn. Exactly two gaps remain and both
are scheduled work, not research: server-side context hydration (the server
stores the transcript but the caller still ships history on each turn) and a
`sender` field on records for speaker attribution.

**D7. Learn from Linear.** Linear's agent protocol (typed activities, derived
session states, elicitation as the waiting-for-input primitive, a 10-second
acknowledgment SLO) is the reference for how channel surfaces should render
agent work. Our SSE frame stream is structurally close; the channel gateway
consumes frames and renders them per channel.

## Fact corrections from the verification pass (`raw/verifications.md`)

**Claude Tag identity is a split, not a single model.** In channels, Claude Tag
acts under admin-provisioned service accounts; Anthropic's docs state that what
Claude can do never changes based on who asked. In DMs, it runs with the asking
user's own account and connectors. The reviewer's recollection matches the
adjacent product, Claude Code in Slack, which does run under the user's own
account. Consequence for us: with D2 we are choosing, for shared channels, a
model Anthropic deliberately avoided there. Their reason (predictability in
shared spaces) is real, and it is exactly why D1's safety rule and D2's open
door to service accounts stay in the architecture.

**Gumloop does have in-Slack approval buttons.** Approve and Reject resolve
directly in the Slack thread (shipped June 16, 2026, after our first-pass
sources). The white-space claim in `early-findings.md` section 4 weakens
accordingly: in-channel approvals now exist in at least two products (Gumloop,
Relevance AI). Our differentiators are approvals wired to a durable runtime
approval object, approver roles distinct from trigger rights, and the same
approval being answerable from any surface, not being first.
