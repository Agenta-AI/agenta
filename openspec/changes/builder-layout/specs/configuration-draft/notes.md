# configuration-draft: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements. The code contract is design.md D5.

## Words used in this file

- **Configuration content**: the Configuration content of the right panel (agent-panel capability). The Configuration page uses the same views.
- **Tab**: Agent, Automations, Channels, Access.
- **Agent tab**: the first tab. It holds the sections that make up an agent version.
- **Section**: Model, Instructions, Integrations, Subagents, MCP servers, Skills, Secrets, Permissions, Advanced.
- **Item**: one configuration item inside a section (an integration, a subagent, an MCP server, a skill, a secret attachment).
- **Version**: a saved revision of the agent configuration, shown as "vN". N counts up from 1.
- **Automatic save**: the production auto-commit. It saves the agent configuration as a new version about 1500 ms after the last edit. The capability keeps it as it is.
- **Draft store**: the production store of configuration edits that the automatic save has not saved yet (`workflowDraftAtomFamily`). A view with the target `agent_draft` writes here.
- **Dirty**: a view form with edits that the user did not apply with "Save".
- **Applies at once**: a change that the app stores when the user makes it, with no version.

## Which rule won

- Configuration tabs (contradiction 1). BEHAVIOR 10.2 and the canvas board S02 draw four tabs in the panel. The Configuration page (A04 to A06) draws three, and Channels is also its own page. This file follows the canvas: four tabs in the panel. The panel remembers the last tab (design.md D11, `configTab`).
- Saving (contradiction 2). The design draws a draft with "Save as vN". Mahmoud decided to keep production behavior: a change made is saved directly. The footer shows the production save status and the version ("Saved as v4"), and no "Save as vN" button.
- Tab name "Automations", not "Triggers" (BEHAVIOR 10.1).
- The model row: the canvas board S02 shows the readable name ("Claude Code · Claude Sonnet 5.5"), and F01 f1 shows the raw id. The model picker rule favors the readable name. PROPOSED.
- Row bin asks first. Note `n_f0` says "Remove from agent" in a view asks first, and that the row bin removes at once today. This file makes both paths ask with the domain dialog F06 f2, which lives in `@agenta/entity-ui` next to the agent sections. PROPOSED.
- The leave guard `confirmLeave` is specified in the agent-panel capability. This file says only what an open view form does when it asks.

## Today's behavior on `origin/main` (5d783fec)

