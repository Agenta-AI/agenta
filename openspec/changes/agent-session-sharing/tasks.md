## 1. Baseline and migration evidence

- [ ] 1.1 Inventory all agent/session reads, writes, streams, exports, templates, mounts, and worker entry points.
- [ ] 1.2 Produce the migration classification preview and confirm human-creator evidence.
- [ ] 1.3 Freeze legacy access fixtures for prompts, evaluations, API keys, roles, and analytics in OSS and EE.

## 2. Data and services

- [ ] 2.1 Add agent_access, session access columns, session_grants, and channel artifact parent with constraints and indexes.
- [ ] 2.2 Implement transactional creation, transfer, make-private, invitation, and Only me operations.
- [ ] 2.3 Put membership persistence behind a DAO interface while preserving one capability resolver.
- [ ] 2.4 Implement mandatory resource decisions and typed query scopes; protect generic update routes.

## 3. Entry points and channels

- [ ] 3.1 Apply artifact access to direct revisions, lists, clones, templates, skills, and file credentials.
- [ ] 3.2 Apply session roles to reads, sends, approvals, lists, files, exports, and live streams.
- [ ] 3.3 Carry bounded installation context through Slack and tools; preserve routing and reply behavior.
- [ ] 3.4 Pause external grants on privatization; recheck schedules, subagents, queued work, and sensitive actions.

## 4. Interface and compatibility

- [ ] 4.1 Add agent sharing and make-private controls with dependency preview and owner selection.
- [ ] 4.2 Add session Viewer/Participant invitations and explicit project read sharing.
- [ ] 4.3 Disclose project trace-reader access and Slack history audience in the relevant setup/sharing screens.
- [ ] 4.4 Keep trace defaults; show denied metrics as unavailable and verify billing/quotas remain separate.

## 5. Validation and rollout

- [ ] 5.1 Run access scenario fixtures through both direct services and database list predicates.
- [ ] 5.2 Test alternate reads and worker calls in OSS and EE with entitlements on and off.
- [ ] 5.3 Test concurrent sharing writes, membership removal, stream rechecks, and storage expiry.
- [ ] 5.4 Test legacy workflow clients and migration restart, unresolved parents, and rollback without privacy downgrade.
- [ ] 5.5 Enable private UI defaults only after complete access-path coverage; publish measured revocation limits.
