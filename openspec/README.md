# Channels specifications

These documents separate the current Slack behavior from the proposed native-agent-handle change. They are drafts for Mahmoud's review. This commit adds documentation only.

The baseline describes the channels pull request stack through [PR #6737](https://github.com/Agenta-AI/agenta/pull/6737), source commit `658d6f5edae34d861d141a38604ef7a12a7b69c8`. It does not describe released `main` or every Channels capability. Its scope is installation sharing, agent selection, reply identity, and deployment controls relevant to this delta.

## Read first

1. Read the [proposal](changes/slack-native-agent-handles/proposal.md) for the intended outcome and scope.
2. Compare the current and proposed requirements in the table below.
3. Read the [design](changes/slack-native-agent-handles/design.md) for implementation choices, migration, risks, and the 11-18 engineer-day estimate.
4. Check the [implementation tasks](changes/slack-native-agent-handles/tasks.md). Every task is still unchecked.
5. Use the [evidence](evidence.md) to check the baseline against exact code references and Slack documentation.

## Current behavior and proposed delta

| Area | Current baseline | Proposed delta |
| --- | --- | --- |
| One installed app and its permissions | [Installation](specs/slack-installation/spec.md) | [Scopes and upgrade](changes/slack-native-agent-handles/specs/slack-installation/spec.md) |
| Which agent receives a message | [Routing](specs/slack-agent-routing/spec.md) | [Native group-ID routing](changes/slack-native-agent-handles/specs/slack-agent-routing/spec.md) |
| Reply name and avatar | [Bot identity](specs/slack-reply-identity/spec.md) | [Per-agent identity](changes/slack-native-agent-handles/specs/slack-reply-identity/spec.md) |
| Connecting agents from their pages | [Retargeting controls](specs/slack-agent-deployment/spec.md) | [Multiple deployments](changes/slack-native-agent-handles/specs/slack-agent-deployment/spec.md) |
| Managed Slack user groups | Not implemented. | [New address lifecycle](changes/slack-native-agent-handles/specs/slack-agent-addresses/spec.md) |

A Slack user group provides the mention handle. It is not a new Slack bot user. Several agents still share one installed app, token, and app direct-message destination.

## OpenSpec layout

`specs/` records the observed baseline. `changes/slack-native-agent-handles/` contains the proposal, design, tasks, and delta specifications. Modified requirement names match the baseline exactly. The new address capability uses `ADDED Requirements`; changed behavior uses `MODIFIED Requirements`.

Do not copy the proposed requirements over the baseline yet. OpenSpec merges the delta when an implemented and accepted change is archived. A completed set of planning artifacts is not a completed implementation.

## Validation

Use OpenSpec 1.13.1 from the repository root:

```sh
openspec validate --all --strict --no-interactive
openspec status --change slack-native-agent-handles
```

The current behavior comes from code inspection, not live Slack testing. Native empty-member group mentions and customized progress edits are explicit release gates. No Slack workspace is changed by this documentation.

## Review decisions

- The proposed first release supports workspace installations in one Agenta project, not Enterprise Grid native handles or cross-project sharing.
- A message can select one agent. Conflicting native handles do not start a turn.
- Native groups contain no humans. If live tests show that empty groups do not support the required experience, this proposal must change before release.
- Adding an agent does not replace another agent. Removing one deployment does not uninstall the shared app.
