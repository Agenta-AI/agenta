# secrets-permissions-advanced: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements.

## Words used in this file

- **View**, **container**, **root**, **child view** (a view at depth 2), **unsaved edits**, **dirty**: as defined in the `agent-panel` capability.
- **Target**: where a view writes on Save (design.md D2). The Agent tab views (Secrets section, attach view, Permissions, Advanced parts) use `{kind: "agent_draft", revisionId}`. Settings › Secrets uses the one secret form with `{kind: "project"}`, which writes the vault at once.
- **Automatic save**: the production auto-commit, which saves the agent configuration as a new version about 1500 ms after an edit (`web/packages/agenta-playground/src/state/execution/agentAutoCommit.ts:27`). The `configuration-draft` capability keeps it.
- **Secret**: a named value in the project vault, for example an API token. The vault stores it encrypted.
- **Secret attachment**: one entry in the agent configuration (`agent.sandbox.credentials`) that gives the agent one secret through one environment variable. Production calls it a binding.
- **Environment variable**: the name, for example `GITHUB_TOKEN`, under which the agent's sandbox receives the secret value.
- **Scope tag**: the tag at the right of a secret in the attach list. "Everyone" marks a project secret that every run can use. "Only me" marks a secret that belongs to the signed-in person.
- **Personal accounts**: the deployment switch `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED`. It is off by default today; task 10.1 turns it on by default (DECIDED, a configuration default). An installation can still set it to false. While it is off, no person-owned secret exists and no "Only me" choice shows.
- **Account choice**: a per-person record that says which of that person's own secrets an agent uses for one environment variable. It is not part of the agent version.
- **Permission policy**: the agent's default rule for tool calls (`runner.permissions.default`).

Text marks: text in quotes comes from the canvas or from production. Text marked "(not confirmed)" is in HANDOFF section 5 and needs Mahmoud's approval.

## Today's behavior on origin/main (5d783fec)

Paths start at the repo root. `SC/` means `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/`. `ES/` means `web/packages/agenta-entity-ui/src/secret/`.

- Secrets live in the Advanced drawer today (630 px: `INTEGRATION_DRAWER_WIDTH` 580 in `SC/agentTemplate/drawerWidths.ts:2` plus 50 in `SC/agentTemplate/useModelHarness.tsx:851`). The drawer has a left rail with Execution, Custom secrets, Agenta tools and Build kit (`SC/agentTemplate/useModelHarness.tsx:720-770`). The secrets panel renders `AgentSecretsSection` (`SC/agentTemplate/useModelHarness.tsx:658-668`). Production calls the part "Custom secrets" (`entityUi.modelHarness.customSecrets`); the canvas calls the section "Secrets".
- Secret scopes on the server: `Scope = Literal["project", "organization", "user"]` (`api/oss/src/apis/fastapi/vault/router.py:98`). `user` needs a signed-in person (`router.py:447-454`, `:482-488`). `organization` needs an organization owner or admin (`router.py:456-465`). `project` needs `EDIT_SECRET` to create (`router.py:467`) and `VIEW_SECRET` to list (`router.py:497-502`).
- The attach modal is 480 px (`ES/AgentSecretAttachmentModal.tsx:338`). Its list holds the project text secrets from the vault list (`ES/AgentSecretAttachmentModal.tsx:119-155`; the list call sends `include_organization: true`, `web/packages/agenta-entities/src/secret/api/api.ts:41-44`). It holds "Each person's own secret" first when personal accounts are on (`ES/AgentSecretAttachmentModal.tsx:231`, `:403`) and "Create new secret" last (`:419`). It does not list the person's own secrets by name today. Listing them needs `GET /secrets?scope=user` (`router.py:482-488`), which exists.
- "Each person's own secret" writes `{account_source: "user"}` (`ES/AgentSecretAttachmentModal.tsx:251`). A new "Only me" secret is saved as the person's secret, the account choice is stored, and then the attachment is written with `account_source: "user"` (`ES/AgentSecretAttachmentModal.tsx:275-291`). So the design rule "an Only me secret means other people pick their own" is what production does for a new "Only me" secret. Picking an existing own secret from the list by name is new.
- "Who can use it" shows only when personal accounts are on and the person may create project secrets (`ES/agentSecretRules.ts:30-36`, `ES/AgentSecretAttachmentModal.tsx:461`).
- **What happens today when an attach is made:** the modal calls `commitBinding` (`SC/agentTemplate/AgentSecretsSection.tsx:100-107`), which calls `commitAgentCredentialsAtom` (`:90-98`). That atom saves a new agent version at once with the message "Update agent secret attachments" (`web/packages/agenta-entities/src/workflow/state/agentCredentials.ts:84-121`). It builds on the variant head and refuses when the head's attachments differ from the shown ones. Attach and remove are blocked while the agent has unsaved changes (`SC/agentTemplate/AgentSecretsSection.tsx:88`, `:94`; `ES/AgentSecretAttachmentModal.tsx:515`) and before the agent has a saved version (`AgentSecretsSection.tsx:91-93`).
- **What stays:** the Agent tab attach, edit and remove keep this production path: each saves a new version at once, and the production rule for unsaved changes stays. The views change; the save path does not. The vault write and the account choice stay immediate.
- **The secret request dock keeps its own commit.** The dock (`web/packages/agenta-entity-ui/src/clientTools/SecretRequestDock.tsx:111`, `:215`) calls `commitAgentCredentialsAtom` too. Today that atom commits on the variant head with `base_revision_id` set to the head (`agentCredentials.ts:84-125`, `:119`), and it refuses while the configuration is dirty (`agentCredentials.ts:96-98`). The dock keeps its production behavior: with unsaved changes it disables its attach and shows "Save or discard your agent changes first." (`SecretRequestDock.tsx:302, 379`), and it never moves a draft onto the new revision. Production copies edits typed during the request onto the new revision only when the commit was built on the shown revision (`agentCredentials.ts:164-168`). The head check that refuses when the head's attachments differ from the shown ones stays (`agentCredentials.ts:107-111`). The dock reads the dirty flag of one revision (`SecretRequestDock.tsx:113`), as today. The secrets milestone owns the file after task 8.4.
- The broken row uses the server's needs-setup check (`SC/agentTemplate/AgentSecretsSection.tsx:178-198`) and the production reason "Not found in this project" (`web/packages/agenta-i18n/locales/en/entityUi.needsSetup.json:8`).
- The remove dialog exists in production with the same text (`SC/agentTemplate/AgentSecretsSection.tsx:266-290`). In the new layout it is a domain dialog (F06 f3) and lives next to the secret views in `@agenta/entity-ui` (`ES/` or the Secrets section file), not in the view stack package `@agenta/ui`.
- The permission policy select is inline in the Permissions section (`SC/AgentTemplateControl.tsx:1313-1333`, `SC/agentTemplate/useModelHarness.tsx:635-654`). The preset texts are in `web/packages/agenta-i18n/locales/en/shared.permissionPolicy.json`.
- Execution shows only with more than one sandbox (`SC/agentTemplate/useModelHarness.tsx:453`). Its body is one Sandbox select (`:614-633`). Agenta tools come from `useAgentaTools` (`SC/agentTemplate/AgentaToolsSection.tsx:176`, used at `useModelHarness.tsx:406`). The production line is "Tools your agent can use wherever it runs: the playground, the API, Slack, Telegram, WhatsApp and automations. Saved with the agent." (`entityUi.buildKit.agentaToolsHint`). The canvas shows a shorter line; the F04 f10 note says "Same body as today", so keep the production line.

