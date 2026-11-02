# Tasks

Prerequisites: M1 to M4; M9 enforcement before the run-an-agent door. One pull request per delivery. Parentheses name the spec requirement.

## 1. D1 service identity

- [ ] 1.1 Release A schema, `AuthSourceRef`, readers for both shapes, service accounts domain, resolver rule. (Service account principal)
- [ ] 1.2 Key authentication: principal, source, origin; legacy routes make personal keys. (Personal and service API keys)
- [ ] 1.3 Source liveness check on every stored authority. (Authentication source liveness)
- [ ] 1.4 Installation turns as the connection's service account. (Installations owned by a service account)
- [ ] 1.5 Preview report on a production copy and owner review; data migration; release B writers. (One-time account creation; Stored references rewritten)
- [ ] 1.6 Release C after the drift check and the old Secret token lifetime. (Stored references rewritten)
- [ ] 1.7 Management routes, `web/mobile` settings, Fern client. (Service account management)

## 2. D2 personal projects

- [ ] 2.1 Columns, index, `ensure_personal`. (One personal project per organization and user)
- [ ] 2.2 Resolver rule; refuse invitations; prove every trace read path uses the resolver. (Owner-only membership)
- [ ] 2.3 `/m` create-agent paths. (New agents start in the personal project)
- [ ] 2.4 Listing, `/w` switcher, personal-space flag after full D2 rollout. (Personal project listing)

## 3. D3 agent moves

- [ ] 3.1 Refuse a move of an agent deployed to an environment; never delete a deployment. (Move refusals)
- [ ] 3.2 Moves DAO in the specified order. (Move order satisfies the foreign keys)
- [ ] 3.3 Preflight and move transaction, schedules, event. (Move refusals; Schedules on a move; Connections chosen again; Disclosure and event)
- [ ] 3.4 Routes and `web/mobile` share-by-move flow. (Move scope)

## 4. D4 doors

- [ ] 4.1 Door limits at run start. (Door eligibility)
- [ ] 4.2 `DoorsService`, the three doors, events. (Door check; Child run; Read files without storage credentials)
- [ ] 4.3 Routes, SDK ops, agent-workflows docs; find and read flags on after D1 release C; run-an-agent flag on after M9 runs on every pod. (Door events and routes; Run-an-agent activation gate)

## 5. QA matrix

OSS, and EE with RBAC on and off. Real-stack tests.

| Boundary | Test |
| --- | --- |
| Personal-project resolver | Organization owner and no-RBAC member get 403 on agents, sessions, files, traces; departed owner denied, schedule pauses. |
| Source liveness | Personal key after removal; service key after creator leaves; schedule, subscription and evaluation run after the key is deleted. |
| Personal key limits | Organization admin's personal key refused on an organization credential route; agent created with it has no access row. |
| Migration across rollout | Input and approval queued by an M2 pod as `api_key` and `installation` resume on release B with the mapped principal and source; release A reads B rows. |
| Move foreign keys | Agent with variants, 12 revisions, access row, mount, schedule with deliveries: row counts, old schedule paused with deliveries, new paused schedule in target. |
| Move refusals | Slug clash, running session, stale session passes, old prefix, source reference, attachment on a moved mount, environment deployment kept. |
| Door eligibility and check | Keys, installation, schedule, child and team runs refused; removal one second before the call; private agent hidden; viewer cannot run. |
| Child run | User as principal, `parent_run_id` set, result only in the personal session, target members see nothing. |
