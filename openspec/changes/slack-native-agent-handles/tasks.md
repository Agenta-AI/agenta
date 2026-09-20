# Tasks

These tasks describe future implementation. All remain unchecked. Mahmoud must approve the design and request implementation before work starts.

## 1. Prove Slack prerequisites

- [ ] 1.1 In an approved paid test workspace, create a group with no members or default channels; verify autocomplete, both native mention token forms, message-event delivery, and no human notifications. Save sanitized evidence or stop this release if the gate fails.
- [ ] 1.2 Verify the bot-token group-management permission requirements and the three new scopes; record supported and denied workspace cases without adding user-token authorization.
- [ ] 1.3 Verify current message and app-mention subscriptions against their required scopes, including `app_mentions:read`; prove public and invited-private-channel delivery and capture any manifest correction required.
- [ ] 1.4 Verify customized progress posting followed by `chat.update`; confirm name and avatar remain stable and capture the accepted payload shapes.

## 2. Add storage and deployment ownership

- [ ] 2.1 Add address and operation models and a migration with connection, project, and team ownership constraints; verify upgrade, uniqueness, and rollback-preservation tests against two projects.
- [ ] 2.2 Add indexed address reads and an application-plus-connection deployment key; verify concurrent duplicate requests return one deployment and preserve existing defaults.
- [ ] 2.3 Add authenticated deployment, profile, retry, and removal operations with project-edit permission checks; verify another project's IDs and read-only users are refused.

## 3. Add eligibility and provisioning

- [ ] 3.1 Extend shared Slack scopes and store or verify granted scope state; test matching hosted and custom setup and a legacy token that remains operational without native deployment.
- [ ] 3.2 Preserve connection identity during reauthorization; test unchanged agents, grants, and threads and rejection of a callback for another installation.
- [ ] 3.3 Implement serialized create and read-back activation; test collisions, permission denial, unsupported plans, organization-install rejection, and receipt persistence before verification retry.
- [ ] 3.4 Implement unknown-outcome blocking and rate-limit retry handling; fault-inject a lost create response and verify no duplicate group or ownership claim occurs.
- [ ] 3.5 Implement managed-ID reconciliation and editor-requested rename or recovery; test external rename, disabled group, human membership, stale state, and no mutation of unrelated groups.
- [ ] 3.6 Implement local-first removal and verified external disablement; test failed disable retries, retained tombstones, default removal, and continued operation of a second agent.

## 4. Route native mentions

- [ ] 4.1 Extend normalized inbound addresses and Slack token parsing without breaking other adapters; verify both group token forms, forged labels, duplicates, bot echoes, and edit-event filtering.
- [ ] 4.2 Resolve addresses before conversation-owner fallback when native input is present; test active, disabled, unknown, conflicting, and cross-team or cross-project addresses.
- [ ] 4.3 Preserve legacy-only precedence and native target-specific approval ownership; test an open approval for triage with an explicit research mention and confirm no approval is consumed for triage.
- [ ] 4.4 Pass native selection through existing grant and policy admission; verify denied channels, excluded senders, mention-only and command-only policies, direct messages, and duplicate-event behavior.

## 5. Deliver per-agent identity

- [ ] 5.1 Add the optional sender profile to the adapter contract and resolve it from the thread agent; run all adapter contract tests with no profile to prove compatibility.
- [ ] 5.2 Snapshot trusted profile fields for the first post and every chunk; test progress, answer edits, approval cards, long replies, and profile changes during a turn.
- [ ] 5.3 Implement normal-bot fallback for absent customization permission and explicit rejection; test no identity-changing retry after an unknown post outcome and expose the degraded state.
- [ ] 5.4 Validate display names and public managed avatar assets; test unapproved URLs, private-network URLs, credential-bearing URLs, and attempted overrides from model output.

## 6. Update shared controls

- [ ] 6.1 Replace Slack retargeting with deployment-specific actions; test repeated deployment and confirm a second agent leaves the first reference, grants, and default unchanged.
- [ ] 6.2 Make grant controls and removal target the current deployment; test two agents with different permissions and label connection-wide allowed users clearly.
- [ ] 6.3 Add installation selection, roster, handle, and lifecycle states to shared UI; verify desktop and mobile show the same failed, active, retry, and reauthorization states.
- [ ] 6.4 Separate agent removal from installation disconnect and show affected agents; verify removal of one agent does not revoke the shared token and whole-installation removal requires confirmation.
- [ ] 6.5 Regenerate any changed public clients and run shared-action, desktop, and mobile checks; confirm Telegram and custom-app setup retain their prior behavior.

## 7. Validate release and migration

- [ ] 7.1 Run focused Slack adapter, grant, service, ingress, hosted lifecycle, and outbox suites plus database integration tests; record commands, source SHA, and results for each acceptance scenario.
- [ ] 7.2 Run a live two-agent flow through one installation, including native handles, progress identity, private channels, direct messages, thread switching, and approval ownership; record sanitized evidence.
- [ ] 7.3 Exercise upgrade from a legacy connection, partial provisioning recovery, external group drift, and feature rollback; prove legacy routing and unrelated deployments survive.
- [ ] 7.4 Run `openspec validate --all --strict --no-interactive` and `git diff --check`, then obtain rollout approval after the live gates pass. Archive the delta into main specs only after implementation and acceptance are complete.
