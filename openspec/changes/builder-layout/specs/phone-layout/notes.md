# phone-layout: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements.

## Scope

The release holds every phone screen of the approved phone design: the 13 drawn screens M01 to M13 and the screens that the scope table of the phone design names but does not draw. Each phone milestone pairs with its desktop flow and is built by the session of that flow, after the desktop flow merged.

| Screen | Milestone and task | Paired desktop flow |
|---|---|---|
| Phone shared contract SC9: phone chrome, sidebar sheet, bottom-sheet menu, full-width primary action, `readOnly` input | Phone: session, sidebar and Files, task 49.1 | view stack and panel host (section 3) |
| M01 session (two-row header), session bottom sheet, agent menu | task 49.2 | session header (section 3), sidebars (section 12) |
| M02 agent sidebar in a sheet | task 49.3 | sidebars (section 12) |
| M03 Files, read only | task 49.4 | panel host, Files content (section 3) |
| M04 builder new chat, M06 chat history | Phone: builder, tasks 50.1, 50.3 | builder panel (section 24) |
| M05 change card, full diff | task 50.2 | change card states (section 26) |
| M07 Configuration page, Version history, Access, Sessions list, Analytics | Phone: Configuration and agent pages, tasks 51.1, 51.2 | agent tab (section 22), agent pages (section 23) |
| Read-only Instructions, skill view, Advanced, Add MCP server, Add subagent | task 51.3 | agent tab, skills, secrets and Advanced, MCP and subagents (sections 18, 20, 22, 17) |
| M13 Channels, channel connect steps | task 51.4 | agent pages (section 23) |
| M08 Integrations, M09 account switch | Phone: integrations, task 52.1 | integrations (section 16) |
| M10 Automations tab, M11 "Add automation" sheet, run history one column | Phone: automations, tasks 53.1, 53.2 | automations (section 21) |
| M12 model providers, provider form full screen | Phone: model providers, task 54.1 | model picker, provider keys, subscriptions (sections 13 to 15) |

The read-only views of task 51.3 live in files that other milestones own and that are frozen by then. They change under a lock in `STATUS.md`. Each view honors the `readOnly` input of SC9.

## Words used in this file

- **Phone**: a window narrower than 768 px. This is the width where production shows one pane at a time (`twoPane` false). The drawings are 390 x 844 px.
- **Full screen view**: a screen that covers the whole phone screen and has a back arrow at the top left. It replaces the right panel of the desktop.
- **Phone chrome**: the frame the view stack draws around a view on a phone: the back arrow and the title.
- **Content**: Files, Configuration or Builder.
- **Root** and **view**: as in the agent-panel capability. A root is the base screen of a container; views sit at depth 1 and 2.
- **Bottom sheet**: a panel that slides up from the bottom edge, full width, at most 85 percent of the height, with round top corners. Production uses it below 1024 px.
- **Sidebar sheet**: the sidebar inside a sheet that slides in from the left. It opens from the menu button.
- **Hit area**: the part of the screen that reacts to a tap. It can be larger than the drawn control.

## Today's behavior on a phone (origin/main 5d783fec, v0.129.0)

- Below 768 px production shows one pane at a time: `twoPane = useMediaQuery("(min-width: 768px)")` (`web/mobile/src/features/chat/SessionWorkspace.tsx:207`), resolved by `resolveSessionPanes` (`web/mobile/src/features/chat/sessionPanes.ts:34-55`). The configuration pane replaces the conversation.
- Files takes the whole screen with a back control on a phone (`SessionWorkspace.tsx:484`, `closeControl={twoPane ? "none" : "back"}`).
- The session header has no back arrow; the comment says "Nav is the DRAWER here" (`web/mobile/src/features/chat/SessionTopBar.tsx:69`).
- The sidebar sheet is the rail inside a sheet, `w-3/4`, at most 384 px (`web/packages/agenta-ui/src/components/ui/sheet.tsx:70-71`; `web/mobile/src/features/nav/NavDrawer.tsx:25-26`). Its rows are 28 px. The phone design replaces it with a 300 px sheet with 44 px rows (task 49.3).
- The `responsive` sheet is a bottom sheet below 1024 px, `max-h-[85vh]`, round top corners (`sheet.tsx:83-94`).
- The approval dock sits at the bottom outside the transcript (`web/mobile/src/features/chat/ApprovalDock.tsx:10-18`).
- More production facts with file references are in the design note `mobile/NOTES.md` section 1 (catalog chooser below 640 px, model picker single column, run history below 700 px, tables below 992 px).

