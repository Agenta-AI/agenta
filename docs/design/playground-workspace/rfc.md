# Initial RFC: playground workspace architecture

> AGENT-GENERATED, low weight. Rough request for comments, not an approved technical design or implementation plan.

Date: 2026-09-11. Product companion: [PRD](prd.md).

## Current architecture

Code observations below refer to main commit `c6b52c09f75c69e19553d9693e4892a125e397f8`. They come from source inspection, not performance profiling.

The outer playground owns configuration and the build/chat arrangement. It supplies `AgentChatPanel` for agent conversations alongside older prompt and comparison surfaces.

```text
Playground
  Agent configuration
  AgentChatPanel
    Session tabs or rail
    Visited conversation views
    Files side pane for the active session
```

The desktop session store separates history from the ordered open-session list. Both, plus the active session, are scoped by project and chat surface, normally the agent. Drawers and onboarding can supply separate scope keys. Messages use session IDs.

An atom family is a cached factory that returns an atom for a key. It supports dynamic keys. The limiting assumption here is one active session per chat scope, not Jotai itself.

Conversation views mount on first visit and stay mounted while hidden. Live chat instances also live outside React in a registry keyed by session ID. The desktop retains them while their session tab remains open, including across route changes. However, their callbacks still bind to conversation components.

The files pane has openness state by chat scope and selection state by session. Its host supplies the active session's drive context. Hydration hooks and shortcuts also use the scope's active session. Two independently visible conversations require those assumptions to change.

Source entry points:

- [Playground composition](../../../web/oss/src/components/Playground/Playground.tsx).
- [AgentChatPanel](../../../web/oss/src/components/AgentChatSlice/AgentChatPanel.tsx).
- [Desktop session state](../../../web/oss/src/components/AgentChatSlice/state/sessions.ts).
- [Chat runtime registry](../../../web/packages/agenta-chat/src/state/sessionChats.ts).
- [Hydration hooks](../../../web/oss/src/components/AgentChatSlice/hooks/useSessionHydration.ts).
- [Files pane](../../../web/packages/agenta-entity-ui/src/drive/SessionFilesPane.tsx).

## Proposed ownership

Introduce a workspace layer above individual content views. Keep resources independent of their screen position.

| Layer | Owns | Does not own |
| --- | --- | --- |
| Workspace | Pane layout, tab order, selected tabs, keyboard focus | Messages, file contents, execution permissions |
| Tab view | Presentation, scroll, selection, visibility | The underlying resource's lifetime |
| Resource state | Session records, file data, shared document changes | Which pane displays the resource |
| Runtime registry | Live chat and remote desktop client objects | Pane placement |

Conceptually, the workspace stores a map of tab IDs to resource references, ordered tab IDs per pane, a selected tab per pane, and the focused pane. This is an illustrative model, not a final serialized schema or public API.

Resource identity names the underlying session, drive/path, child execution, or app instance. Tab identity names its view. Keeping these distinct allows future duplicate views without copying their underlying data. Initially, opening the same resource should focus its existing tab.

A small renderer registry maps a tab kind to a lazily loaded React view. Sessions, files, explorers, websites, computers, and apps can implement the same host expectations: title/status, visibility, focus, close handling, and recovery from missing resources. Their data and permissions remain type-specific.

A conversation opening a file requests an explicit resource and a preferred destination. The workspace chooses the pane and handles existing tabs. The conversation does not directly control a special right-hand files panel.

## State and commands

Keep Jotai for shared workspace state and retain existing entity/query state for backend data. A small workspace atom with derived subscriptions is sufficient to explore one or two panes. Tab labels subscribe to title and status, not entire transcripts.

Centralize open, select, move, close, and collapse operations. A move updates both pane lists together and preserves tab identity. It must never invoke the current close-session operation, which drops the runtime; the current close button also requests cancellation when a run is active.

Replace overloaded active-session checks with separate concepts: selected tab per pane, focused pane, visible sessions, and running sessions. Commands carry their target session or tab explicitly. Two sessions can be visible while only one receives keyboard input.

Use one shared resource store across the panes. Per-pane identity can use context, but isolated Jotai stores per pane would complicate shared data and moving views. Define cleanup for dynamically cached tab atoms when views close, without evicting resource state still in use.

## Moving and hiding views

React state belongs to a component's position in its tree. Moving a keyed view between different pane parents can recreate it. A stable key alone does not preserve it across those parents. See [React state preservation](https://react.dev/learn/preserving-and-resetting-state).

