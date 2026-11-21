# skills: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements.

## Words used in this file

- **View**, **container**, **root**, **unsaved edits**: as defined in the `agent-panel` capability. A view is a screen with no drawer, page or panel code. A container mounts it. A container shows a root (its base screen, not in the stack) and up to two views on top of it (depth 1 and depth 2). A **wide view** asks the panel for 760 px.
- **`apply`** and **`target`**: the two settings of a view (design.md D2). `apply: "immediate"`: a change reaches the target at once and the view has "Done". `apply: "on_save"`: the view has "Cancel" and "Save", and only Save writes. `target: {kind: "agent_draft", revisionId}` writes the agent configuration through the production draft store, and auto-save saves it as a new version; `target: {kind: "project"}` writes a project resource on the server.
- **`ConfigItemRef`**: the address of one configuration item, `{list, key}`, the same shape as the target segment of a builder operation (design.md D2). A skill is in the list `skills`; the key is the skill name.
- **`useViewTitle`**: the hook a view calls to put its own title in the breadcrumb.
- **Draft**: the production draft store of the agent configuration. Auto-save commits it as a new version about 1500 ms after a change, as production does (`web/packages/agenta-playground/src/state/execution/agentAutoCommit.ts:27`).
- **Skill**: a folder with a SKILL.md file and optional bundled files. It has one name, its production Name, for example "ticket-triage". There is no second readable title.
- **Skill registry**: the project's shared list of skills, shown on the Skills page.
- **Registry skill**: a skill that lives in the skill registry. The agent holds a reference to it. Today this is an `@ag.embed` entry in the agent's `skills` list.
- **Agent-only skill**: a skill that lives only inside one agent's configuration. Today this is an inline skill entry in the agent's `skills` list.
- **Built-in skill**: a skill that Agenta provides (slug starts with `__ag__`). It is read only.
- **Skill view**: the one view that shows and edits one skill. It replaces both production drawers.
- **File menu**: the menu that the file button of the skill view opens. It lists the files of the skill.
- **File button**: the button at the top of the skill view that shows the open file and the file count.

Text marks: text in quotes comes from the canvas or from production. Text marked "(not confirmed)" is in HANDOFF section 5 and needs Mahmoud's approval.

## Milestones and views

The skills work is two milestones in `tasks.md`:

- Skill editor, section 18: the one skill view (F07 f1 to f10, K01) that replaces the 960 px and 760 px drawers, with the file menu, search, row actions, unsaved dots, add a file, the duplicate path check, Advanced, the expanded editor and both "..." menus (18.1); upload with "Add" or "Replace the whole skill" (18.2). Requirements: "One skill view in every place" to "Saving a skill", "Read-only skills and states", "Skills page keeps its own actions".
- New skill flows, section 19: the Skills "+" menu and "Add skills" (19.1); "New skill" with its three ways (19.2). Requirements: "Skills section "+" menu", "Add skills view", "Remove a skill from the agent asks first", "New skill, choose how", "Write from scratch", "Upload a new skill", "Import from a repo".

| View | `apply` | `target` in the agent | `target` on the Skills page | Where Save writes |
|---|---|---|---|---|
| Add skills | `immediate` | `agent_draft` | not mounted | each click writes the agent configuration; auto-save saves it |
| Skill view, agent-only skill | `on_save` | `agent_draft` | not mounted | the agent configuration; auto-save saves it |
| Skill view, registry skill | `on_save` | `agent_draft` | `project` | a new skill revision in the skill registry on the server, in both places |
| New skill (steps: choose, write, upload, import) | `on_save` ("Create skill" or "Import N skills" is the save) | `agent_draft` | `project` | the skill registry on the server; in an agent also a reference in the agent configuration |