## Other places that mount the changed components

- `sessionPanes.ts` and `SessionWorkspace.tsx` decide the pane layout for every session today. Foundation A replaces the layout in place (design.md D10), so the phone path replaces this logic in the same work. There is no old layout to keep alive.
- `NavDrawer` mounts the shared `SidebarShell` for every screen. Task 49.3 changes the sheet width to 300 px and the rows to 44 px on a phone; the desktop rail does not change.
- `sheet.tsx` is the shared sheet. Use the existing `responsive` and `bottom` variants; do not add a variant for one screen.

## Backend work

None. The phone uses the desktop data and actions.

## Phone width (PROPOSED)

This file uses 768 px (the production `md` width of `twoPane`) as the edge of the phone layout. Production uses 1024 px (`lg`) for the sidebar sheet and the bottom sheets, so a window between 768 and 1023 px gets the desktop panel (in overlay mode, agent-panel capability) with the phone sidebar sheet, as today. Mahmoud can pick one edge for all of it.

## Decisions of the approved phone design

The phone design (section 4 of its notes) takes three choices that the desktop design does not have. The approved phone scope decides them:
1. On a phone, the Configuration icon in a session opens the Configuration page with the tabs Agent, Automations and Access, not a separate panel. Channels is reached only from the agent sidebar.
2. The session header has two rows. Row 1 is about the agent, row 2 is about the session.
3. The builder has no "Open in the builder" on a phone, because it is already full screen.

Also from the phone design: "Add automation" opens a bottom sheet; every list screen has its one primary action as a full-width button at the bottom; the version state sits at the end of the tab row; read-only screens show no sentence such as "Edit on a computer".

PROPOSED (not drawn): the agent menu opens as a bottom sheet with "Cancel", the production idiom below 1024 px for a menu that starts something.

## States described but not drawn

Not drawn: the session bottom sheet, the agent menu, Access, the Sessions list, Analytics, Version history, the run history, the read-only views (Instructions, skill, Advanced, MCP and subagent lists), the provider form and the channel connect steps. They reuse the desktop views in one column. Loading, error, empty and no-access states are not drawn; they reuse the desktop states.

## Text

- New phone labels from the canvas: "Open the sidebar", "Close the sidebar", "Back to Session", "Back to the session", "Back to the chat", "Back to Configuration", "Back to Integrations", "Back to Model", "Remove the context", "Ask the builder about this agent", "See all sessions", "Show older sessions" (the phone drops the count that the desktop shows), "Search chats...", "Version history" (title of "Saved as v4").
- "Search chats..." uses three dots; the desktop uses "Search chats…" (one ellipsis character). One must be picked.
- Desktop text on the phone screens that is not confirmed (HANDOFF section 5): "What should we change?", the quick actions "Improve", "Test", "Skills", "Automate", "Explain" and their ready requests, "Recent chats", "View all", "Chat history"; on M09 "Each person's own", "Everyone uses their own Zendesk account.", "One shared account", "Everyone uses the account you pick.", "Your account", "The Zendesk account your own runs use", "Use my default".
- New canvas text on M13: "A channel lets people talk to Support triage in the chat app they already use.", "Answer messages sent to a Telegram bot.", "Answer messages sent to a WhatsApp number." (production has other lines; see the agent-sidebar-pages notes).
- To write: the accessible label of a back arrow for a screen that the canvas list does not name (for example the run history, the version history, a read-only skill file).
- The design note of the phone design and its board list still say "Triggers tab" and "Add trigger". The final frames say "Automations" and "Add automation". Use "Automations" and "Add automation" (BEHAVIOR 10.1).
