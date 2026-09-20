# Channels specifications

These documents separate observed behavior from two proposed changes: native Slack agent handles and agent-facing channel tools. They are drafts for Mahmoud's review. The commits add documentation only.

The channels stack has not shipped to production. The baseline is a reference for the reviewed code, not a compatibility contract. Neither proposal requires legacy modes, preservation of pre-release data, or a production migration path.

The baseline describes the channels pull request stack through [PR #6737](https://github.com/Agenta-AI/agenta/pull/6737), source commit `658d6f5edae34d861d141a38604ef7a12a7b69c8`. It does not describe released `main` or every Channels capability. Its original scope is installation sharing, agent selection, reply identity, and deployment controls. The channel-tool proposal records additional observed limits in its design and shared evidence.

## Read first

1. Read the [native Slack handle proposal](changes/slack-native-agent-handles/proposal.md) for shared-installation addressing and identity.
2. Read the [channel agent tools proposal](changes/channel-agent-tools/proposal.md) for destination discovery, search, proactive delivery, and scheduling.
3. Read each proposal's design for implementation choices, risks, verification, and estimates:
   - [Native Slack handle design](changes/slack-native-agent-handles/design.md), estimated at 9-15 engineer-days.
   - [Channel agent tools design](changes/channel-agent-tools/design.md), estimated at 16-25 engineer-days.
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
| Tool access | No channel operations are platform tools. | [Optional tools with bound identity and layered authorization](changes/channel-agent-tools/specs/channel-agent-tool-access/spec.md) |
| Destination discovery | Configuration APIs can discover spaces, but agents cannot list their permitted targets. | [Opaque authorized destinations](changes/channel-agent-tools/specs/channel-destination-discovery/spec.md) |
| Proactive delivery | Outbox delivery begins from a session-linked ChannelThread. | [Durable sends outside an inbound thread](changes/channel-agent-tools/specs/channel-message-delivery/spec.md) |
| Message search | Slack has bounded one-time history fetch. Telegram has no provider-history read. | [Permission-aware indexed search with coverage](changes/channel-agent-tools/specs/channel-message-search/spec.md) |
| Scheduling | The generic scheduler can run an agent, but Channels has no exact-message schedule. | [Exact one-time messages and recurring generated runs](changes/channel-agent-tools/specs/channel-message-scheduling/spec.md) |

The proposed tools never receive bot credentials, raw provider locators, project IDs, connection IDs, or channel-agent IDs from the model. Exact scheduled messages store approved text. Recurring generated messages continue to use the agent scheduler and ordinary send tool.

## OpenSpec layout

`specs/` records the observed Slack baseline. `changes/slack-native-agent-handles/` contains one proposal with five capability deltas. `changes/channel-agent-tools/` contains a separate proposal with five new capability deltas.

Do not copy proposed requirements over the baseline yet. OpenSpec merges a delta when an implemented and accepted change is archived. Completed planning artifacts are not a completed implementation.

## Validation

Use OpenSpec 1.13.1 from the repository root:

```sh
openspec validate --all --strict --no-interactive
openspec status --change slack-native-agent-handles
openspec status --change channel-agent-tools
```

The current behavior comes from code inspection, not live Slack or Telegram testing. Native empty-member group mentions, customized progress identity, Slack direct-message setup, provider receipt-loss behavior, indexed-history coverage, and unattended scheduled delivery remain explicit validation work. No external workspace is changed by these documents.

## Review decisions

- Native Slack handles use one workspace installation in one Agenta project.
- Agent-facing channel operations are optional platform tools, not direct adapter or gateway calls.
- Tool permission and destination-level Channels grants are separate decisions.
- Permission to reply does not grant search, proactive send, or direct-message initiation.
- Proactive direct messages use a separate private channel session. They do not move a shared source session.
- Slack search uses a permission-filtered local lexical index with bounded backfill and coverage reporting.
- Telegram search covers only messages Agenta observes after connection.
- Exact one-time messages use durable Channels intents. Recurring generated content uses the existing agent scheduler.
- Provider delivery is not described as exactly once when an accepted post can lose its receipt.