- Draft store: `workflowDraftAtomFamily` per revision (`web/packages/agenta-entities/src/workflow/state/store.ts:1801`). It lives in memory.
- Automatic save: `web/packages/agenta-playground/src/state/execution/agentAutoCommit.ts`. It saves 1500 ms after the last edit (`DEBOUNCE_MS`, line 27), retries once after 3000 ms (line 29), keeps a quiet time of 2000 ms after the agent saved itself (line 31), and builds the commit message from the changes (`buildCommitSummaryMessage`, imported at line 18). Its status is `idle`, `saving` or `error` (line 33), with a "scheduled" flag (line 44). It skips any revision that is not an agent, an ephemeral onboarding agent and a local draft (`flushBlocker`, lines 85-97). This capability does not change it.
- After-save handlers: `registerAgentAutoCommitHandler` (`agentAutoCommit.ts:60-68`). The session pin uses it (`web/mobile/src/features/chat/SessionWorkspace.tsx:160-170`).
- The commit: `commitWorkflowRevisionAtom` (`web/packages/agenta-entities/src/workflow/state/commit.ts:205`). The request carries no `base_revision_id` (`web/packages/agenta-entities/src/workflow/api/api.ts:1084-1112`), so the last write wins: the API keeps last-write-wins when the field is left out (`api/oss/src/core/workflows/dtos.py:400-409`).
- Save status in the header: `AgentRevisionStatus` (`web/packages/agenta-playground-ui/src/components/AgentPageHeader/AgentRevisionStatus.tsx`). "Saving…" while a save is scheduled or in flight (line 128); a session adopts a newer version only when the state is settled (line 131); "Saved" shows for a moment after a save lands (lines 135-147); the dot labels "Not saved", "Saving…", "Draft" and "Saved" (lines 151-174). Texts: `playground.agentHeader.json` ("Saving…", "Draft", "Not saved", "Saved", "Update to v{{version}}", "Version history", "Retry saving changes").
- `autoSave` hosts: `AgentConfigHeader` hides its commit button when `autoSave` is set (`web/packages/agenta-playground-ui/src/components/AgentConfigHeader.tsx:70`). Two hosts set it: `web/mobile/src/features/chat/ConfigPane.tsx:102` and the classic app header. The panel configuration content keeps the prop as production does.
- Version history revert: `revertAgentRevisionAtom` (`web/packages/agenta-playground/src/state/execution/agentVersionHistory.ts:94`) refuses while the automatic save is busy (line 100, `isAgentAutoCommitBusy`, `agentAutoCommit.ts:73-77`), stages the old configuration and its schemas, saves through the automatic save, and puts a prior draft back when the save does not land. The revert dialog: `web/packages/agenta-playground-ui/src/components/AgentVersionHistory/RevertConfirmDialog.tsx`; texts `playground.versionHistory.json:10-18`.
- Secret attach, two callers of one commit path `commitAgentCredentialsAtom` (`web/packages/agenta-entities/src/workflow/state/agentCredentials.ts:84`). It refuses while the configuration is dirty (line 96) and commits on the variant head (comment at lines 76-83). Caller 1: the Secrets section (`AgentSecretsSection.tsx:88`). Caller 2: the secret request dock in a chat (`web/packages/agenta-entity-ui/src/clientTools/SecretRequestDock.tsx:111`, blocked while dirty at line 302, text "Save or discard your agent changes first." at line 379). The dock keeps this behavior.
- Leave guards today: the Files draft guard (`web/packages/agenta-entities/src/drive/useDriveFileEditor.ts:213`) and the automation guard (`web/mobile/src/features/automations/useUnsavedGuard.ts:25`). Form views with Cancel and Save are new; their guard is new.
- Section list: `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx:1140-1352` builds Model, Instructions, Integrations, Subagents, MCP servers, Skills, Permissions, Advanced. Secrets render inside the model body (`agentTemplate/useModelHarness.tsx:659`). The design moves Secrets to its own section after Skills.
- Integrations "+" is a menu with "Create with AI" and "Browse integrations" (`AgentTemplateControl.tsx:1203-1213`). The design sends "Create with AI" to the Builder panel (builder-panel capability).
- Row tags and the bin: `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/ItemRow.tsx`. The bin removes at once (lines 219 to 230 and 300 to 310). The tag "old format" and the empty texts are in `entityUi.configItems.json:15-18`.
- Instructions editor: `InstructionsDrawer.tsx` is a 920 px drawer (line 124) with an Edit and Preview switch and a rail of suggested sections (lines 45 to 60 and 81). The editor is the shared `MarkdownEditor.tsx`.
- Run of a message: `buildAgentRequest` (`web/packages/agenta-playground/src/state/execution/agentRequest.ts:307`) reads the draft-aware configuration (line 325) and leaves out `application_revision` when the configuration is dirty (lines 369-393). This capability does not change it.

## Known behavior of production (not changed)

When a person edits the agent while the builder saves a version, the automatic save saves the person's configuration as the next version with no base check, so the last write wins. The builder's version stays in the version history. OPEN-QUESTIONS group 3 lists this case.

## Other places that mount the changed parts

- `AgentTemplateControl` renders wherever an agent revision configuration renders, through `SchemaPropertyRenderer.tsx:509`: the session configuration, the playground, revision views.
- `AgentRevisionStatus` is used by the classic playground header too. It does not change.
- `MarkdownEditor` serves AGENTS.md and SKILL.md everywhere, including the Skills page drawers.
- `ItemRow` is used by every configuration list.

## Backend work

None.

## States described but not drawn

The save running, the save failed, the open form when a newer version lands, the revert during a save, the empty AGENTS.md editor. The canvas draws the Agent tab (F01 f1, S02, F02 f1) and the five dialogs (F06). The canvas draft footer with "Save as v5" (F02 f1) is not built; the footer shows the production save status.

## Open questions

- None in this capability.

## Text

- From the canvas, new: "None", "{{count}} attached", "Policy · {{policy}}", "Remove {{name}} from this agent?", "The connection stays in the project. {{count}} skill mentions {{name}}.", "Normal text", "Source".
- From production: "No integrations yet", "old format", "Needs setup" and its reasons, "You have unsaved changes", "Keep editing", "Discard", "Save changes", "Saving…", "Draft", "Not saved", "Saved", "Version history", "Revert to v{{version}}?", the revert description, "Revert failed. Wait for any save to finish, then try again.", "Revert", "Cancel", "Save", "Remove", "{{count}} integration", "{{count}} skills".
- Text not written; listed for Mahmoud: the description of the unsaved-changes dialog for a view with the target `agent_draft` (it must say that "Save changes" applies the form and the agent saves a new version).
- Not confirmed: none from HANDOFF section 5 in this capability.
