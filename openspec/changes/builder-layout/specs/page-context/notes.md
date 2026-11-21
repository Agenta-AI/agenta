# page-context: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements.

## Words used in this file

- **Page context**: a small structured record that the app adds to a user message in the builder panel. It names what the user sees on the page. It holds ids, keys and short names, not content.
- **Context chip**: the chip in the builder composer that shows the page context. Its title on hover is "The builder sees this".
- **Agent part**: `agent: {id, name}`, always sent: the id and the name of the agent of the screen.
- **Page part**: `page`, sent only while the chip shows. It exists on a session, on the Configuration content and the Configuration page, on the Sessions page and on Analytics.
- **Send time**: the moment the user presses Send.
- **Snapshot**: the copy of the page context that the send function puts into the queued message. A retry or an approval resume sends the same copy.
- **Builder tool**: a tool the builder calls to read or change things. The page context needs the agent tools of PR 7409 (`list_agents`, `read_agent_config`, `create_agent`, `edit_agent_config`) and the read-session and read-traces tools (builder-backend capability, section 32 of `tasks.md`).
- **Context line**: the one line that the browser puts before the person's words in the text the model reads. It carries the page context. The runner stores that text, so the line comes back with the history after a reload.

## The shape (design.md D13)

```ts
interface PageContext {
    agent: {id: string; name: string}                    // always
    page?:                                               // only while the chip shows
        | {
              kind: "configuration"
              tab: "agent" | "automations" | "channels" | "access"
              item?: {list: ConfigItemRef["list"]; key: string; name: string}
          }
        | {
              kind: "session"
              session: {id: string; name?: string}
              revision: {id: string; version: string}         // the Reference shape
          }
        | {
              kind: "sessions" | "analytics"
              filters: {name: string; value: string}[]       // active filters, display names
          }
}
// written as one context line before the person's words in the text the model reads;
// metadata.display_content holds only the person's words
```

- `ConfigItemRef = {list, key}` with `list` in `tools | mcps | skills | files` is the one item address (design.md D2). `item` copies it and adds the display name, so the builder can build an operation target from it with no lookup. It also covers an agent-only skill, which has no server id.
- `page` is a tagged union on `kind`. The `filters` entries hold the filter names and values as the page shows them; the read-traces tool maps them to its own query. The exact filter shape is fixed by the agent pages session with the builder architecture session (task 44.1).
- Agent changes save themselves shortly after the edit (production auto-save, `web/packages/agenta-playground/src/state/execution/agentAutoCommit.ts:27`). The page context therefore carries no flag for unsaved work; the builder reads the saved version.
- The carrier. The browser already sends a text the model reads (`executionText`) and the person's words in `metadata.display_content` (`web/packages/agenta-chat/src/hooks/useServerSessionInputs.ts:446-452`; `outboundUserParts` in `web/packages/agenta-chat/src/assets/displayContent.ts:48-59`). The page context uses this path: the text the model reads is the context line plus the words. The line format (prefix, version, fields) is a frontend contract, PROPOSED, fixed in task 8.1 (shared contract SC5).
- Rebuild after a reload: the history rebuild restores `display_content` into the message metadata and keeps the stored full text as the text part (`web/packages/agenta-chat/src/assets/transcriptToMessages.ts:460-463, 898`). The chip parser reads the part of the stored text before the person's words. A message with no line shows no chip.
- Approval resume after a reload: the snapshot lives in browser memory; after a reload, the resumed run reads the history, and the stored text of the original message still holds the line. Not verified: that a resume rebuilds the model input from the stored history; task 8.1 checks it.
- One atom, `pageContextAtom`, holds the value. The page writes it. The chip and the send function read it (design.md D16). No prop carries it into the builder, so a session switch re-renders only the chip.

## Which rule won

