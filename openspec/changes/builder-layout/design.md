## Context

This design is for a reader who knows Python services well and is new to React. Each frontend idea is explained once in backend terms the first time it appears.

All "today" claims are on `origin/main` at `5d783fec` (v0.129.0). Paths that start with `web/packages/agenta-x/` belong to the shared package `@agenta/x`.

### Terms

- **Component.** A React function that returns screen markup. Think of it as a template function with its own local state.
- **Mount.** Render a component for the first time. **Unmount** removes it and drops its local state. **Remount** is unmount plus mount: local state starts again from zero.
- **Atom (Jotai).** A named value in memory that tells its readers when it changes. Think of a module-level variable with change notification. An **atom family** is a dict of atoms keyed by an id (for example one atom per revision id).
- **TanStack Query.** A request cache with keys, expiry and refetch rules. Think of a memoized HTTP client with a cache key per request.
- **localStorage.** A key-value store in the browser, per site. It survives a reload. It is per browser, not per user account.
- **`next/dynamic`.** Lazy import of a component. Its code downloads on first use, so it does not count in the first page load.
- **Draft.** Local edits to an agent configuration that the server does not have yet. For an agent, auto-save turns the draft into a new version about 1500 ms after the last edit, as production does (D5).
- **Auto-save.** The production engine that commits an agent draft as a new version after 1500 ms with no new edit (`web/packages/agenta-playground/src/state/execution/agentAutoCommit.ts:27`). It stays as it is.
- **Survives.** A conversation's state survives when the person finds the same composer text, scroll position and open quick action, and a running answer continues. A remount that restores this state is allowed (D6).
- **Content.** One of the three things the right panel can show: Files, Configuration or Builder. The word means only these three.
- **Container.** A place on screen that shows views: the right panel, the Configuration page, a Settings page, a drawer shell or a dialog.
- **Root.** The base screen of a container (for example the Agent tab body or a Settings list). A root is not a view and is not in the view stack.
- **View.** A screen that a root opens on top of itself (a skill, an MCP server, the model picker). Views sit in the view stack at depth 1 or depth 2. A view does not know which container shows it.
- **Tab.** On the Configuration content and the Configuration page: Agent, Automations, Channels, Access.
- **Section.** A part of the Agent tab: Model, Instructions, Integrations, Subagents, MCP servers, Skills, Secrets, Permissions, Advanced.
- **Item.** One configuration item inside a section: an integration, a subagent, an MCP server, a skill, a secret attachment. The word means only this.
- **Builder tabs.** The strip at the top of the builder page pane: one tab per agent, automation, tool or app that the builder chat touched (D15). The words "tab" and "pane tabs" name the Agent, Automations, Channels, Access, Drives and Sessions row inside an agent tab.
- **Chat and session.** The interface says "chat" for a conversation with the builder. The code and the API say "session" for every conversation, also a builder chat.
- **Dirty.** A value is dirty when it has edits that are not saved. The code uses this one word for every source of unsaved work: an open view form with edits, a Files edit, an automation form, and the short auto-save window of the agent draft.
- **Design rule N.N.** A numbered rule of the approved behavior rules of the design (for example 1.3 is "which builder chat opens"). Each capability spec repeats the rule it uses.
- **Architecture rule N (rule 1 to rule 10).** The ten architecture rules of this program. Decisions D1 to D10 below state each one.
- **Decision DN (D1 to D20).** The numbered decisions of this file. A reference names the decision too, for example "D13, page context".
- **First slice.** The serial start of the frontend build: the split, the view stack and panel, one complete configuration slice, two conversations on one screen, and one builder edit whose save reaches another open session (`tasks.md`, sections 2, 3, 4, 7 and 8). The frontend flows that mount views in the panel start only after it works. The QA harness, the sidebars, the bench, the choice form and the hero engine start on day one from their specs, and the builder agent work (D19) runs alongside.
- **Foundation A** (split, panel and views, first builder edit) and **Foundation B** (two conversations, session follow). The two sessions that build the first slice.
- **Builder agent work.** The builder PR stack and the new builder tools, owned by the builder architecture session, not by this program (D19). This program reads what that work provides.
- **Frame codes** such as "F01 f2". A frame of the approved design canvas: sheet F01, second frame from the left.

### How the session screen works today

`SessionWorkspace` (`web/mobile/src/features/chat/SessionWorkspace.tsx`) builds the session screen. It mounts:

| Part | Line | What it does |
|---|---|---|
| `ConfigPane` (loaded with `next/dynamic`) | 63, 369 | The agent configuration, in a pane on the LEFT (`paneSide="start"`, line 417). It stays mounted and hidden after first use, because a remount cost about 100 ms (lines 348-353). It passes `autoSave` to the configuration header (`ConfigPane.tsx:102`). |
| `SessionsPane` | 378 | The session list, in the same left slot. |
| `SessionTopBar` | 401 | The top bar with the agent name and the version chip. |
| `SessionFilesPane` | 477 | Files, in a second split on the RIGHT (`paneSide="end"`, line 445), with its own width key. |
| `SessionTabs` | 513 | The row of open session tabs. |
| `SessionWorkspaceDrawers` | 530 | The drawers that an atom opens from anywhere: the integration catalog, the automation editor, the run history (`SessionWorkspaceDrawers.tsx:33-55`). |

The session shortcuts bind to the whole document (`SessionWorkspace.tsx:303`). There is one conversation per screen.

The route component renders below the app providers (`web/mobile/src/pages/_app.tsx:66`). When the route changes to another page file, React unmounts the old page and everything below it. A context value cannot keep a component alive across that.

### How drawers are hosted today

There are three kinds of drawer host:

1. **Inside the configuration control.** `AgentTemplateControl` builds the section list (`AgentTemplateControl.tsx:1140-1352`) and then mounts every drawer of every section in the same component (`AgentTemplateControl.tsx:1381-1677`): one item drawer for tools, MCP servers and skills, the instructions drawer (line 1523), two section drawers for Model and Advanced (lines 1541, 1572), the skill picker and detail hosts, the subagent drawer, the integration drawer (line 1632) and the permission drawer (line 1646). The file has 1679 lines.
2. **Per screen, opened by atoms.** `SessionWorkspaceDrawers` (above) and `SessionAutomationDrawers` (`web/mobile/src/features/sessions/SessionAutomationDrawers.tsx`) mount nearly the same drawers.
3. **Per feature.** The Skills page mounts `SkillDetailDrawer` and `SkillCreateDrawer`. Settings mounts its own MCP, secret and provider drawers.

A drawer edits a local copy and writes it on Save. When the person closes a drawer with unsaved edits, `SectionDrawer` asks "You have unsaved changes" with "Keep editing", "Discard" and "Save changes" (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SectionDrawer.tsx:95-127`; text in `web/packages/agenta-i18n/locales/en/entityUi.configItems.json:27-30`).

### How agent configuration renders today

- `ConfigPane` wraps the configuration in `DrillInBridgeProvider` and renders `AgentBuildPanel` (`web/mobile/src/features/chat/ConfigPane.tsx:64-131`).
- `DrillInBridgeProvider` (`web/mobile/src/features/chat/DrillInBridgeProvider.tsx:37-103`) is a dependency-injection point. It puts host facts into a React context: the provider-key config, the subagent reference bridge, the skills bridge, the trace opener, the deployment kind, the secret permission and a callback for a new revision. Package code reads them with `useDrillInUI()`. Think of it as a request-scoped service container. Six hosts mount it (ConfigPane, EvaluatorEditorDrawer, EvaluatorPlaygroundWorkspace, PlaygroundWorkspace, CreatePromptDrawer, EditableRevisionDrawerHost).
- `AgentBuildPanel` (`web/packages/agenta-playground-ui/src/components/AgentBuildPanel.tsx:63-123`) renders the header, the schema-driven configuration (`PlaygroundConfigSection`) and the operational sections (automations, files) that are not part of a version.
- The schema renderer mounts `AgentTemplateControl` for the `agent-template` field (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/SchemaPropertyRenderer.tsx:500-515`). The control receives the whole configuration object and an `onChange` callback (`AgentTemplateControl.tsx:161-170`). It has 8 sections: model (line 1142), instructions (1177), integrations (1196), subagents (1231), MCP servers (1252), skills (1278), permissions (1314), Advanced (1335). Secrets render inside the model body (`agentTemplate/useModelHarness.tsx:659`).
- Item drawers address an item by its position in the list (`openEdit("mcp", index, item)`, `AgentTemplateControl.tsx:1267`).

### How a draft is saved and run today

