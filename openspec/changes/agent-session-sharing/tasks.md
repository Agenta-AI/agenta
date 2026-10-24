## 1. Preconditions

- [ ] 1.1 Confirm M1 and M2 are merged (CONTRACT.md sections 2 to 6).
- [ ] 1.2 Inventory every agent and session entry point (reads, lists, exports, streams, templates, clones, skills, mounts, reference tools, workers, channels) and every execution boundary (design D7), with the service method each must call.
- [ ] 1.3 Write one fixture set with every role and principal kind, for OSS and EE.

## 2. Data

- [ ] 2.1 Add the `core_oss` schema revision and the one-time data revision (design: Migration, D9); run the migration gate. Spec: Existing agents after migration, Existing chats after migration.
- [ ] 2.2 Add `oss/src/dbs/postgres/sharing/` with the lock, the `expected` compare and the delta write (design D5; spec: Sharing writes are serialized and rechecked).
- [ ] 2.3 Add `WorkflowsDAO(GitDAO)` and the non-committing insert helper (design D3; spec: Private agent creation is atomic).

## 3. Core

- [ ] 3.1 Add `core/sharing/` with `initial_policy` (design D2; specs: Policy of a new agent, Every session insertion path, Channel sessions).
- [ ] 3.2 Add `ResourcePolicyInterface`, the required `resource_policy` in every composition root, and `Permission.MANAGE_AGENT_OWNERSHIP` (design D8; specs: Resource policy step, Shortcuts).
- [ ] 3.3 Add principal-derived read scopes to the workflow and session list queries (spec: List scopes match direct reads).
- [ ] 3.4 Pass a required `AccessPolicy` on the four session insert paths, with the `visibility` query parameter on the rename create arm (design D4).
- [ ] 3.5 Add `RunAdmission` and call it at every boundary of design D7 with the execution target of the current turn; add `resolve_agent_artifact_id` with `AgentReferenceUnresolved`; move the `prior_stream` read in `_heartbeat_locked` to the top and authorize every beat before any lock, write or response, with the verified-continuity shortcut of design D7 (specs: Execution admission checks the session and the agent; Admission checks the execution target of the turn; Every heartbeat is authorized before it writes or answers).
- [ ] 3.6 Add the cached policy reads and `invalidate_sharing_caches` of design D9a (spec: Policy reads are cached and invalidated by sharing writes).
- [ ] 3.7 Add `MembershipsService.query_project_members` and the audit events (design D10; specs: Manage session sharing, Sharing changes are audited).

## 4. Entry points and web

- [ ] 4.1 Call `decide` with a resource on every entry point from task 1.2, including approval answers and channel agent activation.
- [ ] 4.2 Regenerate the Fern client and add `getSharingClient`; add the `@agenta/entities/sharing` subpath with project-scoped query keys and `getHostQueryClient` invalidation.
- [ ] 4.3 `/m`: agent privacy, transfer, take ownership, share dialog with the member picker, disclosure, Slack setup notice; Storybook stories; package tests under `tests/unit/`.
- [ ] 4.4 `/w`: create new chats through the rename create arm with `visibility=project`, and send `visibility=project` on new agents (spec: Omitted visibility uses the owner default). Record the `web/AGENTS.md` exception.

## 5. Docs and config

- [ ] 5.1 Update `docs/design/sharing-program/`, add the access invariants to `api/AGENTS.md` and the `/w` exception to `web/AGENTS.md`, and add a user docs page on private agents, shared sessions, roles, credential lifetimes and the trace exception. Confirm that no env var, compose env example, Kubernetes value, Helm chart or Railway setting changes.

## 6. QA matrix

Run every scenario through direct reads and lists, in OSS and EE, RBAC on and off. Real-stack boundary tests:

| Boundary | Test |
| --- | --- |
| Trigger claim | Schedules of a human and of an API key: owner set at claim, unchanged by heartbeats. An environment-bound trigger whose target became private is paused. |
| Admission | First beat into another member's private session, and with a private agent: refused, nothing invoked. A queued input after the grant is revoked, and a resume after the owner lost the agent: settled failed. |
| Atomic private creation | Fault after the artifact insert leaves no artifact. |
| Concurrent sharing | Two take-ownership calls; transfer against make-private; "Only me" against a grant add (integration only). |
| List parity | Human, API key, installation, including the key creator's private items. |
| Ownerless creation | API-key (also personal-key) and Slack tool calls create ownerless agents with no `agent_access` row and never fail. |
| Default visibility | Chat and agent with omitted visibility: private for a human, project for an API key; the rename create arm with `visibility=project` creates a project-visible chat. |
| Backfill | A legacy row and a new API-key row together, data revision run twice: only the legacy row changes. |
| Shared turns, approval resume (M2 contract) | Bob's turn runs under Bob's authority; Bob approves Alice's turn: Alice's authority, `approved_by` Bob. |
| Live `/m` | Private agent and chat; Viewer and Participant sharing; "Only me"; owner leaves and admin takes ownership; Slack notice. |
| Live `/w` | Login and project list; project switch; invite and role change; prompts, evaluations and playground work; new chats and agents are project-visible; Bob reads Alice's chat and his send shows a clear error; workspace-shaped API answers load the app. |
| Docs and config | Task 5.1 is done and matches the behavior. |
