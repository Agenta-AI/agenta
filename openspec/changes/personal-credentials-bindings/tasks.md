Scope: the first step of M7 (owner decision, 2026-10-26). Custom secrets, the `specific` binding and organization-owned MCP servers, Composio connections and custom secrets are later steps (design D11).

Prerequisites, from CONTRACT.md section 14 (the contract wins): the code of M3 and M5. M7 does not wait for M6. It ships only after M5 and M9b are live.

## 1. Schema and parity

- [ ] 1.1 Add the `core_oss` revisions in design "Data structures"; run `api/scripts/migration_gate.py`.
- [ ] 1.2 Freeze parity fixtures: the credential each stored revision shape resolves under M5, in OSS and EE.

## 2. Binding service and claims

- [ ] 2.1 `core/credentials/` and `CredentialBindingService` with `caller_account` and `project_default`; refuse `specific`; replace `SecretMode` and the policy-level `SecretOwner`. Spec: connection-bindings.
- [ ] 2.2 Owner-scoped DAO methods; organization-row and project-row readers filter `user_id IS NULL`.
- [ ] 2.3 Sign `gateway_bindings` in `_prepare_invoke`, copy it in `issue_gateway_credentials`, apply it in the gateway and vault reads. Spec: "Bindings come from the server".

## 3. Personal credential stores

- [ ] 3.1 Composio owner, computed entity, owner in OAuth state; MCP user grants; user provider keys and personal subscription logins. Spec: personal-credentials.
- [ ] 3.2 Personal MCP servers: user rows in `mcps_endpoints`, scope `user` references in the MCP gateway. Spec: "Personal MCP servers are referenced explicitly", "Personal MCP servers".
- [ ] 3.3 Refuse personal and organization custom secrets until hidden secrets exist. Spec: "Custom secrets stay project-owned until hidden secrets exist".
- [ ] 3.4 `PersonalCredentialsService`, `end_for_member` from M1 `remove_member` and EE SSO; EE flag and audit events.

## 4. Sessions and installations

- [ ] 4.1 D6 guard and the M3 sharing refusal. Spec: personal-credential-sessions.
- [ ] 4.2 Channel turns use `linked_user_id` for `caller_account`; an unlinked user is refused at run time; no check when a channel binding is saved. `run_credential_uses` and the per-turn line.

## 5. Durable work edits

- [ ] 5.1 `DurableWorkEditPolicy` in the trigger and evaluation services; refusal names the executing principal; work that runs as an API key changes only with that key; reruns and copies take the starting principal. Spec: durable-work-edits.
- [ ] 5.2 Update the M2 scenario "Bob edits Alice's schedule" in `run-principal` when M7 ships, because this rule replaces it.

## 6. SDK, web, rollout

- [ ] 6.1 SDK reference fields and validation; web "My accounts" and "My MCP servers", the binding picker ("Each person's own account", "The project's shared account"), refusal messages, per-turn line; builder docs (`agenta_builtins.py`).
- [ ] 6.2 Enforce the design gate, then enable the per-organization flag.

## 7. QA matrix (OSS and EE)

| Test | Boundary |
| --- | --- |
| Every fixture from 1.2 resolves the same credential after release A | M5 meaning kept |
| A revision with `specific` is refused | first step scope |
| Every token mint carries `gateway_bindings`, including `inspect_workflow` and cached gateway credentials; a pre-M7 credential resolves as `project_default` | claims |
| Sandbox asks gateway and vault for a personal key on a `project_default` connection | claims |
| Concurrent invite and first personal use: exactly one wins | D6 lock |
| Shared web session refuses Bob's `caller_account`; it uses the project connection on `project_default` | shared-session rule |
| A shared session's sandbox never holds a user-owned credential; only the owner sends in a marked session | sandbox reuse |
| A linked Slack user's turn uses their own account; an unlinked user's turn is refused at run time; the Slack binding saves; an API-key run refuses a `caller_account` connection | caller rule |
| Bob's change to what Alice's schedule, subscription or evaluation run executes is refused; Bob can pause, stop, archive and delete it; Bob's copy runs as Bob (M7 edit rule) | durable work edits |
| Each schedule uses its own principal's accounts | caller rule |
| Door child run uses Alice's account; a run in another organization cannot | organization wall |
| Alice's and Bob's personal MCP servers with one slug: each run reaches its caller's server; no project fallback | personal MCP servers |
| Deleted or unavailable picked `project_default` connection: refused, no substitute | exact pick |
| A personal custom secret is refused | later step |
| While the gate is closed, no user row, user OAuth attempt, or `caller_account` binding can be written | mixed version |
| Owner leaves: only that organization's rows go, personal MCP servers included; Composio revoke failure does not block | lifecycle |
| Organization owner and EE no-RBAC admin cannot list or use another user's credential or personal MCP server | privacy |
| Added latency per run | performance |