## Every place that mounts the changed components (re-verified)

- `AgentSecretAttachmentModal`: `SC/agentTemplate/AgentSecretsSection.tsx:247` and the chat secret request dock `web/packages/agenta-entity-ui/src/clientTools/SecretRequestDock.tsx:569`, which `web/mobile/src/features/chat/LiveConversation.tsx:1010` mounts. The new list (tags, no "Each person's own secret") shows in the dock too.
- `AgentSecretsSection`: only `SC/agentTemplate/useModelHarness.tsx:659`. It moves to its own section file in the foundation split.
- `OwnerRadioGroup` ("Who can use it"): `ES/AgentSecretAttachmentModal.tsx:463`, `web/mobile/src/features/settings/SecretFormSheet.tsx:253`, `web/packages/agenta-entity-ui/src/gatewayTool/drawers/ConnectDrawer.tsx:284`, `web/packages/agenta-entity-ui/src/secretProvider/ProviderConnectionCard.tsx:713`. The design asks for the integration two-choice control here; the `integrations-accounts` capability defines how it behaves in the connect form. The file `OwnerRadioGroup.tsx` has one owner, the secrets milestone (the working plan's file ownership map), so all four places keep one implementation. A change to `OwnerRadioGroup` changes all four places.
- `PermissionPolicySelect`: `SC/agentTemplate/useModelHarness.tsx:640`, `SC/agentTemplate/IntegrationPermissionDrawer.tsx:337, 629`, `SC/agentTemplate/accounts/AccountBlock.tsx:30`. This capability does not change the select itself.
- `AgentaToolsSection`: `SC/agentTemplate/AgentaToolsSection.tsx:218` and its unit test `web/packages/agenta-entity-ui/tests/unit/agentaToolsSection.render.test.tsx`.
- Every host of `AgentTemplateControl` (`SC/SchemaPropertyRenderer.tsx:509`): session config pane, playground, evaluator playground and editor, create prompt, revision drawer (see the `skills` capability notes for the lines).
- Settings › Secrets (`web/mobile/src/features/settings/SecretsTab.tsx:37, 41`) changes only where its create form becomes the one secret form (see below).

## Duplicate implementations to merge

- The secret create form exists twice: `web/mobile/src/features/settings/SecretFormSheet.tsx` (value typed as JSON text) and the package `SecretForm` / `SecretCreateFields` (`ES/`). The attach view uses the package form. The secrets milestone merges them into one view that the attach view and Settings › Secrets both mount (tasks.md 20.3; design.md D3, one view everywhere). Settings › Secrets mounts it with the target `{kind: "project"}`.

## Backend work and scope

- None required. The `user` scope list, the account choices and the commit route exist. The save path does not change.
- Gap in production that the design does not ask to change: there is no separate permission to attach a secret to an agent, and any project viewer can read and use any project secret (`api/oss/src/core/access/permissions/types.py:79-80`).

## States described and not drawn

- Empty Secrets section (production text used).
- The Execution page (described in the F04 f10 note only).
- Build kit in Advanced (in the 18 November item list, not drawn).
- Loading and error states of the attach view (production behavior used).

## Text

Not confirmed (HANDOFF section 5): "Only you can use this secret. Other people pick their own secret when they run the agent."

New text from the canvas that is not in the production locale files: the scope tag "Everyone" (production has "Everyone in {project}"), the section name "Secrets" (production "Custom secrets"), "Policy · Allow reads" uses the production pattern `entityUi.modelHarness.policySummary`.

Open questions:
- DESIGN-STATUS Version 65 asks what "Each person's own" means after a shared secret is picked. This file answers: nothing; the tag decides, and a shared secret is used by every run.
- Organization secrets that the project may use show in today's list. This file tags them "Everyone". Confirm.

## Tasks

Section 20 of `tasks.md` (20.1 Secrets section, 20.2 attach and the remove dialog, 20.3 one secret form, 20.4 Permissions and Advanced). The dock keeps its production behavior.
