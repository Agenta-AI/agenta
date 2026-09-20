# Integration with the existing connection step

This is a proposed implementation contract. [PR #6395](https://github.com/Agenta-AI/agenta/pull/6395) already provides the connection-selection experience. Package installation should reuse it while moving resource creation and durable setup state into the backend. The requirements below do not claim that package installation has shipped.

## Existing behavior

The merged implementation defines `TemplateConnection` in `web/packages/agenta-entities/src/workflow/agentTemplates.ts`. Each slot has a purpose (`role`), a `required` flag, a primary integration, and alternative integration slugs. A slot represents one need, such as code hosting, rather than a list of accounts that must all be connected.

Desktop shows the connection card before Create. Mobile creates an agent and session first, then docks the card above the composer and holds the first message until Continue. Blank-agent and free-text mobile entries do not show the template card. The shared hook skips the card when no required account is missing and there is no provider choice. Optional-only needs without alternatives can therefore bypass the current card.

`AgentSetupSelection` carries detected accounts and connected provider slugs. `agentSetup.ts` checks whether any offered provider is connected and formats the result with `appendSetupPreamble`. This produces visible instructions such as “Use GitLab, not GitHub.” It does not persist a package binding to a particular account. `useSessionSetupStep.ts` depends on an in-memory pending task; PR #6395 records refresh loss of the held message as a known limitation.

The source baseline is [merge 3d304770](https://github.com/Agenta-AI/agenta/tree/3d304770949d1c10b9b66e33092db11b7d1a6dd3). Its older design pages include superseded pre-create mobile behavior. Use the merged code and final PR description when they disagree.

## Reuse and replacement

| Existing part                                                      | Package integration requirement                                                                                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentSetupCard`, including its docked layout and provider choices | Reuse the presentation and interaction patterns. Extend its input for package slot identities, concrete account selection, MCP choices, and saved dispositions.                          |
| `ConnectDrawer`, connection queries, and authentication callbacks  | Reuse account connection and secure credential collection. Re-read server connection state after callbacks before saving a binding.                                                      |
| `TemplateConnection` and static template registry                  | Retain for legacy cards. Derive migrated card requirements from the validated package summary. Do not maintain a second handwritten requirement list.                                    |
| `useAgentSetupStep` and pure rules in `agentSetup.ts`              | Preserve legacy behavior. Extract shared presentation rules where useful; use server installation requirements to drive package readiness. Provider slug presence alone is insufficient. |
| `appendSetupPreamble` and builder seeds                            | Keep for legacy and free-text flows. Package flows submit structured selections and receive backend-derived setup context instead of account-selection prose.                            |
| Mobile pending-task handoff                                        | Replace only for package cards with a persisted installation/session lookup and once-only greeting submission.                                                                           |
| Runtime approval cards                                             | Preserve their enforcement. Selecting an account never means approving writes or activating an automation.                                                                               |

## Mapping connection requirements

The package manifest remains the source of declared requirements. A shared adapter projects it into the card's display model. It must preserve these meanings:

| Meaning                       | Existing template field          | Package field or installation state                                          |
| ----------------------------- | -------------------------------- | ---------------------------------------------------------------------------- |
| Need shown to the user        | `role`                           | `purpose`                                                                    |
| Required versus optional      | `required`                       | `required`                                                                   |
| Available providers           | `primary.slug`, `alternatives`   | Typed `options` for gateway integrations or MCP servers                      |
| Display explanation           | `primary.scope`, `primary.tools` | Validated package metadata; never invent equivalent tools for an alternative |
| Stable slot identity          | No package identity              | Package digest, agent key, and connection key                                |
| Selected account              | Connected provider slugs         | Verified project connection or secret reference and selected option          |
| Unresolved or declined choice | Optional absence                 | Persisted disposition, including explicit optional skip                      |
| Permission enforcement        | Existing runtime policy          | Compiled native policy, bounded by existing approval enforcement             |

Keep data, policy, and credentials separate. Purpose and labels are display data. Options are declared configuration. A selected connection reference belongs to project installation state. Permissions are policy. Secret values belong only to the existing credential service. The frontend must not send native runtime configuration as the binding contract.

The manifest currently has no per-option ID. Derive a canonical option identity from `(kind, provider, integration)` for gateway options and `(kind, server)` for MCP options, scoped to the immutable snapshot and slot. Reject duplicate identities within a slot. Do not use labels or list positions as persisted identity. Define this encoding in the API models and shared contract tests before implementing bindings.

Do not round-trip packages through the legacy template shape: that would discard MCP options, agent identity, and saved dispositions. The adapter projects package requirements into a shared view model; it does not reinterpret a legacy card as a fully specified package.

## Proposed desktop and mobile flow

1. Fetch a validated package summary. Preview every agent and its requirements, including child-agent requirements. Show unsupported options with a reason. Reject a package that has no supported option for a required need before creating resources.
2. Desktop retains connection selection before Create. Missing required bindings block that action; optional slots do not. Mobile retains Create followed by a connection card in the session. For packages, Create starts a backend installation, not a separate blank-agent create followed by another install.
3. Both surfaces reuse existing active accounts when the match is unambiguous. A provider alternative or multiple matching accounts requires a visible choice. A preselected account must be named and changeable. Do not silently choose the first connected provider or account.
4. Persist selections against the installation's agent and slot keys. The backend verifies project ownership, active state, selected option membership, and supported configuration. An authentication success callback is not proof of a valid binding.
5. Mobile Continue requires all required connection slots to have verified bindings. Continue saves the choices before releasing the first setup turn. A timeout, dismissed card, or stale query cannot authorize the turn. Show a recoverable error and Retry when server state is unknown.
6. Optional omissions never disable Create or Continue. At that action, clearly state that unresolved optional connections will be skipped and persist those skips. If the card is bypassed, the detail view must disclose the omissions before Create. Skipped requirements are not raised again unless the user reopens them.
7. Install declared resources through the backend services and open the returned entry session. The entry agent resolves remaining user-specific facts and approved automation choices. The backend alone can mark the installation ready.
8. Refresh or return later by installation ID. Restore selected accounts, skipped requirements, progress, and the same setup session. Submit the visible greeting once. Setup guidance remains in trusted per-turn context.

Create on desktop and Continue on mobile are connection gates. Installation readiness is a separate backend gate that also checks resources and automation dispositions. Direct API installation may produce an unresolved installation; it must not enable ordinary runs. Setup-scoped operations may resolve those requirements under their existing authorization checks.

For example, if both GitHub and GitLab are connected and the user selects GitLab for a required code-host slot, the backend saves that exact account for that agent's slot. The compiled configuration and a safe verification call use GitLab. The presence of GitHub cannot satisfy or replace the saved GitLab choice. A second agent may use a different account for its own slot.

## Migration and rollout

Introduce one package-backed card behind the proposed server-side package flag. Keep the existing connection-step flag and legacy flows working independently. Disabling the new package entry point stops new package installs; it must preserve access to existing installations and their recovery path. Never fall back to creating a legacy blank agent after an installation request times out. First look up the original request's result.

Port the example package first. Keep catalog display and analytics keys stable. Replace each card's connection declaration with a generated package summary only when that package passes [validation and acceptance](validation.md). Retain playbooks for free-text creation. Do not migrate existing user agents or rewrite their permissions as part of this work.

## Responsibility boundaries

| Owner                      | Owns                                                                                  | Must not own                                                          |
| -------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Shared frontend entities   | Typed API clients, slot display adapters, installation queries                        | Resource creation loops, secret values, authoritative readiness       |
| Shared connection UI       | Choices, status, accessibility, retry actions                                         | Compiling runtime tools or granting permissions                       |
| Desktop/mobile host        | Placement, navigation, submitting intent                                              | Separate copies of binding or readiness rules                         |
| Package loader/compiler    | Validation and deterministic native configuration generation                          | Network writes, authentication flows, chat generation                 |
| Installation service       | Project authorization, step persistence, reconciliation, binding and readiness checks | Direct writes to other domains' tables or duplicate provider clients  |
| Existing resource services | Workflow, skill, file, connection, secret, trigger, and session lifecycle             | Interpreting package display copy as policy                           |
| Session context resolver   | Deriving setup scope from persisted session and installation                          | Trusting browser-supplied setup scope                                 |
| Setup agent                | Asking for unknown facts and proposing scoped changes                                 | Creating known package resources from prose or declaring itself ready |

Keep package persistence behind domain interfaces. Enforce project scope at every setup operation, not only at installation creation. New behavior should enter existing resource services through their supported interfaces. Tests must exercise those boundaries rather than only mock every dependency.
