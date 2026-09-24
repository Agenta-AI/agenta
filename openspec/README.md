# Repository specifications

## Railway preview cost controls

[Proposal](changes/railway-preview-cost-controls/proposal.md), [behavior specifications](changes/railway-preview-cost-controls/specs/railway-preview-lifecycle/spec.md), [PR comment command](changes/railway-preview-cost-controls/specs/railway-preview-comments/spec.md), [design](changes/railway-preview-cost-controls/design.md), and [tasks](changes/railway-preview-cost-controls/tasks.md).

Implemented in PR #7058. Delete automatic previews after tests and let authorized maintainers request a one-hour preview with a `/preview` comment on the pull request. See [validation status and limits](changes/railway-preview-cost-controls/validation.md) before treating provider acceptance or default-branch activation as complete.

## Channels: mention-only threads

[Proposal](changes/channels-mention-only-threads/proposal.md), [turn trigger specification](changes/channels-mention-only-threads/specs/channel-turn-triggers/spec.md), [routing delta](changes/channels-mention-only-threads/specs/slack-agent-routing/spec.md), [design](changes/channels-mention-only-threads/design.md), and [tasks](changes/channels-mention-only-threads/tasks.md).

Implemented in PR #7128. In a Slack channel thread, a Slack group DM or a Telegram group, the bot answers only when it is mentioned, given a command, or answered on a pending choice. In a Telegram group, a reply to one of the bot's messages also counts. The next turn carries every message posted since the agent's last turn, up to its own mention, and every mention runs, at most once per thread (context under sub-second concurrent arrival is best effort). A 1:1 DM still answers every message.

## Agent template specifications

These OpenSpec changes are proposals for PR #6944. No runtime implementation is included, and no change has been archived as a shipped capability.

Start with [the single-agent proposal](changes/load-single-agent-templates/proposal.md), then [its design](changes/load-single-agent-templates/design.md). The four capability specifications cover [sources](changes/load-single-agent-templates/specs/template-sources/spec.md), [loading](changes/load-single-agent-templates/specs/single-agent-template-loading/spec.md), [first-message delivery](changes/load-single-agent-templates/specs/template-first-message/spec.md), and [existing entry behavior](changes/load-single-agent-templates/specs/template-entry-behavior/spec.md).

The separate [subagent proposal](changes/support-template-subagents/proposal.md) is deferred and NOT IMPLEMENTED.

Validate document structure from the repository root with OpenSpec 1.13.1:

```sh
openspec validate --all --strict --no-interactive
```

This validates specification format only. Runtime acceptance requires the scenario evidence described in [the validation plan](../docs/design/agent-workflows/projects/agent-plugin-templates/validation.md). Implementation tasks remain unchecked.

## Channels specifications

These documents separate observed behavior from two proposed changes: native Slack agent handles and agent-facing channel tools. They are drafts for Mahmoud's review. The commits add documentation only.

The channels stack has not shipped to production. The baseline is a reference for the reviewed code, not a compatibility contract. Neither proposal requires legacy modes, preservation of pre-release data, or a production migration path.

