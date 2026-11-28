# Product requirements: playground workspace

> Draft for discussion. Proposed requirements and scope need founder approval.

Date: 2026-09-11. Technical companion: [initial RFC](rfc.md).

## Current experience

The agent playground presents conversations through session tabs or a session rail. Files appear in a dedicated side pane that follows the active conversation. Agent configuration occupies another specialized pane.

A user who wants to discuss a document while viewing it, compare two conversations, or use an agent-created app needs a more flexible arrangement. The founder's requested direction is one or two panes, each containing tabs that can move between panes.

## Intended experience

A user can keep a conversation on the left and a document or app on the right. Either side can contain any supported tab type. The user can return to one pane without losing open work.

Example: an agent creates `todo.html` and `board.json`. The user opens the HTML beside the conversation, runs the app after granting access, and moves a card. The app updates `board.json`; the agent can read that file in a later turn. Switching conversations does not retarget the app to another session's files.

The execution and access steps in this example depend on [PR #6529](https://github.com/Agenta-AI/agenta/pull/6529), which remains a separate proposal. Opening an HTML tab alone must not execute its author-provided scripts.

## Candidate content

| Content | Intended use | Scope note |
| --- | --- | --- |
| Agent session | Read, send, and manage a conversation | Suggested first scope |
| Opened file | Read a document, source, or HTML preview | Suggested first scope; editing can follow |
| File explorer | Browse a specific drive and open files into tabs | Suggested first scope |
| Child-agent call | Inspect a particular child execution and possibly interact | Requires stable identity and supported interaction capabilities |
| Website or link | View an embeddable external page | Sites can restrict embedding; provide an external-open alternative |
| Computer view | View and control the agent's remote desktop | Requires a remote desktop service and access rules |
| Internal app | Use an app hosted within Agenta, including an HTML board | HTML execution and file access connect to #6529 |
| Other views | A Kanban board or another structured workspace view | Extension direction, not an initial delivery commitment |

## Proposed behavior

1. Users can open tabs in either pane, reorder them, and move them between panes. Provide a menu action as well as dragging so moving a tab is keyboard-accessible.
2. Each pane selects one tab independently. The focused pane receives workspace keyboard commands; visible conversations continue to show updates.
3. Opening an already-open resource focuses its existing tab initially. Showing duplicate views of the same resource is deferred.
4. Moving a tab preserves the resource, conversation draft, and relevant view position. It must not stop a run, resend a message, or change file access.
5. Returning to one pane retains the tabs from both panes. The precise merge order and selected tab need design review.
6. Closing a tab does not delete its resource. Proposed default: closing a conversation view does not stop the server run; Stop remains explicit. This differs from the current tab-close button and requires a product decision.
7. Restore open resource references and layout after reload. A missing file, deleted session, or expired computer shows an explanation and a recovery action without preventing other tabs from opening.
8. File and app tabs keep their original drive and path context when another conversation becomes selected. A future explorer that follows focus must clearly indicate that behavior.
9. On narrow screens, show one pane at a time while retaining access to all open tabs. Hidden controls must not receive keyboard focus.

## Proposed first scope

Validate the workspace using sessions, file previews, and a file explorer. Keep agent configuration accessible through the existing build/configuration flow while deciding whether it should become a tab.

The first scope does not require arbitrary nested splits, floating windows, shared layouts across users, duplicate interactive views of one session, a new file editor, or all candidate content types. Preserve existing prompt comparison, agent onboarding, and drawer behavior as the agent workspace evolves.

## Success criteria

- A user can discuss a document while viewing it, then compare two different sessions without navigating away.
- Moving a streaming conversation produces no cancellation, duplicated send, lost draft, or wrong-session shortcut.
- Opening a file from session A and selecting session B leaves that file attached to its original drive.
- Collapsing a pane and restoring the workspace after reload retain the expected tabs.
- A slow or failed tab does not prevent interaction with the other pane.
- Repeatedly opening and closing views releases unused view and connection resources according to the chosen lifecycle policy.

Performance targets need measurement on an agreed device and representative transcripts. No latency or memory target has been validated yet.

## Decisions for review

- Is one or two panes the intended limit, or should the design anticipate arbitrary splits?
- Should configuration stay outside the tab system initially?
- Should closing a running conversation stop it or only close its view?
- Should the explorer stay attached to one drive or optionally follow the focused conversation?
- Which candidate content types belong in the first delivery?