- The draft is an atom per revision (`workflowDraftAtomFamily`, `web/packages/agenta-entities/src/workflow/state/store.ts:1801`). It lives in memory. I found no code that keeps an agent draft across a reload in `/m` (not fully verified).
- Every draft write calls a single registered callback (`registerWorkflowDraftCallbacks`, `store.ts:2501`).
- `agentAutoCommit.ts` registers that callback when the module is imported (`web/packages/agenta-playground/src/state/execution/agentAutoCommit.ts:276`). After 1500 ms with no new edit (line 27) it commits, with one retry after a failure. It skips any revision that is not an agent, an ephemeral onboarding agent and a local draft (lines 85-97). So prompt and evaluator playgrounds never auto-save. They keep `CommitRevisionModal` (`web/mobile/src/features/playground/RevisionActions.tsx:255`).
- Two hosts pass `autoSave` to the shared configuration header: `ConfigPane.tsx:102` in `/m`, and the classic app's agent header (`web/oss/src/components/Playground/Components/PlaygroundVariantConfig/assets/PlaygroundVariantConfigHeader.tsx:208`). The header hides its commit control when `autoSave` is set (`web/packages/agenta-playground-ui/src/components/AgentConfigHeader.tsx:70`). So today no agent host shows a commit button.
- The commit itself is `commitWorkflowRevisionAtom` (`web/packages/agenta-entities/src/workflow/state/commit.ts:205`). It sends `POST /workflows/revisions/commit` without `base_revision_id` (`web/packages/agenta-entities/src/workflow/api/api.ts:1084-1112`), so the last write wins. An edit typed during the request is carried to the new revision (`commit.ts:291-307`). A failure becomes a plain `Error` with the message text only (`commit.ts:325`), so the status, the conflict code and the current revision id are lost before the UI sees them.
- The server already supports a guarded save: with `base_revision_id`, a commit whose base is no longer the head is refused with HTTP 409 and the code `revision_conflict`, with the current revision id in `details` (`api/oss/src/core/workflows/dtos.py:400-409`; `api/oss/src/core/workflows/service.py:248-296, 3540-3553`). The check runs inside the locked commit decision, not as an earlier read.
- A run reads the draft. `buildAgentRequest` takes the draft-aware configuration (`web/packages/agenta-playground/src/state/execution/agentRequest.ts:325`). When the configuration is dirty, it leaves out the `application_revision` reference, so the service marks the run as a draft run (`agentRequest.ts:369-393`). So today a message sent while the configuration has unsaved edits runs those edits, and the run is recorded as a draft run.
- The secret attach path has its own commit. `commitAgentCredentialsAtom` (`web/packages/agenta-entities/src/workflow/state/agentCredentials.ts:84`) refuses while the configuration is dirty (line 96), commits on the variant head with `base_revision_id` (line 119), and handles a conflict itself (comment at lines 76-83).
- Version history revert (`revertAgentRevisionAtom`, `web/packages/agenta-playground/src/state/execution/agentVersionHistory.ts:94`) refuses while an auto-commit is busy (line 100), stages the old configuration and its schemas, commits through the auto-commit flush (line 125), and puts a prior draft back when the commit does not land.
- Other users of the engine: the save-state dot in `AgentRevisionStatus` (lines 87-90), `hasUnsavedConfigEdits` (`web/mobile/src/features/chat/hasUnsavedConfigEdits.ts:14-18`), the session pin after a save (`SessionWorkspace.tsx:160-170`), the latest-version check after a save (`latestVersionCheck.ts:3`), and the classic app's revision selector (`web/oss/src/components/Playground/Components/AgentRevisionSelector/index.tsx:37`).

### How an open session learns of a new revision today

A session pins the latest revision when it opens (`web/mobile/src/features/chat/ChatScreen.tsx:131-144`). After that, three paths can move it:

1. **The agent saves itself in this session** (`commit_revision`). A stream part `data-committed-revision` or the records reader reports it. `createCommitFollower` applies it once, and holds it while the tab is hidden or while the configuration has unsaved edits (`web/mobile/src/features/chat/LiveConversation.tsx:258-283`; `commitFollower.ts`).
2. **A save made elsewhere.** `AgentRevisionStatus` reads the latest version on mount, when the page becomes visible, on a session switch and after this tab auto-saves (`web/packages/agenta-playground/src/state/execution/latestVersionCheck.ts:19-57`; `AgentRevisionStatus.tsx:110`). It applies the newer version without a click when `autoUpdate` is on and nothing is unsaved (`AgentRevisionStatus.tsx:129-133`). `autoUpdate` is on when the session follows its agent, liveness has loaded and no turn or approval is active (`ChatScreen.tsx:173-174`). Otherwise the chip offers "Update to vN".
3. **The project watch stream.** `GET /sessions/watch` sends `workflow-changed`, and the frontend clears the latest-revision caches (`web/packages/agenta-sessions/src/watch/useProjectWatch.ts:63-68`). But the server publishes `workflow-changed` only in `edit_workflow` (rename, flags, folder), not when a revision is committed (`api/oss/src/core/workflows/service.py:2209, 2265-2277`).

So a save by the builder in another chat does not reach a session that stays on screen until the next visibility change or session switch.

### What the prototype proved

The first coded version lives in a private development copy (not pushed). It proved these points in a browser:

- **One right panel.** `AgentPanel` mounts only the open content (Files, Configuration or the builder chat), each loaded with `next/dynamic`. Files stays mounted while an upload runs, because an unmount aborts the upload. The session page first load grew by 0.1 KB.
- **Panel state.** `agentPanelState.ts` stores `{content, width}` per project and `{section, builderSessionId}` per agent in localStorage. Width is clamped to 360 to 640 px. A click on the open content closes the panel; a click on another content swaps it.
- **Shared content components.** `AgentConfiguration` (tabs Agent, Triggers, Channels, Access) takes its target and section as props, reads no route and mounts no drawer host. It renders in the panel, on the Configuration page and inside a builder tab. `SessionConversation` takes its session from props and has a role, `page` or `embedded`. An embedded conversation takes shortcuts only while focus is inside it.
- **Revision follow.** `revisionToAdopt` decides whether a session moves to a newer version.

What the prototype did NOT prove: items inside the panel instead of drawers, the leave dialog with "Save changes" (it has "Leave" only), the page context (it sent hidden text with the first message only), builder tabs for other kinds than agents, the follow rule and the test tab. It detected agents the builder acted on by parsing shell commands, which the product builder does not use. These parts are designed again below.

## Goals / Non-Goals

**Goals**

- One container contract, so that a flow written once shows in the panel, on the Configuration page, in Settings, in onboarding and on the phone.
- Files small enough that many sessions build configuration flows in parallel, with the shared files handed over on stated dates.
- Agent saves that work as production does today: a change is saved as a new version shortly after the edit (auto-save), and the header shows the version.
- Open sessions that stay on the newest saved version without losing an open form.
- The builder chat in the panel and on its own page, with builder tabs, the follow rule, the test tab, the page context (its chip kept after a reload), and every change card of the approved design, backed by the builder tools that the builder agent work provides (D19).
- A frontend-only program: no API, SDK, runner or record change.
- The 13 redrawn phone screens and the phone screens the phone scope names, each paired with its desktop flow.
- No growth of the session route bundle, and session switch speed measured first and then improved in the speed project.

**Non-Goals**

- Remembering an open view across a reload. The view stack is lost on reload.
- A change to how an agent saves. Auto-save stays, with its last-write-wins rule (D5).
- Panel state on the server, so that it follows the person to another device. It is stored in the browser, keyed by user and project (D11, the panel state store).
- A switch between the old and the new layout. The program branch replaces the layout in place (D10).
- Each person's own sign-in for MCP servers of the `builtin` and `standard` kinds. The approved design draws it only for a project server.
- Backend code in this program, except two tasks Mahmoud asked for: personal accounts on by default (task 10.1, a configuration default) and the MCP account name (task 39.1). The builder PR stack and the builder tools are the builder agent work (D19). "Run now" stays exactly as today (DECIDED).
- Changes to the classic app `web/oss` beyond what it needs to compile and the shared session row without the 220 ms hold. `web/oss` is abandoned.

## Decisions

Status words: **DECIDED** (Mahmoud or the final design said so) and **PROPOSED** (the recommendation in this design; Mahmoud has not answered).

### D1. Content does not know where it is shown (rule 1, DECIDED)

**Problem.** Today the content and its host are mixed. `AgentTemplateControl` owns both the section list and the drawers (`AgentTemplateControl.tsx:1381-1677`). A new place for a flow means a new copy. This is how 11 screens came to exist twice.

| Option | Trade-off |
|---|---|
| Keep drawers; add a panel mode prop to each drawer | Each drawer grows a branch per place. Every new place touches every flow. |
| **Views plus containers** | A flow has no drawer, page or panel code. A new place is one new container. Needs a small shared contract (D2, the view stack contract). |
| A full router with nested routes per flow | URLs for every view. Much more machinery; view state in the URL must stay valid across versions. |

**Chosen: views plus containers.** In backend terms: a view is a request handler that does not know the server it runs in; a container is the server that mounts it. The one rule: a view imports no panel, route, drawer or page code. A view may take values and callbacks as props (for example `value`, `onChange`, `onSubmit`). An editor that takes a value and a callback is as independent of its container as one that takes an id, and it is easier to reuse between the agent draft, a project resource, onboarding and the playground. Inside a flow, three layers stay apart: field editors (plain components with value and callback), a small domain adapter that loads an entity and chooses where a change is written (D2, `target`), and the container chrome.

### D2. The view stack contract (rule 2, DECIDED; the code shape is PROPOSED)

**Problem.** The design opens items inside the panel with a breadcrumb ("Integrations › Add integration › Connect"). A view needs a way to open a child, to report unsaved edits, and to leave. Each container draws this differently (panel header, page column, Settings page, dialog).