The baseline describes the channels pull request stack through [PR #6737](https://github.com/Agenta-AI/agenta/pull/6737), source commit `658d6f5edae34d861d141a38604ef7a12a7b69c8`. It does not describe released `main` or every Channels capability. Its original scope is installation sharing, agent selection, reply identity, and deployment controls. The channel-tool proposal records additional observed limits in its design and shared evidence.

## Read first

1. Read the [native Slack handle proposal](changes/slack-native-agent-handles/proposal.md) for shared-installation addressing and identity.
2. Read the [channel agent tools proposal](changes/channel-agent-tools/proposal.md) for listing destinations, sending, reading, and searching. Its [implementation plan](changes/channel-agent-tools/plan.md) lists the phases, files, and tests.
3. Read each proposal's design for implementation choices, risks, verification, and estimates:
   - [Native Slack handle design](changes/slack-native-agent-handles/design.md), estimated at 9-15 engineer-days.
   - [Channel agent tools design](changes/channel-agent-tools/design.md), estimated at 17-24 engineer-days.
4. Check the implementation tasks. Every task remains unchecked:
   - [Native Slack handle tasks](changes/slack-native-agent-handles/tasks.md).
   - [Channel agent tools tasks](changes/channel-agent-tools/tasks.md).
5. Use the [evidence](evidence.md) to check the claims against exact code references and provider documentation.

## Native Slack handle delta

| Area | Current baseline | Proposed delta |
| --- | --- | --- |
| One installed app and its permissions | [Installation](specs/slack-installation/spec.md) | [Installation scopes](changes/slack-native-agent-handles/specs/slack-installation/spec.md) |
| Which agent receives a message | [Routing](specs/slack-agent-routing/spec.md) | [Native group-ID routing](changes/slack-native-agent-handles/specs/slack-agent-routing/spec.md) |
| Reply name and avatar | [Bot identity](specs/slack-reply-identity/spec.md) | [Per-agent identity](changes/slack-native-agent-handles/specs/slack-reply-identity/spec.md) |
| Connecting agents from their pages | [Retargeting controls](specs/slack-agent-deployment/spec.md) | [Multiple deployments](changes/slack-native-agent-handles/specs/slack-agent-deployment/spec.md) |
| Managed Slack user groups | Not implemented. | [New address lifecycle](changes/slack-native-agent-handles/specs/slack-agent-addresses/spec.md) |

A Slack user group provides the mention handle. It is not a new Slack bot user. Several agents still share one installed app, token, and app direct-message destination.

## Channel agent tools delta

| Capability | Current behavior | Proposed delta |
| --- | --- | --- |
| Tool access | No channel operations are platform tools. | [Four platform tools with a server-bound caller and checks on every call](changes/channel-agent-tools/specs/channel-agent-tool-access/spec.md) |
| Bot settings | The manage panel has "Answers in", "Behavior", and a Telegram allow-list. | [Three per-bot controls under a new Advanced section](changes/channel-agent-tools/specs/channel-agent-tool-settings/spec.md) |
| Destination discovery | Configuration APIs can discover spaces, but agents cannot list their targets. | [Opaque channel and person destinations on Slack and Telegram](changes/channel-agent-tools/specs/channel-destination-discovery/spec.md) |
| Proactive delivery | Outbox delivery begins from a session-linked ChannelThread. | [Sends outside the conversation with a truthful delivery record](changes/channel-agent-tools/specs/channel-message-delivery/spec.md) |
| Reading | Slack has a one-time fetch of up to 50 messages before a first turn. Telegram has no history read. | [Read a channel or thread from a local history with bounded Slack backfill](changes/channel-agent-tools/specs/channel-conversation-reading/spec.md) |
| Search | None. | [Lexical search over the local history with coverage](changes/channel-agent-tools/specs/channel-message-search/spec.md) |

The tools never receive bot credentials, raw provider IDs, project IDs, connection IDs, or channel-agent IDs from the model. Scheduling is out of scope: an automation that runs the agent uses the ordinary send tool.

## OpenSpec layout

`specs/` records the observed Slack baseline. `changes/slack-native-agent-handles/` contains one proposal with five capability deltas. `changes/channel-agent-tools/` contains a separate proposal with six new capability deltas and an implementation plan.

Do not copy proposed requirements over the baseline yet. OpenSpec merges a delta when an implemented and accepted change is archived. Completed planning artifacts are not a completed implementation.

## Validation

Use OpenSpec 1.13.1 from the repository root:

```sh
openspec validate --all --strict --no-interactive
openspec status --change slack-native-agent-handles
openspec status --change channel-agent-tools
```

The current behavior comes from code inspection, not live Slack or Telegram testing. Native empty-member group mentions, customized progress identity, Slack direct-message setup, provider receipt-loss behavior, and history backfill coverage remain explicit validation work. No external workspace is changed by these documents.

## Review decisions

- Native Slack handles use one workspace installation in one Agenta project.
- Agent-facing channel operations are platform tools, not direct adapter or gateway calls. They are added at run time to every run of an agent bound to an active bot, without changing its saved configuration.
- The send tool defaults to `allow`. An author's per-tool `ask` or `deny`, or an agent-wide `ask` or `deny` mode, still wins.
- Three per-bot settings replace per-destination grants: posting outside the conversation (on), messaging people directly (on), and the channels it may read and search (all by default).
- On Slack the agent may post to any channel the bot is in, message anyone in the workspace, and read every channel the bot is in. There is no allow-list in v1.
- On Telegram the agent can reach only chats that sent the bot an update and people who wrote to it first. Reading and search cover only observed messages.
- Proactive direct messages use a separate private channel session. They do not move a shared source session.
- Read and search use a local history. Slack backfill is bounded and rate-aware.
- Scheduling belongs to the automation product and is not part of this change.
- Provider delivery is not described as exactly once when an accepted post can lose its receipt.
