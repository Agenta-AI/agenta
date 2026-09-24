# Repository specifications

## Railway preview cost controls

[Proposal](changes/railway-preview-cost-controls/proposal.md), [behavior specifications](changes/railway-preview-cost-controls/specs/railway-preview-lifecycle/spec.md), [PR comment command](changes/railway-preview-cost-controls/specs/railway-preview-comments/spec.md), [design](changes/railway-preview-cost-controls/design.md), and [tasks](changes/railway-preview-cost-controls/tasks.md).

Implemented in PR #7058. Delete automatic previews after tests and let authorized maintainers request a one-hour preview with a `/preview` comment on the pull request. See [validation status and limits](changes/railway-preview-cost-controls/validation.md) before treating provider acceptance or default-branch activation as complete.

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
   - [Channel agent tools design](changes/channel-agent-tools/design.md), estimated at 11-17 engineer-days without direct messages, 13-19 with them.
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
| Tool access | No channel operations are platform tools. | [Four tools in the Agenta tools kit, a send default of `allow`, and checks on every call](changes/channel-agent-tools/specs/channel-agent-tool-access/spec.md) |
| Bot settings | The manage panel has "Answers in", "Behavior", and a Telegram allow-list. | [Per-bot controls under a new Advanced section](changes/channel-agent-tools/specs/channel-agent-tool-settings/spec.md) |
| Destination discovery | Configuration APIs can discover spaces, but agents cannot list their targets. | [Opaque channel destinations on Slack and Telegram; people pending a decision](changes/channel-agent-tools/specs/channel-destination-discovery/spec.md) |
| Proactive delivery | Outbox delivery begins from a session-linked ChannelThread. | [Sends outside the conversation with a truthful delivery record](changes/channel-agent-tools/specs/channel-message-delivery/spec.md) |
| Reading | No agent-facing read. | [Stored messages first, then live Slack history; Telegram stored only](changes/channel-agent-tools/specs/channel-conversation-reading/spec.md) |
| Search | None. | [Full-text search over stored messages](changes/channel-agent-tools/specs/channel-message-search/spec.md) |

The tools never receive bot credentials, raw provider IDs, project IDs, connection IDs, or channel-agent IDs from the model. Scheduling and the one-time history copy are out of scope for v1.

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

The current behavior comes from code inspection, not live Slack or Telegram testing. Native empty-member group mentions, customized progress identity, Slack direct-message setup, provider receipt-loss behavior, and Slack's history limits for the hosted app remain explicit validation work. No external workspace is changed by these documents.

## Review decisions

- Native Slack handles use one workspace installation in one Agenta project.
- Agent-facing channel operations are platform tools in the Agenta tools kit, active when the agent is connected to a bot. The kit specification owns how they are added to a run.
- The send tool defaults to `allow`. An author's per-tool `ask` or `deny`, or an agent-wide `ask` or `deny` mode, still wins.
- Per-bot settings replace per-destination grants: posting outside the conversation (on) and the channels it may read and search (all by default).
- On Slack the agent may post to any channel the bot is in and read every channel the bot is in. There is no allow-list in v1.
- Read serves stored messages first, then live Slack history. Search covers stored messages only. No new message table.
- On Telegram the agent can reach only chats that sent the bot an update, and it can read only messages the bot received.
- Direct messages to people are pending a decision.
- Scheduling belongs to the automation product. The one-time history copy is future work.
- Provider delivery is not described as exactly once when an accepted post can lose its receipt.