| Option | Trade-off |
|---|---|
| Each container implements its own navigation | Same bugs many times; the unsaved-changes rule drifts. |
| A global registry of views by id, with the stack in the URL | Deep links to a view. The stack must serialize; old links break when a view changes. Not needed by the design. |
| **A host component that owns a stack of at most two views, plus a chrome component per container** | One implementation of open, push, back and the leave dialog. No serialization. Views are passed as typed definitions, not looked up by name. |

**Chosen: a host with a stack of at most two views.** In backend terms: the view stack is a router with a history of at most two entries. The root of the container is not in the stack. The root calls `open` to show a view at depth 1. A view at depth 1 can `push` one child at depth 2. A view at depth 2 cannot push.

**One editable form at a time.** A child view of a parent that has a form is one of two kinds. It is a picker that changes the parent's form and returns (for example "Add integration" while the person edits nothing else), or the parent asks the person to save or discard before the child opens. So the stack never holds two dirty forms. While a picker covers a parent that has a dirty form, the parent owns the guard: the stack is dirty when any view in it is dirty, and the leave dialog uses the description of the dirty view.

The contract lives in `@agenta/ui` (new folder `view-stack/`), because views in `@agenta/entity-ui` and containers in `web/mobile` both need it:

```ts
// web/packages/agenta-ui/src/view-stack/types.ts (new)
import type {ComponentType, ReactNode} from "react"

/** The address of one configuration item. Same shape as the target segment of an operation. */
export interface ConfigItemRef {
    list: "tools" | "mcps" | "skills" | "files"
    key: string
}

/** Where a view writes. Explicit, never inferred from an optional id. */
export type ViewTarget =
    | {kind: "agent_draft"; revisionId: string}   // writes the agent draft; auto-save saves it (D5)
    | {kind: "project"}                           // writes a project resource on the server

/** A view definition. A module exports it; nothing registers it globally. */
export interface ViewDef<P> {
    /** Stable id, for React keys and tests. Never stored. Example: "agent.skill". */
    id: string
    /**
     * "on_save": the chrome shows Cancel and Save; edits reach the target only on Save.
     * "immediate": edits reach the target at once; the chrome shows Done.
     */
    apply: "on_save" | "immediate"
    /** The panel chrome shows "Widen the panel" for this view (760 px while it is open). Other containers ignore it. */
    wide?: boolean
    /** The body. Use a `next/dynamic` component so the code loads on first open. */
    Component: ComponentType<ViewProps<P>>
}

/** Params carry addresses and the target only, never display names. */
export interface ViewProps<P> {
    params: P
    target: ViewTarget
    nav: ViewNav
}

/** What a view can ask of its stack. */
export interface ViewNav {
    depth: 1 | 2
    /** Open a child view with its own target (most children pass the parent's target). Null at depth 2: two levels at most. */
    push: (<C>(view: ViewDef<C>, params: C, target: ViewTarget) => Promise<boolean>) | null
    /** Guarded back: asks first when this view's form is dirty. */
    back: () => Promise<boolean>
    /** Cancel: discards the local form without asking, then goes back. */
    cancel: () => void
}

/** What an "on_save" view reports. An "immediate" view reports nothing. */
export interface ViewForm {
    dirty: boolean
    valid: boolean
    /** Write the edits. Resolve true on success; the stack then goes back. */
    save: () => Promise<boolean>
    /** Text of the unsaved-changes dialog for this view (it names what Save writes). */
    leaveDescription: string
}

/** For the container's root and for the container itself. */
export interface ViewStack {
    /** Replace the stack with one view at depth 1. Resolves false when the person kept editing. */
    open: <P>(view: ViewDef<P>, params: P, target: ViewTarget) => Promise<boolean>
    /** Leave every view. Resolves false when the person chose "Keep editing". */
    closeAll: () => Promise<boolean>
    /** True while any view in the stack has a dirty form or a save in flight. A picker on top does not hide a dirty parent. */
    dirty: boolean
}

/** What a container draws around the top view. */
export interface ViewChromeProps {
    crumbs: {title: string; onSelect?: () => void}[]
    apply: "on_save" | "immediate"
    wide: boolean
    form: (ViewForm & {saving: boolean}) | null
    onBack: () => void
    onCancel: () => void
    children: ReactNode
}
```

```ts
// web/packages/agenta-ui/src/view-stack/index.ts (new)
export const defineView: <P>(def: ViewDef<P>) => ViewDef<P>
/** Owns the stack. `children` is the root, shown while the stack is empty. */
export const ViewStackHost: (props: {
    chrome: ComponentType<ViewChromeProps>
    /** Escape with an empty stack: the panel closes itself; a page does nothing. */
    onEscapeAtRoot?: () => void
    children: ReactNode
}) => JSX.Element
export const useViewStack: () => ViewStack
/** Called once in the body of an "on_save" view. */
export const useViewForm: (form: ViewForm) => void
/** The view reports its breadcrumb title. A renamed item updates the crumb at once. */
export const useViewTitle: (title: string) => void
```

Rules of the contract:

