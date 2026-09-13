# Codebase research

## Current user-facing behavior

Custom-secret storage merged in [#4882](https://github.com/Agenta-AI/agenta/pull/4882).
HTTP MCP secret resolution merged in [#5296](https://github.com/Agenta-AI/agenta/pull/5296),
and inline secret creation merged in [#6143](https://github.com/Agenta-AI/agenta/pull/6143).
Old local-tools documents that call all custom secrets storage-only are historical.

Daytona credential delivery merged in
[#5670](https://github.com/Agenta-AI/agenta/pull/5670) and became default-on in
[#5705](https://github.com/Agenta-AI/agenta/pull/5705). Those paths handle model and HTTP
MCP consumers. They do not implement general agent environment attachments.

## Relevant implementation entry points

Paths below were inspected on refreshed `origin/main`, except the platform-instruction
module, which was read from #6365's remote head. These are implementation locations,
not promises that the proposed fields already exist.

| Responsibility               | Existing path and finding                                                                                                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secret shape                 | `api/oss/src/core/secrets/dtos.py`: custom secret settings contain `format` and `content`; no delivery policy.                                                                                                                            |
| Vault access                 | `api/oss/src/apis/fastapi/vault/router.py`: project-scoped CRUD; `_for_caller` reveals write-only values only with `secret-resolve`.                                                                                                      |
| Runtime grant                | `api/oss/src/apis/fastapi/access/router.py`: `_run_credential_grants` requires platform-runtime proof or an existing verified grant.                                                                                                      |
| Named resolution             | `sdks/python/agenta/sdk/agents/platform/secrets.py`: explicit slug reads, text-only extraction; unresolved values currently return a partial map. New attachment caller must require every binding.                                       |
| Agent template               | `sdks/python/agenta/sdk/agents/dtos.py`: `AgentTemplate.from_params` parses `parameters.agent` and validates known shape. New nested credentials need schema/parser support.                                                              |
| Wire types                   | `sdks/python/agenta/sdk/agents/wire_models.py`, `utils/wire.py`, `services/runner/src/protocol.ts`: Python/TypeScript serialization boundary.                                                                                             |
| Daytona composition          | `services/runner/src/engines/sandbox_agent/daytona-secret-plan.ts`: separate typed model/MCP consumers, collisions, and restricted local-use provider bindings. Arbitrary custom secrets cannot be inserted into those provider bindings. |
| Runtime identity             | `services/runner/src/lifecycle/desired-state.ts` and `engines/sandbox_agent/session-identity.ts`: structure and credential material have separate tracking. Both identity views must stay consistent.                                     |
| Existing secret form         | `web/packages/agenta-entity-ui/src/secret/SecretForm/` and `CreateSecretDrawer.tsx`: reuse text creation and vault mutations.                                                                                                             |
| Existing client interaction  | `services/runner/src/engines/sandbox_agent/client-tools.ts`: common pause/correlation mechanism for browser-fulfilled tools.                                                                                                              |
| Existing connection flow     | `web/packages/agenta-entity-ui/src/clientTools/useConnectFlow.ts`: reference-only results, single settlement, explicit cancellation and failure. OAuth details do not belong in the custom-secret flow.                                   |
| Tool catalog                 | `api/oss/src/core/workflows/static_catalog.py` and `sdks/python/agenta/sdk/agents/platform/workflow.py`: reserved platform client-tool definitions and resolution.                                                                        |
| Host resume                  | `web/packages/agenta-playground/src/state/execution/agentApprovalResume.ts` and `agentRequest.ts`: client-tool resume eligibility and the run's configuration target.                                                                     |
| Revision conflict protection | `api/oss/src/core/workflows/service.py`: ordered commits require `base_revision_id` and reject a moved variant head. Reuse this for attachment writes.                                                                                    |

## Platform-instruction dependency

[#6365](https://github.com/Agenta-AI/agenta/pull/6365) at
`ecb28ea14b3664f64da010948b8bf621db0fa0b9` introduces
`sdks/python/agenta/sdk/agents/platform_instructions.py`. Its base currently tells the
agent to use documented tools and never invent results. It has no secret-handling rule.

Its runner composes the shared text before author text at environment build. Pi uses
append-system text; Claude and Codex use instruction files. Generated instructions stay
outside lifecycle identity, so warm environments retain their previous text. Its reported
live QA covers Pi; the full local/Daytona and harness matrix remains unverified.

## Implementation checks still required

Confirm the caller's runtime grant reaches custom-secret resolution in all hosted run
paths. Public standalone vault reads cannot reveal write-only values and must not be
weakened to make that case work.

Trace the revision selected after client-tool settlement in desktop, EE, and mobile.
An existing `request_connection` reference-only result does not prove that a new agent
revision will be selected automatically. The feature needs an explicit host update.

Measure the existing reopen/rebuild behavior for changed process credentials and restored
conversation history. A documented lifecycle hook is not proof that each harness reloads
its environment. These checks are implementation acceptance gates, not evidence collected
by this design PR.
