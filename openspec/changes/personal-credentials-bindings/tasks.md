## 1. Schema and parity

- [ ] 1.1 Add the `core_oss` revisions in design "Data structures"; run `api/scripts/migration_gate.py`.
- [ ] 1.2 Freeze parity fixtures: the credential each stored revision shape resolves under M5, in OSS and EE.

## 2. Binding service and claims

- [ ] 2.1 `core/credentials/` and `CredentialBindingService`; replace `SecretMode` and the policy-level `SecretOwner`. Spec: connection-bindings.
- [ ] 2.2 Owner-scoped DAO methods; organization-row readers filter `user_id IS NULL`.
- [ ] 2.3 Sign `gateway_bindings` in `_prepare_invoke`, copy it in `issue_gateway_credentials`, apply it in the gateway and vault reads. Spec: "Bindings come from the server".

## 3. Personal credential stores

- [ ] 3.1 Composio owner, computed entity, owner in OAuth state; MCP user grants; user provider keys and subscription logins. Spec: personal-credentials.
- [ ] 3.2 `PersonalCredentialsService`, `end_for_member` from M1 `remove_member` and EE SSO; EE flag and audit events.

## 4. Sessions and installations

- [ ] 4.1 D6 guard and the M3 sharing refusal. Spec: personal-credential-sessions.
- [ ] 4.2 Installation check in `ChannelsService`; `run_credential_uses` and the per-turn line.

## 5. SDK, web, rollout

- [ ] 5.1 SDK reference fields and validation; web "My accounts", binding and agent account pickers, refusal messages, per-turn line; builder docs (`agenta_builtins.py`).
- [ ] 5.2 Enforce the design gate, then enable the per-organization flag.

## 6. QA matrix (OSS and EE)

| Test | Boundary |
| --- | --- |
| Every fixture from 1.2 resolves the same credential after release A | M5 meaning kept |
| Every token mint carries `gateway_bindings`, including `inspect_workflow` and cached gateway credentials; a pre-M7 credential resolves as `project_default` | claims |
| Sandbox asks gateway and vault for a personal key on a non-`caller_account` connection | claims |
| Concurrent invite and first personal use: exactly one wins | D6 lock |
| Shared web session refuses Bob's `caller_account`; Slack channel session uses the project agent account | shared-session rule |
| A shared session's sandbox never holds a user-owned credential; only the owner sends in a marked session | sandbox reuse |
| Bob's edit of Alice's schedule is refused (M2); each schedule uses its own principal's accounts | caller rule |
| Door child run uses Alice's account; a run in another organization cannot | organization wall |
| Deleted or unavailable `specific` credential: refused, no substitute | exact binding |
| While the gate is closed, no user row, user OAuth attempt, or non-default binding can be written | mixed version |
| Owner leaves: only that organization's rows go; Composio revoke failure does not block | lifecycle |
| Organization owner and EE no-RBAC admin cannot list or use another user's credential | privacy |
| Added latency per run | performance |