- **Leaving with unsaved edits.** Guarded `back`, `open`, `closeAll`, Escape and the container leaving (panel swap, panel close, route change) all ask with one dialog: "You have unsaved changes", "Keep editing", "Discard", "Save changes". The description line comes from the view (`ViewForm.leaveDescription`), because Save writes different places: the agent configuration for an agent section (auto-save then saves the version), the server for a project resource. "Save changes" calls `form.save()` and leaves only when it resolves true. The generic dialog lives in `view-stack/` with its own text keys under the namespace `ui.viewStack`. It does not reuse `entityUi.configItems`.
- **Cancel and back.** Cancel discards the local form and goes back without asking. Back (the breadcrumb, Escape, the container leaving) is guarded and asks when the form is dirty.
- **Saving.** While `save()` runs, the chrome shows the saving state, disables a second Save, and holds navigation until the save resolves. A failed save keeps the view open with the form as it was.
- **Item addressing.** A view addresses an item by `ConfigItemRef` (`{list, key}`), the same shape as the target segment of a builder operation (`api/oss/src/core/workflows/change_set.py:919`, `_find_item`). The key is the one the change-set engine computes for that list (`item_key`, `change_set.py:477`). For an MCP server that is the entry name, which is not always the connection slug, and a skill from the registry has no engine key today (`change_set.py:490-491`); OPEN-QUESTIONS group 3 tracks both. The agent config writer (D4), the view params and the page context (D13) use this one type. One function maps the old item kind names (`tool`, `mcp`, `skill`) to `list`. Today's drawers use the position (`AgentTemplateControl.tsx:1267`). A builder save can change the list under an open view, and a position then points at another item. When the key no longer exists, the view shows the "removed" state and offers Back.
- **Where Save writes.** `target` decides it, and a view has one target. `{kind: "agent_draft"}`: Save in a view applies the form to the agent configuration in today's draft store, and auto-save then saves a new version, as production does (D5). An "immediate" view (a model pick) changes the configuration at once, and auto-save saves it. `{kind: "project"}`: Save writes the server (a provider key, a secret, an MCP server in Settings, an automation).
- **Create, then attach.** Creating a project resource and adding it to the agent are two writes by two views. The integration connect view always has the target `{kind: "project"}`: "Connect" creates the project connection, which applies at once. When the connect view returns, the parent "Add integration" view (target `agent_draft`) adds the integration to the agent configuration as its own write, as production adds it once the connection is valid (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/AgentIntegrationDrawer.tsx:540-553, 722-726`), and auto-save saves the version. A removal of the integration later keeps the project connection.
- **Titles.** The view reports its own title with `useViewTitle`. Params carry addresses only, so a breadcrumb never shows a stale name or a slug in place of a name.
- **Escape.** Escape goes back one level (guarded), then calls `onEscapeAtRoot` (design rule 2.5).
- **Width.** Only the panel chrome reads `wide`: it shows the "Widen the panel" button, and a click grows the panel to 760 px for that view. Back restores the stored width.
- **Target of a child.** The opener passes the target of every view explicitly. A child usually gets its parent's target. A child that writes another place gets its own target, and its Save writes only there (the connect view under "Add integration").
- **Dialogs.** Only the generic unsaved-changes dialog (F06 f1) lives in `view-stack/`. Domain dialogs live in their domain packages: F06 f2 (remove an integration, a subagent, an MCP server or a skill) in `@agenta/entity-ui` next to the agent sections, F06 f3 (remove a secret) next to the secret views, F06 f4 (delete an automation) in the automations package, F06 f5 (revert a version) with the version history.
- **Test selectors.** The panel host root carries `data-testid="agent-panel"`, the root of the current view carries `data-testid="panel-view"`, and the session header carries `data-testid="session-header"`. QA crops and capture recipes use these, never CSS classes. A story that renders a view alone wraps it in the same `panel-view` id.

How one view mounts in three places:

```tsx
// 1. The right panel, Configuration content (web/mobile)
<ViewStackHost chrome={PanelViewChrome} onEscapeAtRoot={panel.close}>
    <AgentTabRoot revisionId={revisionId} />
</ViewStackHost>

// 2. The Configuration page (web/mobile)
<ViewStackHost chrome={PageViewChrome}>
    <AgentTabRoot revisionId={revisionId} />
</ViewStackHost>

// 3. Settings › MCP servers (web/mobile settings tab)
<ViewStackHost chrome={SettingsViewChrome}>
    <McpServerListRoot />
</ViewStackHost>

// Inside a root, a row opens the same view with an explicit target:
const stack = useViewStack()
await stack.open(mcpServerView, {item: {list: "mcps", key: row.key}}, {kind: "agent_draft", revisionId})
await stack.open(mcpServerView, {item: {list: "mcps", key: row.key}}, {kind: "project"})   // in Settings
```

A fourth chrome, `DrawerViewChrome`, draws a view inside a drawer shell with today's width. Only hosts that really keep a drawer use it: the prompt playground, the run error drawer, onboarding, and Settings screens where the design does not move a flow. Converting every shared surface to a non-drawer container is not a condition for the release. The phone uses a fifth chrome, a full-screen page with a back arrow (D17, the phone path).

### D3. A changed view changes everywhere; duplicates merge (rule 3, DECIDED)

**Problem.** Each flow is mounted in several places, and 11 screens exist twice with different code.

| Option | Trade-off |
|---|---|
| Redraw only the agent panel; leave Settings and the other places as they are | Two looks for one thing; the duplicates stay and grow. |
| **One view per flow; every place mounts it; the milestone that redraws a flow also moves its other mounts** | The milestone owns more places and more QA. The duplicates go away once. |

**Chosen: one view per flow, all mounts move with it.** The milestone that redraws a flow owns every place in this table. Each place keeps its own container; a place that keeps a drawer wraps the view in `DrawerViewChrome`.

| Flow | Other places that mount it today |
|---|---|
| Model providers (`ProviderDrawer.tsx:150`, 7 callers) | Settings AI providers, model picker, run error drawer, connect model strip, credit alert strip, gateway connect widget, `useLLMProviderConfig` |
| Integrations (`AgentIntegrationDrawer.tsx:733`, `CatalogDrawer.tsx:51`, `ConnectDrawer.tsx:67`) | Settings integrations, the playground, create prompt, revision drawer, automation run conversation, onboarding account rows |
| MCP servers (`McpConnectJourney.tsx:287`, `McpPermissionDrawer.tsx:304`) | Settings MCP, chat MCP notice card, gateway connect widget |
| Skills (`SkillFormView.tsx:210`, `SkillDetailDrawer.tsx:105`, `SkillCreateDrawer.tsx:61`) | Skills page |
| Secrets (`AgentSecretAttachmentModal.tsx:101`, `OwnerRadioGroup.tsx:24`) | Settings secrets, secret request dock, connect form "Who can use it" |
| Automations (`AutomationDetailBody`, `AutomationCreateBody`, `AutomationRunHistoryView.tsx:36`) | Automations pages, session automation drawers |
| Markdown editor (`MarkdownEditor.tsx`) | AGENTS.md and SKILL.md everywhere |

(Component paths are under `web/packages/agenta-entity-ui/src/`, `agenta-skills-ui/src/` and `agenta-automation-ui/src/`; the full map with lines is in the program research and in each capability's notes.)

### D4. One file per configuration section (rule 4, DECIDED; file list PROPOSED)

**Problem.** All 8 section descriptors (`AgentTemplateControl.tsx:1140-1352`) and all drawers (`1381-1677`) are in one 1679-line file with shared local state (`useConfigItemDrawer`, section open flags, picker flags). Seven parallel milestones would all edit this file. Two more files are shared the same way: `agentTemplate/useModelHarness.tsx` (853 lines) holds the model picker (line 526), the permission policy (line 640), the secrets section (line 659) and the Advanced items (lines 688 to 763), and `agentTemplate/itemKinds.tsx` holds the item kinds `tool` (line 81), `mcp` (line 123) and `skill` (line 152) in one registry.

| Option | Trade-off |
|---|---|
| Keep one file; milestones take turns | Serial work; the program takes weeks longer. |
| Split by drawer only | Section descriptors still share one file; every flow still edits it. |
| **Split into a thin control, one file per section, one file per view, and one writer hook** | One mechanical PR touches everything once. After that, each milestone owns its own files. |

**Chosen: the split below.** The first PR of the first slice does it, and merges first. It moves code; it does not change behavior or looks. It splits all three files: the section bodies of `AgentTemplateControl.tsx` and `useModelHarness.tsx` go to `sections/`, and `itemKinds.tsx` becomes `itemKinds/tool.tsx`, `itemKinds/mcp.tsx`, `itemKinds/skill.tsx` and an index that only imports them. The split makes text conflicts rare. It does not settle behavior: the view contract (D2) and the save rule (D5) are settled by the working first slice, and the parallel flows build on that slice.

```
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/
  AgentTemplateControl.tsx        stays here, thin: reads the config, renders the section list from the registry
web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/
  sections/
    sectionRegistry.ts            ordered list of section definitions; one line per section
    sectionTypes.ts               SectionProps: {revisionId, config, disabled, writer}
    ModelSection.tsx              today line 1142 (picker from useModelHarness.tsx:526)
    InstructionsSection.tsx       today line 1177
    IntegrationsSection.tsx       today line 1196
    SubagentsSection.tsx          today line 1231
    AgentMcpSection.tsx           today line 1252 (named to avoid the Settings McpServersSection)
    SkillsSection.tsx             today line 1278
    SecretsSection.tsx            moved out of useModelHarness.tsx:659
    PermissionsSection.tsx        today line 1314 (body from useModelHarness.tsx:640)
    AdvancedSection.tsx           today line 1335 (items from useModelHarness.tsx:688-763)
  itemKinds/
    index.ts                      imports the three kinds; no logic
    tool.tsx                      today itemKinds.tsx:81 (integrations milestone)
    mcp.tsx                       today itemKinds.tsx:123 (MCP and subagents milestone)
    skill.tsx                     today itemKinds.tsx:152 (skills milestones)
  views/
    modelView.tsx                 Model (F01 f2)
    instructionsView.tsx          Instructions (F01 f3)
    integrationAddView.tsx        Add integration (F02 f4)
    integrationConnectView.tsx    Connect (F02 f5)
    integrationView.tsx           An integration, permissions and account (F02 f6, F10)
    subagentAddView.tsx           Add subagents (F03 f1)
    subagentView.tsx              A subagent (F03 f2, f3)
    mcpAddView.tsx                Add MCP server (F03 f4)
    mcpConnectView.tsx            Connect server (F03 f5)
    mcpServerView.tsx             A server (F03 f6, f7)
    skillAddView.tsx              Add skills (F04 f2)
    skillNewView.tsx              New skill (F07 f12 to f15)
    skillView.tsx                 The skill editor (F07 f1 to f10)
    secretAttachView.tsx          Attach a secret (F04 f4 to f7)
    advancedView.tsx              Advanced (F04 f9)
    agentaToolsView.tsx           Advanced › Agenta tools (F04 f10)
  useAgentConfigWriter.ts         the one place that writes the agent configuration (auto-save saves it): set(path, value), removeItem(ref: ConfigItemRef)
```

The first configuration slice (task section 4) builds `instructionsView`, `modelView` (the pick, before the model providers milestone redraws the list) and the three integration views. Its second container is Settings › Integrations (`web/mobile/src/features/settings/IntegrationsTab.tsx`, which mounts `GatewayToolsSection`; that section mounts `ConnectDrawer` at `web/packages/agenta-settings-ui/src/tools/GatewayToolsSection.tsx:564`): the connect view replaces that drawer body inside `DrawerViewChrome`, with the target `project`. No `/m` playground host mounts the agent sections, because the `/m` playground sends an agent to its agent page (`web/mobile/src/features/playground/AppPlaygroundScreen.tsx:45-46`). The flow milestones add the other views and convert their own sections. The Automations, Channels and Access tabs are separate roots in `web/mobile/src/features/agent-pages/`. The Channels tab of the panel and the Channels page mount the same view. `sectionRegistry.ts` is the only shared file; each milestone edits only its own line.

### D5. Auto-save stays (rule 5, DECIDED by Mahmoud)

**Problem.** The approved canvas draws an explicit "Save as vN" with a draft. Mahmoud decided that the behavior does not change: a change made is saved directly. So the program keeps today's agent auto-save and fits the views to it.

| Option | Trade-off |
|---|---|
| Replace auto-save with an explicit save and a base check | Matches the canvas; changes how every agent saves, adds conflict choices and a long-lived draft. Not chosen. |
| **Keep auto-save as it is; the header shows today's save status and version** | No change for people who use agents today. The builder and a person can still save over each other with no base check (last write wins), as today. |

**Chosen: auto-save stays, untouched.**

1. **Auto-save.** Every change to an agent configuration is saved as a new version about 1500 ms after the last edit (`agentAutoCommit.ts:27`), with today's retry and today's skips (`agentAutoCommit.ts:85-97`). The engine, its registration (`agentAutoCommit.ts:276`) and its callers do not change. The `autoSave` prop stays on the hosts that pass it (`web/mobile/src/features/chat/ConfigPane.tsx:102`; `web/oss/src/components/Playground/Components/PlaygroundVariantConfig/assets/PlaygroundVariantConfigHeader.tsx:208`), and the new panel content passes it too.
2. **Header.** The configuration header shows today's save status and the version, for example "Saved as v4" (`web/packages/agenta-playground-ui/src/components/AgentPageHeader/AgentRevisionStatus.tsx`). There is no "Save as vN" button and no conflict choice in the header.
3. **Views with Cancel and Save.** A view with `apply: "on_save"` (for example the Instructions editor) keeps Cancel and Save. Save applies the form to the agent configuration; auto-save then saves the version as today. Cancel discards the form. A view with `apply: "immediate"` (a model pick) changes the configuration at once, and auto-save saves it.
4. **Leave dialog.** The unsaved-changes dialog asks only when an open form has edits that Save has not applied yet. `confirmLeave(reason)` at the agent layout host keeps the other production guards in one place: the view stack, the Files draft guard (`useDriveDirtyGuard`, `web/packages/agenta-entities/src/drive/useDriveFileEditor.ts:213`), the automation guard (`useUnsavedGuard`) and `beforeunload`. "Save changes" in the dialog calls the form's Save; auto-save then saves the version.
5. **What a message runs.** The request builder does not change. Today a message sent while the configuration has edits that auto-save has not saved yet runs those edits as a draft run (`web/packages/agenta-playground/src/state/execution/agentRequest.ts:325, 369-393`).
6. **Other commit paths.** The secret request dock (`commitAgentCredentialsAtom`, `web/packages/agenta-entities/src/workflow/state/agentCredentials.ts:84-130`), version history revert (`web/packages/agenta-playground/src/state/execution/agentVersionHistory.ts:94`), the save-status dot and the session pin after a save (`SessionWorkspace.tsx:160-170`) keep production behavior.
7. **No base on agent saves.** Auto-save sends no `base_revision_id` today (`web/packages/agenta-entities/src/workflow/api/api.ts:1084-1112`), so the API keeps last-write-wins (`api/oss/src/core/workflows/dtos.py:400-409`). Sending a base would refuse some saves with a visible error, which changes behavior, so the program does not send it.
8. **Known production behavior (not changed).** When a person edits an agent while the builder saves a version of it, auto-save commits the person's configuration as the next version with no base check. The builder's version stays in the version history. OPEN-QUESTIONS group 3 lists this case.

The builder's own save is different: `edit_agent_config` sends its base, so a change card can end in a conflict row with "Try again" (D14).

### D6. Two conversations and the conversation lifetime (rule 6, DECIDED)

**Problem.** The builder chat and the agent session are both on screen. Today one conversation binds the document shortcuts (`SessionWorkspace.tsx:303`). The prototype passed the role as a prop that selects a different component branch, so a role change would remount the conversation. A route change to another page file unmounts everything below the route component (`_app.tsx:66`), so no prop or context keeps a conversation alive across it.

| Option | Trade-off |
|---|---|
| Role as a prop that picks a different component tree (prototype) | A conversation cannot change its role without a remount. |
| A persistent agent host above the route component | No remount ever. Needs a new app-level host and a change to `_app.tsx` that every route shares. |
| **Role as a context value in one component tree; the session screen and the agent pages each stay one page file; where a route change does unmount, the conversation restores its state by session id** | State survives every move: inside one page file the conversation usually stays as it is, and a move between the two page files remounts and restores what the person sees. No app-level host. |

**Chosen: one tree, two page files, restore by session id.**

- **The rule.** The required property is that a conversation's state survives: the composer text, the scroll position, an open quick action, and a running answer that continues. A remount is allowed when it restores that state.
- Two page files keep the work small. Every session is shown by one page file today (`web/mobile/src/pages/w/[workspace_id]/p/[project_id]/sessions/[session_id].tsx`). The agent pages (Configuration, Sessions, Analytics, Channels) are views of the agent route `agents/[agent_id].tsx` with `?view=` (D16). Inside one page file, a move usually needs no restore.
- The container provides `ConversationRole` (`"page"` or `"embedded"`) as a context value, so a role change does not need a different component branch.
- A move between a session and an agent page, or leaving the agent and coming back, changes the page file and unmounts the panel. The conversation then restores its composer text, its scroll position and an open quick action from a small per-session store keyed by session id, and it reconnects to a running answer on the server. Nothing is kept in memory for a conversation that is not on screen.
- Shortcuts belong to the focused conversation only. Today Escape stops a streaming run and `Alt+G` approves a gate for any conversation on screen (`web/mobile/src/features/chat/LiveConversation.tsx:854-874`), and the approval card binds Cmd or Ctrl+Enter and Escape for any card on screen (`web/packages/agenta-chat/src/components/ApprovalCard.tsx:190-210`). Foundation B scopes both (task 7.1): a shortcut acts on the page conversation, or on an embedded one while focus is inside it, never on both.
- The page session id is in one atom, `pageSessionIdAtom`, written by the session route. The context chip reads it (D13); no code passes the page session id into the builder.
- No code counts all records or assumes the whole history is in memory, so a later paged history read stays possible.

### D7. A session follows the saved version (rule 7, DECIDED; frontend only)

**Problem.** Path 2 and path 3 in the Context miss a save made in another chat while the session stays on screen.

| Option | Trade-off |
|---|---|
| Poll the latest version every N seconds | Cost on every open tab; `latestVersionCheck.ts` avoids timers on purpose (lines 13-16). |
| Publish `workflow-changed` on every commit and check on the event | Covers other browsers and people, but it is a backend change, and this program changes no backend. Not chosen. |
| **Run the existing latest-version check when the builder's tool result arrives in this browser, and on window focus and on visibility** | No backend. Covers the builder save in this browser at once; a save from another browser or person is found when the window gets focus or becomes visible, or on a session switch, as today. |

**Chosen: the browser triggers the existing check.** When a builder tool result with `status: "committed"` arrives in this browser (D14), the browser clears that agent's latest-revision caches and runs the existing latest-version check (`web/packages/agenta-playground/src/state/execution/latestVersionCheck.ts:19-57`) for that agent. It runs the same check when the window gets focus and when `visibilitychange` reports visible. The watch handler keeps clearing caches on `workflow-changed` as today (`web/packages/agenta-sessions/src/watch/useProjectWatch.ts:63-68`); the server does not change when it publishes that event.

The adoption rule is production's rule (`ChatScreen.tsx:173-174`; `AgentRevisionStatus.tsx:129-133`): adopt when the session follows its agent, no turn or approval is active and nothing is unsaved. One condition joins it: an open view form with edits also blocks adoption. Otherwise the chip offers "Update to vN".

Documented limit: a save that another person or another browser makes reaches an open session only on the next focus, visibility change or session switch.

### D8. Speed rules (rule 8, DECIDED)

- No new dependency. No antd in new code. A change to a package export map is allowed; a new entry in `dependencies` is not.
- The panel contents (Files, Configuration, Builder) and every view load with `next/dynamic`. The prototype measured +0.1 KB on the session page with this rule.
- `speed:check` runs on every PR that changes `web/mobile` pages. The session route budget is 1,869,151 gzip bytes (`web/mobile/scripts/speed/budget.json`). Only Mahmoud can raise a budget.
- Values that change fast (the drag width, streaming text, the page context, the session id) are read in the leaf component that shows them, not passed from the top. In React terms: a component re-renders when a value it reads changes, so a value read high in the tree re-renders the whole tree.
- The panel lives above the session-keyed part of the screen and is keyed by agent id. A session switch inside one agent does not reload the builder chat (design rule 1.6a).
- The 220 ms wait before a session row opens is removed: the first click opens the session, a double click renames the session that is now open (`web/packages/agenta-sessions-ui/src/SessionRowActions.tsx:196-219`). The old desktop app mounts the same row (`web/oss/src/components/Sidebar/dynamic/sessionRowWrapper.tsx:26`), so it gets the same change with no edit in `web/oss`.
- Keeping several conversations mounted, hover prefetch and paged history reads are candidates for the speed project. It measures first and keeps only what the numbers support.

### D9. No compatibility layer; text and i18n (rule 9, DECIDED)

- No adapter that keeps the old drawers working beside the views. No runtime flag injection.
- Old localStorage keys (the left pane width, the collapsed flag, the prototype keys) are not migrated. They stay unused.
- New text that Mahmoud has not confirmed (the program handoff lists it) goes to him first, then to the catalogs for all 7 languages.
- Each owning package or feature gets its own namespace, named `<package or feature>.<component>`: for example `ui.viewStack`, `chat.changeCard`, `entityUi.skillView`, `automations.runHistory`, `builder.panel`. A namespace is registered with `defineCatalog` in `web/packages/agenta-i18n/src/catalogs/<namespace>.ts` (as `chat.approvalCard.ts` does today), so two milestones never edit the same catalog file.

### D10. No layout switch (rule 10, DECIDED for the program branch)

The program branch replaces the session layout in place. There is no browser switch between the old and the new layout. The reason: the shared views in Settings, onboarding and the Skills and Automations pages change for everyone on the program branch anyway, so a switch would protect no user. It would only keep the old layout alive and double the QA.

- Foundation A removes the left configuration pane, the session tab row and the old top bar from `SessionWorkspace.tsx` in the same PR that adds the panel and the header.
- A comparison with the old layout uses the production stack, not a switch.
- The release milestone deletes the drawers and drawer hosts that no container mounts. It does not remove a switch.

### D11. The panel state store (orchestrator decision; Mahmoud can overturn it)

**Problem.** The panel remembers what it shows and its width. Design rules 1.6 and 2.2 say "per user". The prototype stores it per browser, for every user of that browser.

| Option | Trade-off |
|---|---|
| Per user, on the server | Needs a new preference store and a request before the panel can draw. |
| **In browser storage, keyed by user and project** | No backend. A second person on the same browser does not get the first person's state. A person on two browsers sets it twice. |
| Per browser, keyed by project only (prototype) | No backend. A second person on the same browser gets the first person's panel. |
| Per agent | More keys; the design wants the panel to stay open across agents (design rule 1.7). |

**Chosen: browser storage, keyed by user and project.** One key, `agenta:agent-panel:${userId}:${projectId}` (the repo pattern `agenta:<area>:<thing>:<ids>`, as `agenta:settings:${userId}:${key}`), holds:

```ts
interface AgentPanelState {
    content: "files" | "configuration" | "builder" | null  // null = closed
    width: number                                           // 360 to 640, default 440
    configTab: "agent" | "automations" | "channels" | "access"
}
```

Not stored: the open views (lost on reload, by design), the builder chat id (derived from the server, D12), the 760 px wide state, focus, uploads. When the browser refuses storage, the panel opens closed and works (agent-panel spec). Files keeps its production width key `agenta:agent-chat:files-pane-width` (`web/packages/agenta-chat/src/state/panelLayout.ts:155`), as decided for the Files pane. The overlay under 1100 px is a layout rule, not stored state.

### D12. The builder chat link (orchestrator decision; frontend only)

**Problem.** The panel opens "the last builder chat about this agent" (design rule 1.3) and lists recent chats about this agent. The builder is one static agent, `__ag__builder`, for all agents, so the agent reference of a builder chat does not say which agent the chat is about.

| Option | Trade-off |
|---|---|
| **A browser storage map from agent to its builder chats, keyed by user and project** | No backend. Chats started in another browser or on another device are missing from the panel's recent list for that agent. |
| A server tag on the builder chat's session and a query predicate | Works across devices, but it is a backend change, and this program changes no backend. Not chosen. |
| Scan the messages of each builder chat | No new field. Reads every chat's records; too slow. |

**Chosen: browser storage.** The key is `agenta:builder:chats:${userId}:${projectId}` (PROPOSED). The value maps each agent id to its builder chat ids, newest first. The browser adds a chat id under an agent when the first message of a chat carries that agent in its page context (D13), and when a builder tool result in the chat names an agent for the first time (D14). Every read and write handles a browser that refuses storage: the panel then opens a new chat.

**The 2-day rule.** When the panel opens or the agent changes: take the newest chat of this agent from the map and read its session. Open it when it runs now (liveness) or when its last activity is less than 48 hours old. Otherwise open a new chat. A new chat has a client-side id and becomes a server session on the first send, as today. The "Recent chats" rows are the three newest chats of the map for this agent. Documented limits: a chat started in another browser does not show under its agent in the panel (it shows in the builder page sidebar and in Chat history, which list the person's builder sessions); last activity is `updated_at`, which a heartbeat, a rename or an archive also moves (`api/oss/src/dbs/postgres/sessions/streams/dao.py:603-607`), so a renamed old chat counts as recent.

How a session stores a reference to a static agent with no database row is not verified. The builder agent work (PR 8346) must answer it (D19).

Sessions that the builder STARTS (a test run of another agent) carry the session origin `builder` and the reserved tag `ag.builder.session_id`, which points to the builder chat that started it. Today `SessionOrigin` has `manual` and `trigger` (`api/oss/src/core/sessions/types.py:49-51`). The builder agent work provides both, through the builder tool that runs another agent (PROPOSED name `run_agent`; tasks 30 and 31, D19). This program reads the origin for the builder spark in the sidebars, the session menu and the Sessions page (task 43). A builder chat itself keeps the origin `manual`.

### D13. Page context (DECIDED by Mahmoud for the content; the carrier is an orchestrator decision)

**Problem.** The builder must not ask "which agent?" (design rule 9). The prototype sent hidden text with the first message only.

| Option | Trade-off |
|---|---|
| Hidden text in the first message only (prototype) | Stale after navigation. |
| A structured `page_context` object in the message metadata, read by the server | Needs an SDK, runner and record change to reach the model and to survive a reload. This program changes no backend. Not chosen. |
| **One context line in the message text the model reads, with `metadata.display_content` set to the person's own text, on every user message** | No backend: the existing `display_content` path already keeps the person's text apart from the model text, end to end. Follows navigation. A sent message keeps its chip after a reload. |

**Chosen: a context line plus `display_content`.** The client sends messages as AI SDK `UIMessage` objects under `data.inputs.messages` (`web/packages/agenta-playground/src/state/execution/agentRequest.ts:448-453`). For a builder message the browser puts one context line before the person's text in the message text, and sets `metadata.display_content` to the person's own text. Every layer already carries this:

- the SDK keeps `display_content` when it reads the message (`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:67-72`; the field at `sdks/python/agenta/sdk/agents/dtos.py:677`);
- the runner persists it with the user message (`services/runner/src/server.ts:1134-1142`);
- the browser shows `display_content` in place of the text (`web/packages/agenta-chat/src/assets/displayContent.ts:3-10`);
- the history rebuild restores it after a reload (`web/packages/agenta-chat/src/assets/transcriptToMessages.ts:460-461, 898`).

The model reads the full text with the context line; the person sees only their own words. No SDK, runner or record change.

```ts
interface PageContext {
    agent: {id: string; name: string}                    // always (design rule 9.1)
    page?:                                               // only while the chip is shown (design rule 9.5)
        | {kind: "configuration"; tab: "agent" | "automations" | "channels" | "access"
           item?: {list: ConfigItemRef["list"]; key: string; name: string}}
        | {kind: "session"; session: {id: string; name?: string}; revision: {id: string; version: string}}
        | {kind: "sessions" | "analytics"; filters: Record<string, unknown>}   // shape decided in task 44.1
}
// written as one context line before the person's text; the format is a frontend contract (PROPOSED)
```

- **The context line.** One line in a fixed, parseable format that names the agent (id and name) and the page part with ids. Its exact format is PROPOSED and owned by the page context contract (SC5, task 8.1). The builder instructions say how to read it (builder agent work, with the behaviors session).
- **Read at send time, snapshotted at queue time.** The page writes its part to one atom, `pageContextAtom`. When the person presses Send, the send function reads the atom and copies the value into the queued message. A retry of that message sends the same snapshot, even after the person navigated away.
- **The chip of a sent message.** The browser rebuilds the chip from the stored message: it parses the context line in the stored text. This works after a reload, and after an approval resume. A message with no context line shows no chip and no error.
- **Ids, not content.** The builder reads the configuration, a session or traces with its own tools, which check the person's rights (design rules 9.3 and 9.8; the read-session and read-traces tools of the builder agent work, task 32). The chip component reads the atom; no prop carries it into the builder, so a session switch re-renders only the chip.
- **Builder page.** There is no page behind the chat. The context is the agent of the active builder tab (design rule 9.7).

### D14. The change card data flow (DECIDED)

**Problem.** The card shows old and new values and "Saves as vN". The tool call carries only the change. The approval card in PR 7409 shows only new values (`describeAgentChanges.ts` on that branch). Computing old values in the browser is not a small path resolver: the change-set engine has anchor matching, overlap rules, text normalization, match modes and sequential operations, where a later operation can change what an earlier one created (`api/oss/src/core/workflows/change_set.py:1130`, `apply_text_edits`; `:1894`, `apply_change_set`). A browser copy would drift from it, and a wrong approval preview is a correctness problem.

`edit_agent_config` takes `{agent, base_revision_id, operations}`. An operation is `{operation, target, value | edits}`, where `target` is a path of segments such as `["parameters", "agent", {"list": "skills", "key": "release-qa"}, "body"]` (`op_catalog.py` on the PR 7409 branch). `commit_revision` in an agent's own chat has the same shape.

**One proposal is one tool call.** A versioned proposal is one tool call with up to 64 operations against one agent and one base revision. Approving several pending calls does not merge them into one transaction: two calls on v4 can give one saved v5 and one conflict. So several calls may share an "Approve all" button, but each keeps its own result row. A change that applies at once (not part of a version) is never grouped with a versioned one.

**Card data.** The describer stays a pure function that returns data (`web/packages/agenta-chat/src/skin/types.ts:31-43`, `ApprovalPreview`). It gains an optional list; `sentence` stays the fallback for tools that do not change the configuration:

```ts
interface ApprovalChange {
    title: string
    path: string[]                       // segments; the card joins them with "›"
    detail:
        | {kind: "text_diff"; old?: string; new: string; fragmentsOnly: boolean}
        | {kind: "value_change"; old?: unknown; new: unknown}
        | {kind: "item"; change: "added" | "removed"; name: string; description?: string; files?: string[]}
        | {kind: "user_step"; step: "connect" | "secret"; name: string}   // request_connection, request_secret
    effect: "version" | "immediate"      // the footer note and the groups of the grouped card derive from it
    risks: {kind: "fewer_approvals" | "data_egress" | "cost" | "breakage"; message: string}[]
}
// ApprovalPreview gets: changes?: ApprovalChange[]
```

- Old values are data that the card host passes back to the describer, in the same way `sourceKey` and `appName` work today. The describer does no fetch.
- DECIDED: the server computes the preview. When the builder's approval gate opens, the server runs `apply_change_set` (`change_set.py:1894`) on the base revision with the proposed operations (no save) and attaches a bounded preview (old and new value per changed path) to the approval payload. The builder agent work provides it (task 9.4, D19); this program reads it.
- When the preview is missing for one tool call (for example a tool that has no preview), the card shows the proposed values with a label (text to write) and no old value. The card never guesses an old value.
- Risk data comes with the preview: a permission set to "Allow" (`fewer_approvals`) and a new MCP server URL (`data_egress`) from the operation; the price ratio of a model change (`cost`) from the API price map (`api/oss/src/core/tracing/utils/pricing.py:146`, `resolve_pricing_model`); a removed integration or MCP server named in the text of an attached skill (`breakage`); the tool count of a new MCP server (task 35, builder agent work).
- User steps are cards too. The builder asks with the static client tools `request_connection` and `request_secret` (`api/oss/src/core/workflows/static_catalog.py:127, 201`), which the browser renders today with `ConnectRequestWidget` and `SecretRequestWidget` (`web/packages/agenta-entity-ui/src/clientTools/registry.tsx:57-69`). The card hosts that step; a secret goes from the browser to the project vault, and the builder gets only its name. Adding both tools to the builder tool list is builder agent work (task 33).
- Changes that apply at once (a channel, an automation, access) come from builder tools with `effect: "immediate"`; attaching a secret is part of a version. The builder agent work provides these tools (task 34). The grouped card orders its groups "Saved together as vN", "Needs you first" and "Applies at once, not part of a version", and hides an empty group.
- "Saves as v{base + 1}" uses the base version of the builder's call. When the latest version is newer than the base, the card shows the conflict state before the person clicks Approve.
- Card states derive from the interaction status and the result `status` in one function. There is no parallel state enum.

**The flow.**

1. The tool part arrives with its input and the "waiting for approval" state.
2. The card host reads the preview from the approval payload.
3. "Approve" and "Deny" resolve the interaction with the existing `verdict` (`api/oss/src/apis/fastapi/sessions/models.py:311-316`).
4. The tool result carries `revision: {id, version}` (the new revision) and the agent reference. PR 7409 must return this shape, the same as `read_agent_config`, before it merges; `base_revision_id` keeps one meaning (the base to send with the next edit). The card shows "Saved as v{revision.version}". The browser clears the latest-revision caches for that agent and runs the latest-version check, so open sessions of that agent in this browser learn of the save (D7).
5. The builder page opens or marks the builder tab of that agent from the same typed tool results (D15). The prototype's shell-command parser is not ported.

### D15. The builder page with builder tabs (DECIDED by the approved design)

The builder page has the new chat (B01) with the hero, Browse ideas (B02), and a pane with builder tabs (B03, B04).

- **Builder tabs.** One tab per agent, automation, tool or app that the chat touched. A chip in the chat opens its tab, and "+" ("Open an item") opens another one. The pane mounts only the active tab. Which view a tool tab and an app tab mount is an open technical question (OPEN-QUESTIONS 3.24).
- **Where they live.** The active tab is in the URL as `?tab=<kind>:<id>` with a replace (no new history entry). The open tabs and the active tab are stored per chat in this browser (D16). A chat keeps at most 50 tabs; the oldest tab that is not active goes first. A closed tab does not reopen by itself in that chat.
- **Which agent.** The first agent tab comes from the agent in the chat's page context (D13) or from the latest typed tool result of the chat (D14). A saved version of an agent with no open tab opens its tab with a dot, unless the person closed it in that chat.
- **Follow the builder.** When the builder changes the agent of the active tab, the tab moves to Agent; when it starts a test of that agent, to Sessions. If the person clicked in the pane in the last 10 seconds, the view stays and the other tab gets a dot (change) or a spinner (test). Changed rows show "Changed by the builder" until the person opens the row or closes the tab (PROPOSED).
- **Test tab.** While the builder tests an agent with the test-run tool of the builder agent work (D12, D19), the Sessions tab shows the test session read only, with "The builder is testing Email writer.", "Reply" and no composer.
- **Hero.** One state input (`idle`, `typing`, `thinking`, `done`), one still frame with `prefers-reduced-motion`, a pause when the browser tab is hidden or the hero is off screen, a still fallback ("Three dots") when WebGL is missing, loaded with `next/dynamic` with no budget change. The variant is Mahmoud's choice (OPEN-QUESTIONS 1.1); until he picks, the hero shows the current ring with the same state input.

### D16. Where state lives

| State | Where | Key or scope | Why there |
|---|---|---|---|
| Session id, agent id | URL route | today's routes | A link opens the same screen. |
| Agent page and its tab | URL query on the agent route | `?view=configuration&tab=automations` (as `?view=runs`, `?tab=llms`) | A link opens the same page and tab; the agent pages share one page file, so a move between them usually needs no restore (D6). |
| Active builder tab | URL query | `?tab=<kind>:<id>` | A link opens the same builder tab. |
| Open builder tabs and closed-tab memory | localStorage | `agenta:builder:tabs:${sessionId}` (PROPOSED) | Per chat in this browser; at most 50 tabs (D15). |
| Panel content, width, panel tab | localStorage | `agenta:agent-panel:${userId}:${projectId}` | Survives a reload; no backend; a second user of the browser does not get it (D11). |
| Builder page layout | localStorage | `agenta:builder:layout` | The pane width and whether the pane is hidden survive a reload. |
| Files width | localStorage | `agenta:agent-chat:files-pane-width` (today) | Production behavior. |
| Composer text and scroll of a conversation | memory store keyed by session id | per session | Restored after a route remount (D6). |
| Which sidebar (main or agent) | sessionStorage | per browser tab | design rule 3.11: per tab; a shared link opens the main sidebar. |
| Open views | React state in `ViewStackHost` | per container | Lost on reload by design. |
| Agent draft | atom (memory) | `workflowDraftAtomFamily(revisionId)` | Today's draft; auto-save saves it (D5). |
| Page session id | atom (memory) | `pageSessionIdAtom` | Read low in the tree (D6). |
| Page context | atom (memory), then a snapshot in the queued message, then the context line in the stored message | `pageContextAtom`; the context line plus `metadata.display_content` | Read at send time; the chip is rebuilt after a reload (D13). |
| Chip removed | atom (memory) | per builder chat id | Resets on reload; harmless. |
| Latest-version check trigger | atom family (memory) | per workflow id; written by a committed builder tool result, window focus and visibility | A trigger, never a pin (D7). |
| Revisions, sessions, builder chats | TanStack Query | today's keys | Server data with a cache. |
| Builder chat link to its agent | localStorage | `agenta:builder:chats:${userId}:${projectId}` (PROPOSED) | No backend; per browser (D12). |
| Who started a session | server, session origin and tag (builder agent work) | `origin: "builder"`, `ag.builder.session_id` | Read by the builder spark and the session menu (D12, D19). |

### D17. The phone (DECIDED by the approved phone design)

Below 768 px (PROPOSED edge, as production's one-pane rule), a panel content opens full screen with a back arrow, and a view inside it opens full screen with a back arrow to the screen before it. The phone chrome is the fifth chrome of D2. The 13 redrawn phone screens (M01 to M13) and the phone screens the phone scope names (Access, the Sessions list, Analytics read only, Version history, run history in one column, the read-only views, the provider form, the channel connect steps, the session bottom sheet, the agent menu) ship in the same release. Each phone milestone pairs with its desktop flow and starts when that flow merged (tasks 49 to 54). A shared phone contract lands first (task 49.1, SC9): the phone chrome, the sidebar sheet (300 px, 44 px rows), the bottom-sheet menu, the full-width primary action at the bottom, and a `readOnly` input that a phone container passes to a view. The three phone-only choices of the phone design hold: Configuration opens a page with three tabs, the session header has two rows, and there is no "Open in the builder" on a phone.

### D18. Build on the existing package architecture (DECIDED by Mahmoud)

The program builds on the existing `@agenta/*` package architecture and does not replace it.

- Data access stays in `@agenta/entities`: entity molecules, query atoms and the loadable bridge. A view adds no new data layer, no new store and no new fetch path. A view that needs data reads it through the entity molecules (a backend analogy: views call the existing service layer; they do not open their own database connection).
- Views live in the existing domain UI packages: `agenta-entity-ui`, `agenta-settings-ui`, `agenta-skills-ui`, `agenta-automation-ui`, `agenta-chat`, `agenta-sessions-ui`. Only the generic view host (D2) goes to `@agenta/ui`.
- The DrillIn schema controls are split into files (D4), not rewritten.
- Package placement follows the `agenta-package-practices` skill (`.agents/skills/agenta-package-practices/`). Every frontend session loads it before it writes code, and the review conformance checklist asks whether a PR adds a data path that bypasses the entity molecules or moves code across package boundaries against those practices.

### D19. Depends on the builder agent work (DECIDED; owner the builder architecture session)

This program writes no backend code. The builder PR stack and the builder tools are the builder agent work, owned by the builder architecture session. This program reads what that work provides, and its frontend milestones that need a part wait for it (tasks.md, the sections under "Depends on the builder agent work"):

| Task section | What the builder agent work provides | Frontend that reads it |
|---|---|---|
| 9 | The PR stack on the program branch (9.1, 9.2, 9.6); the tool result `revision: {id, version}` (9.3); the server preview on the approval payload (9.4, DECIDED); `request_input` in the builder tool list (9.5) | the first builder edit (8), the change cards (25, 26), the builder page (27), the choice form (28) |
| 30 | The session origin `builder` and the tag `ag.builder.session_id` on a session that a builder tool starts | the builder spark (43), the test tab (42) |
| 31 | A tool that runs another agent of the project as the person (PROPOSED `run_agent`) | the test tab (42), the spark (43) |
| 32 | Tools that read a session and read traces with the person's rights (PROPOSED `read_session`, `read_traces`) | the page context parts (44) |
| 33 | `request_connection` and `request_secret` in the builder tool list (the tools exist on `main`, `api/oss/src/core/workflows/static_catalog.py:127, 201`) | the user-step cards (45) |
| 34 | Tools for the secret, channel, automation and access cards (PROPOSED `attach_secret`, `connect_channel`, `create_automation`, `set_agent_access`) | the grouped card and the cards that apply at once (46) |
| 35 | Risk data on the preview: the cost ratio, the skill text scan, the tool count of a new MCP server | the warning lines (47) |

### D20. Frontend only, with two backend tasks (DECIDED)

Mahmoud expects no backend change in this work, with two exceptions he asked for. The parts of the approved design that have a backend side are decided as follows:

- **"Run now" (DECIDED by Mahmoud).** "Run now" stays exactly as today: the browser path starts a new session, and the run is not listed in the run history (`web/mobile/src/features/automations/AutomationTestRunButton.tsx:64-72`). No server routes. Task 21.4 merges the two client paths (`AutomationTestRunButton` and `useTriggerTestRun`) into one hook only if the merge changes no behavior.
- **MCP sign-in account name (DECIDED, backend task 39.1).** For project servers connected by address (`custom`), the server reads the account name at a person's OAuth sign-in (from the token response, else from the server's user info), stores it with the grant and returns it next to `is_ready` (today only `is_ready`, `api/oss/src/apis/fastapi/gateways/mcps/models.py:37-41`). The screen shows "Your sign-in: {{name}}", or "Signed in" when the server gives no name.
- **Personal accounts on by default (DECIDED, configuration default, task 10.1).** The default of `AGENTA_ACCESS_PERSONAL_ACCOUNTS_ENABLED` turns to true (`api/oss/src/utils/env.py:216-217`). The account switch and each person's own MCP sign-in show by default; an installation can set it to false.
- **Built-in models on and off per project (DECIDED: not part of this work).** It comes later as its own backend change outside this program. In this release the "Agenta" card lists its three models with no switches.

## Risks / Trade-offs

- **Merge conflicts between parallel sessions.** Many sessions build at once, on two dev machines. Mitigation: the split goes first (D4); the first slice settles the view contract in working code before the frontend flows start; shared files have one owner at a time and change hands on a dated hand-off (WORKING-PLAN section 2). `sectionRegistry.ts` changes by one line per milestone. New text goes to one catalog file per owning package or feature (D9).
- **Last write wins between a person and the builder.** Auto-save sends no base, so a person's edit can save over a builder version (D5 rule 8). This is production behavior. The builder version stays in the version history, and the builder's own saves send a base.
- **Shared screens change in Settings and onboarding.** A redrawn view changes Settings, onboarding, the run error drawer and the Skills and Automations pages for everyone (D3). Mitigation: the milestone that redraws a flow moves every mount in the same PR; QA checks every place in the D3 table on the program base.
- **The builder PR stack is on stale bases.** PR 8341 targets a release branch that already shipped and PR 8346 targets a branch that merged. The first builder edit, the builder panel, the change cards, the builder page and every new builder tool depend on this stack. Mitigation: the rebase is part of the builder agent work with one owner (D19); the asks to that owner are written down (WORKING-PLAN section 6.1); the change card tests use recorded tool parts.
- **Many new builder tools.** The test run, the reads, the user steps, the changes that apply at once and the risk data are five parts of the builder agent work, in one session that this program does not run. Mitigation: they start on day one on the builder stack branches; each has a date by which its card or tab milestone needs it (WORKING-PLAN section 6.1).
- **A context line in the message text.** The builder reads the page context from one line in the message text (D13). A builder that ignores or misreads it asks "which agent?". Mitigation: a fixed, parseable format; the builder instructions name it; the bench has a scenario for it.
- **Session follow across browsers.** Without a server event, a save made in another browser reaches an open session only on the next focus, visibility change or session switch (D7). This is a documented limit.
- **A static agent in `/m`.** Nothing in `/m` opens a static agent today, and PR 8346 had no live QA for that reason. How a session references `__ag__builder` is not verified (D12, D19).
- **Bundle size.** The panel, the builder chat, the builder tabs, the hero and the views could grow the session route. Mitigation: every content, view and the hero load with `next/dynamic` (D8); `speed:check` on each PR; the budget is not raised without Mahmoud.
- **Two engines on one screen.** Two live conversations stream at once. Memory and CPU on a long session are not measured. The speed project measures them first.

## Migration

**Program flow.** All work merges into the program branch `feat/builder-layout`, where the new layout replaces the old one in place (D10). The program branch goes to a release branch when the full scope passes QA, desktop and phone (DECIDED by Mahmoud: one program branch, released once). This program changes no backend. The builder agent work adds a session origin value and a reserved tag (D19); old clients ignore them. The one backend item that waits for Mahmoud's approval, built-in models on and off (D20), adds a vault row kind with no migration of existing tables.

**During the build:**

1. Foundation A replaces the session layout: the left configuration pane (`ConfigPane`), `SessionsPane`, `CollapsedConfigRail`, the session tab row (`SessionTabs` and its rail), the old `SessionTopBar`, and the separate Files split in `SessionWorkspace.tsx` give way to the header and the panel.
2. Auto-save does not change. The new panel content passes `autoSave` to the configuration header, as `ConfigPane` does today.

**At release, the release milestone:**

1. Deletes the drawer hosts that no container mounts: `SessionWorkspaceDrawers`, `SessionAutomationDrawers`, and the drawer block in `AgentTemplateControl.tsx` (already moved out by the flows).
2. Deletes drawers that every caller replaced with a view: `ConfigItemDrawer`, `SectionDrawer`, `InstructionsDrawer`, `AgentIntegrationDrawer`, `McpAddServerDrawer`, `McpPermissionDrawer`, `SkillDetailDrawer`, `SkillCreateDrawer`, `TriggerDeliveriesDrawer`, `CatalogDrawer`. Where a host still needs a drawer (prompt playground, create prompt, revision drawer, run error drawer, onboarding), it mounts the view in `DrawerViewChrome`. The old desktop app `web/oss` imports `SkillDetailDrawer`, `SkillCreateDrawer`, `TriggerDeliveriesDrawer` and the session row. `web/oss` is abandoned, but it must still compile: the release milestone keeps the shells it imports, or removes those imports from `web/oss`.
3. Deletes the prototype entry points if any were ported.

**Duplicate implementations (from the reuse map) and their end state:**

| Duplicate today | End state |
|---|---|
| Integration catalog, 3 copies (`IntegrationCatalog`, `CatalogDrawer`, `AgentIntegrationDrawer`) | One `integrationAddView`; the three are deleted. |
| MCP server list (`McpServersSection` in Settings and `McpServersSectionBody` plus `McpAddServerDrawer` in the agent) | One server list and `mcpServerView`; both containers mount them. |
| MCP token sign-in (`McpTokenSignInDialog` and the token form in `McpSignIn`) | One sign-in view. |
| Secret create form (`SecretFormSheet` in `web/mobile` and the package `SecretForm`) | One form in `secretAttachView` and Settings secrets. |
| Provider key entry (`OnboardingKeyForm` with no key check; `ProviderConnectionCard` with the probe) | One key view with the automatic check; onboarding mounts it. `ProviderCredentialsSectionView` is rendered nowhere and is deleted if that is confirmed. |
| Run history (`AutomationRunHistoryView` and `TriggerDeliveriesDrawer`) | One run history view. |
| Test run (`AutomationTestRunButton` and `useTriggerTestRun`) | "Run now" as today; one client hook only if it changes no behavior (D20, DECIDED). |
| Drawer hosts (`SessionWorkspaceDrawers` and `SessionAutomationDrawers`) | Deleted at release. |
| Two `SessionFilterMenu` (`web/mobile` and `agenta-navigation-ui`) | One, merged by the agent pages milestone when the Agent filter is locked. |
| Agent overview cards (app and package copies) | Not touched: the package copies are used only by the classic app. |
| Skill list (`SkillListScreen` and `SkillsGalleryPage`) | Not touched: the second is used only by the classic app. |

**Rollback.** The release is one merge. Rolling back means deploying the previous release images. This program changes no backend. Builder chat links, builder tabs and panel state live in browser storage; an older frontend ignores those keys. A context line in an old message stays readable text. Sessions with the origin `builder` (builder agent work) and built-in model rows (D20, if approved) stay readable and are ignored by the older code (not verified for the origin value).