Two directions are possible:

| Direction | Benefit | Cost |
| --- | --- | --- |
| Allow remounting and restore view state | Simple component structure; views can be unloaded | Drafts, scroll, and runtime callbacks need explicit ownership |
| Keep views in stable hosts and change placement | Preserves more component-local state | More complex layout/focus handling; embedded document behavior still needs browser testing |

Provisional preference: allow native views to remount once important state can be restored. Reuse the existing chat registry, but review callback and effect ownership before relying on it for background operation. Avoid mounting two independent interactive conversation owners for one session: the current registry rebinds callbacks to the latest committing view.

Choose hidden-view policies by type. A running conversation can keep its runtime while reducing rendering work. An idle transcript or file preview can be eligible for unloading. An unsaved editor must retain its document model. Remote desktops and iframes need explicit suspension or bounded retention policies. Hiding a component does not stop its effects or connections.

Closing a view, disconnecting a client, and cancelling a server run must become separate operations if the PRD's proposed close behavior is accepted.

## Performance and persistence

Load heavy tab implementations on demand. Keep streaming messages out of layout state and keep pointer-move resize state out of persistent storage. Persist a versioned layout description after completed actions, scoped to the user, project, and agent. Do not persist credentials or temporary authenticated app URLs as resource identity.

The current chat hook throttles stream-driven UI updates to 50 milliseconds. The transcript virtualization path, which renders a window of long history, is experimental and disabled by default in its state definition. Neither observation proves that two large conversations will remain responsive.

Measure typing and resizing with two streaming sessions, long history, an app iframe, and repeated open/close cycles. Watch render frequency, mounted views, memory, and live connections. Set budgets from those measurements. Use separate loading and error boundaries so one tab's failure does not replace the whole workspace.

## Relationship to PR #6529

[PR #6529](https://github.com/Agenta-AI/agenta/pull/6529) proposes an explicit HTML Run mode and a narrow `window.arg.fs` file-access bridge. It is an open design proposal, not shipped functionality.

This workspace supplies the app's tab and placement. The HTML proposal supplies execution, file-access grants, and the validated parent/iframe message protocol. Opening, moving, focusing, or restoring a tab must not implicitly grant Run access or expand its file scope. Preview remains the initial mode as proposed in #6529.

Keep app resource identity, view identity, and permission grants separate. Moving a tab retains its original file context. If moving recreates an iframe, invalidate the previous instance's message handling and establish the new instance under the chosen grant policy. Grant persistence and reauthorization remain decisions for the HTML proposal; restoring layout must not silently authorize execution.

The workspace can first host existing static HTML previews. It need not wait for the file bridge. Conversely, the HTML Run experiment can use the existing file surface before this workspace exists. The proposals complement each other without requiring a stacked implementation.

## Implementation directions

| Direction | Fit | Tradeoff |
| --- | --- | --- |
| Extend specialized panels | A small number of fixed content combinations | Adds special cases as tab types grow |
| Generic one/two-pane workspace | The requested arrangement | Own tab movement, accessibility, restoration, and lifecycle policy |
| Docking library | Arbitrary splits, floating panels, development-environment layouts | Adopt the library's layout and rendering model |

Provisional preference: a generic two-pane workspace using the existing SplitPane primitive and drag-and-drop tooling. Agenta already depends on [dnd-kit](https://dndkit.com/). If arbitrary docking is intended, evaluate [Dockview](https://dockview.dev/docs/overview/introduction/) before building equivalent behavior. Its [inactive rendering policies](https://dockview.dev/docs/core/panels/rendering/) still require decisions about background work.

If a library owns layout, adapt its state to persistence and commands rather than maintaining a second competing layout in Jotai. A library does not solve session identity, grants, callback ownership, or run cancellation.

## Open engineering questions

- Can the existing conversation hooks consume explicit visibility and focus without depending on the scope's single active session?
- Which callbacks must move out of the conversation component before its runtime can safely outlive it?
- Can file views consume stable drive/path references without the active session provider?
- Which views need preserved browser document identity rather than restored React state?
- What stable identifiers and interaction capabilities exist for child executions and remote computers?
- Where should the workspace live so desktop changes preserve onboarding, drawers, prompt comparison, and the mobile host?

A useful first experiment is moving a streaming conversation and a file preview between panes, then collapsing to one pane. Verify draft/scroll restoration, uninterrupted execution, correct shortcuts, and unchanged file identity. This would test the proposed boundaries before committing to a larger implementation.