- "New skill" is at depth 2 under "Add skills". Its three ways are steps of the same view, not a third level (design.md D2: at most two levels).
- Item key. The change-set engine keys a `skills` entry by its `name` (`KEY_FIELDS`, `api/oss/src/core/workflows/change_set.py:230-235`). An agent-only skill has a `name`. A registry skill is an `@ag.embed` entry, and the engine gives it no key (`item_key`, `change_set.py:488-491`). So a builder operation cannot address a registry skill by `{list: "skills", key}` today. The view still needs a key for a registry skill. Open question for the orchestrator: which key the frontend and the engine use for an embedded skill (for example the referenced skill's name), and whether the engine gets the same rule.
- Dialogs. The generic unsaved-changes dialog lives in `@agenta/ui` (keys `ui.viewStack.*`); its description comes from the view. An agent-only skill uses the production text "Save your changes to this agent draft, or discard them?" (`web/packages/agenta-i18n/locales/en/entityUi.configItems.json:31`). A registry skill saves to the skill registry, so its description is not written; listed for Mahmoud. The remove dialog F06 f2 for a skill is a domain dialog in `@agenta/entity-ui` next to the agent sections. The file delete dialog ("Delete classify_ticket.py?") and the archive dialog stay inside the skill view.
- Text. New text of the skill view goes to the namespace `entityUi.skillView` (`web/packages/agenta-i18n/locales/<lang>/entityUi.skillView.json` and a catalog file registered with `defineCatalog`, design.md D9), in all 7 languages.

## Today's behavior on origin/main (5d783fec)

Paths start at the repo root. `SC/` means `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/`.

- Two drawers show a skill today. A registry skill opens `SkillDetailDrawer` at 960 px (`web/packages/agenta-skills-ui/src/SkillDetailDrawer.tsx:111`) through the skills bridge (`SC/AgentTemplateControl.tsx:628-639`, `:1609`). An agent-only skill opens `ConfigItemDrawer` (`SC/AgentTemplateControl.tsx:1444`) at 760 px (`SC/agentTemplate/itemKinds.tsx:163`). Both render `SkillFormView` (`SC/SkillFormView.tsx`).
- The "+" menu is `CreateWithAIAddMenu` (`SC/AgentTemplateControl.tsx:1284`). "Create with AI" puts "I want a skill that" in the agent's own chat composer, not the builder (`SC/agentTemplate/CreateWithAIAddMenu.tsx:79-82`). The production line is "From your library, or write one" (`entityUi.agentTemplate.addManuallyHint`); the canvas changes "library" to "registry".
- "Add skills" is a 480 px drawer (`web/packages/agenta-skills-ui/src/SkillPickerDrawer.tsx:105`). A click adds with mode "latest" (`SkillPickerDrawer.tsx:209`) and a second click removes (`:211`). "New skill" opens `SkillCreateDrawer` (860 px, `SkillCreateDrawer.tsx:67`) with the empty editor only (`SkillPickerHost.tsx:66, 94`). Upload and import exist only on the Skills page (`web/packages/agenta-skills-ui/src/NewSkillMenuButton.tsx:28-52`, `web/mobile/src/features/skills/SkillListScreen.tsx:194, 251`).
- File add, rename and delete exist in production as a left rail:
  - Add: `addFile` appends a file with an empty path (`SC/SkillFormView.tsx:302-305`). There is no duplicate path check in the editor (`SC/SkillFormView.tsx:296-315`) or in the SDK (`sdks/python/agenta/sdk/agents/skills/models.py:21-46` checks each path alone: relative, no `..`, not SKILL.md).
  - Rename: the path field changes the path (`SC/SkillFormView.tsx:622-626`).
  - Delete: the row bin removes the file at once, with no question (`SC/SkillFormView.tsx:178-190`, `:306-314`, `:490`). SKILL.md has no bin (`:479`).
  - Upload: `applyParsed` always replaces the body and all files (`SC/SkillFormView.tsx:316-337`). Binary and too-large files are skipped with a reason (`SC/skillUpload.ts:213-241`).
- Name and Description show above every file today (`SC/SkillFormView.tsx:535-593`). The SKILL.md editor takes the height that is left (`grow`, near `SC/SkillFormView.tsx:612-615`).
- "Mark executable" is not disabled when "Allow executable files" is off (`SC/SkillFormView.tsx:639-646`). The new rule is a change.
- Publish: the button "Publish to registry" sits in the drawer footer (`SC/AgentTemplateControl.tsx:1412-1440`, `:1472-1477`). `publishInlineSkill` swaps the inline entry for the reference (`SC/AgentTemplateControl.tsx:955-988`); today the auto-commit then saves a version.
- Registry save commits a skill revision with a base revision (`SkillDetailDrawer.tsx:244-281`). Archive asks first with the agent count (`SkillDetailDrawer.tsx:151-171`, `:636-660`). "Add to agent" sits in the drawer menu (`SkillDetailDrawer.tsx:353-368`).
- Download: `SC/skillDownload.ts:55-75` picks .zip with files and SKILL.md without; the button sits in the rail header (`SC/SkillFormView.tsx:431-448`).
- The Skills page keeps the open skill in component state; there is no URL for one skill (`web/mobile/src/features/skills/SkillListScreen.tsx:134-140`). The "skill registry" link in a new tab needs a URL parameter.
- Pinned skills with a newer registry version show a gold "update available" status today (`SC/AgentTemplateControl.tsx:990-1000`). The design does not draw "Pinned" or "Update available". Keep the production row status until Mahmoud decides.

## Every place that mounts the changed components (re-verified)

- `SkillFormView`: `SC/agentTemplate/itemKinds.tsx:46` (agent config, every host of `AgentTemplateControl`), `web/packages/agenta-skills-ui/src/SkillDetailDrawer.tsx:624`, `web/packages/agenta-skills-ui/src/SkillCreateDrawer.tsx:306`, and a Storybook story (`web/storybook/stories/entity-ui/SkillFormView.stories.tsx:55`).
- `AgentTemplateControl` renders wherever an agent revision config renders (`SC/SchemaPropertyRenderer.tsx:509`). The skills bridge is wired by `DrillInBridgeProvider`, which these hosts mount: session config pane (`web/mobile/src/features/chat/ConfigPane.tsx:66`), playground (`web/mobile/src/features/playground/PlaygroundWorkspace.tsx:96`), evaluator playground (`EvaluatorPlaygroundWorkspace.tsx:84`), evaluator editor (`web/mobile/src/features/evaluators/create/EvaluatorEditorDrawer.tsx:52`), create prompt (`web/mobile/src/features/prompts/CreatePromptDrawer.tsx:35`), revision drawer (`web/mobile/src/features/revisions/EditableRevisionDrawerHost.tsx:56`).
- `SkillDetailDrawer`: `web/mobile/src/features/skills/SkillListScreen.tsx:244`, `web/packages/agenta-skills-ui/src/SkillDetailHost.tsx:41`.
- `SkillCreateDrawer`: `SkillListScreen.tsx:252`, `SkillPickerHost.tsx:94`.
- `SkillAgentPicker` ("Add to agent"): `web/mobile/src/features/skills/SkillActionsMenu.tsx:142`, `SkillDetailDrawer.tsx:368`.
- `CreateWithAIAddMenu`: `SC/AgentTemplateControl.tsx:1204` (integrations), `:1284` (skills), `SC/AgentOperationsSections.tsx:159` (automations).
- The classic app `web/oss` imports `SkillDetailDrawer`, `SkillCreateDrawer` and `SkillImportDrawer` (`web/oss/src/components/pages/skills/SkillsPage.tsx:12-18, 87, 98`) and the skills bridge (`web/oss/src/components/DrillInView/OSSdrillInUIProvider.tsx:85`). Removing the drawers needs a decision for `web/oss` (keep the exports until the release milestone, or point `web/oss` at the new view).
- Phone: the skill view is read only on a phone (`phone-layout` capability).

## Duplicate implementations to merge

- `SkillDetailDrawer` (registry skill) and `ConfigItemDrawer` with the skill kind (agent-only skill) become the one skill view. A host that still needs a drawer (the classic app `web/oss`, until the release milestone decides) wraps the view in `DrawerViewChrome`.
- `SkillCreateDrawer` and the agent's "New skill" become the "New skill" view with the three ways.
- The Skills page list exists twice: `web/mobile/src/features/skills/SkillListScreen.tsx` and `web/packages/agenta-skills-ui/src/SkillsGalleryPage.tsx` (used only by `web/oss`). Not changed by this capability.

## Backend work and scope

- Duplicate file path check: the editor check is frontend work (small: under one day). This work adds no backend validator.
- Upload "Add" or "Replace": frontend only; the merge happens in the editor draft, and Save sends the merged full file set, so the skill save needs no partial-set support (small).
- Skills page URL for one skill: frontend only (small).
- No backend work. Registry save, archive, publish, download and import exist.

## States described and not drawn

- Loading, save error and archive confirmation are described in HANDOFF section 2 and covered here with production behavior.
- The delete dialog shows only its title on the canvas; its buttons and body are not drawn. Use the production confirm dialog with "Cancel" and "Delete".
- The duplicate-path error text is not designed. Mahmoud must supply it.
- The body text of the remove dialog for a skill is not drawn. F06 f2 shows the integration case ("The connection stays in the project. 1 skill mentions Zendesk.").
- The import scan in progress is not drawn.
- The upload step for "Add" when the upload holds a SKILL.md: the canvas says a file with the same path is replaced and that only "Replace the whole skill" replaces the name and the description. Open question: does "Add" replace the SKILL.md body?

## Text

Not confirmed (HANDOFF section 5): "Shared in your skill registry", "Only available to this agent". "Publish to skill registry" is confirmed.

Not written; listed for Mahmoud: the removed state of a skill view, the unsaved-changes description for a registry skill, the duplicate-path error.

New text from the canvas that is not in the production locale files (needs i18n keys in all 7 languages): "Find a file", "No file matches", "2 of 14 files · Enter opens the first one", "14 files · 2 edited", "Upload a folder or a .zip", "Change the path to rename or move the file.", "Type a folder and a name, for example references/pricing.md.", "Delete this file", "Delete classify_ticket.py?", "Add to this skill", "New files are added. Files with the same path are replaced.", "Replace the whole skill", "All 14 files, the name and the description are replaced.", "Text files only. A file that is not text is skipped and listed after the upload.", "Expand the editor", "Make the editor smaller", "The new skill is added to your skill registry and to this agent.", "Not saved yet", "Text files only. The upload opens in the editor, and nothing is saved until "Create skill".", "From your registry, or write one".

Open question: F04 f1 does not say where "Create with AI" goes. F02 and F05 send it to the Builder panel; this file does the same.