- Context on every message and a visible chip (contradiction 5). BEHAVIOR 9.4 and 9.6 send the context with every message and show the chip on sent messages. The 18 November OpenSpec and the prototype sent it only with the first message as hidden context, and the visible message held only the user's words. BEHAVIOR won for when it is sent. The rule "the message bubble shows only the words the user typed" is kept from the older spec; `display_content` holds the words and the line goes only to the model.
- The chip on a sent message after a reload. BEHAVIOR 9.6 wants it. The stored message text holds the context line, so the browser rebuilds the chip after a reload.
- The session part carries the session and the version it runs on (BEHAVIOR 9.2). The Sessions and Analytics parts carry the active filters. The builder reads them with the read-session and read-traces tools (BEHAVIOR 9.8).
- The canvas text "Ticket triage" in the example of BEHAVIOR 9.2 is the old skill name (contradiction 14). The skill has one name, its slug, for example "ticket-triage" (BEHAVIOR 10.1).
- "The chip comes back after navigation" is not in BEHAVIOR. BEHAVIOR 9.4 says the context follows navigation. PROPOSED.

## Today's behavior

- Nothing of the page context exists on `origin/main` (5d783fec).
- The client sends messages as AI SDK `UIMessage` objects under `data.inputs.messages` (`web/packages/agenta-playground/src/state/execution/agentRequest.ts:448-453`). The one user-message metadata key it sets is `display_content`, set only when the message has an `executionText` (`web/packages/agenta-chat/src/hooks/useServerSessionInputs.ts:446-452`). A full search of every send path was not done; "no other key" is not verified beyond these files.
- The SDK keeps only `display_content` from the metadata of a user message (`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:67-72`; `Message.display_content` in `sdks/python/agenta/sdk/agents/dtos.py:677`).
- The runner persists only the text, the attachments and `display_content` of a user message (`services/runner/src/server.ts:1132-1142`). So a separate metadata field would be lost after a reload; the context line in the text is kept. The history reads `display_content` back in `web/packages/agenta-chat/src/assets/transcriptToMessages.ts:460-461` and `:898`.
- The session screen knows the session name and the revision it runs on; the Sessions page and Analytics hold their filter state in their own atoms (agent-sidebar-pages capability, the locked pages keep their own filter state). Not verified: the exact atoms the page part reads; the context parts milestone (section 44) names them.
- The prototype in the private development copy sends a hidden text line only before the first message ("Context: I am on the playground page of the agent …"). This spec keeps a text line, sends it with every message, gives it a fixed format and hides it with `display_content`.
- The agent tools are in PR 7409. They read saved revisions only. Each tool checks the rights of the caller (BEHAVIOR 9.8; the ownership tests of PR 7409). No tool reads a session or traces today.

## Backend work

None in this program. The SDK keeps `display_content` (`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:67-72`) and the runner persists it with the text (`services/runner/src/server.ts:1132-1142`), so the context line needs no API, SDK, runner or record change. What the builder agent work provides (builder-backend capability):
- The read-session and read-traces tools (tasks 32.1 to 32.3) read what the session and filter parts name, with the rights of the person.
- The builder instructions (PR 8345, task 28.1) read the context line and say what the builder cannot see (a refused read).

## Other places

The builder page (builder-page capability) uses the same chip, but its context is the agent of the open agent pane or the agent the user attached with "Improve an agent" (BEHAVIOR 9.7, design.md D13).

## States described but not drawn

The chip removed with "Add this page as context", a sent message with its chip after a reload, a message with no context line, the chip on Configuration, on the Sessions page and on Analytics, and the chip while the session name loads. The canvas draws only the chip on a session (S07, S08, S03): "Support triage · Charged twice for March".

## Text

- From the canvas, new: "The builder sees this", "Remove the context", the chip pattern "{{agent}} · {{item}}".
- Not drawn, from BEHAVIOR 9.5, not confirmed: "Add this page as context".
- Not drawn and not written: the chip label on Configuration with no open item (PROPOSED: "{{agent}} · Configuration"). Listed for Mahmoud.
- From the canvas, new: the session chip "{{agent}} · {{session name}}" ("Support triage · Charged twice for March", S07, S08, S03).
- Not drawn and not written: the chip labels on the Sessions page and Analytics (PROPOSED: "{{agent}} · Sessions", "{{agent}} · Analytics") and the hover line that lists the filters. Listed for Mahmoud.

## Milestones

- Agent and configuration parts, send time, snapshot: task 8.1 (first builder edit) and task 24.3 (builder panel).
- Session, Sessions and Analytics parts, the chip after a reload: section 44 (page context parts), after section 32 (read tools, builder agent work) merged.
