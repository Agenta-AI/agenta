# change-cards: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, the other places that mount the changed components, backend work, states that are described but not drawn, and the text. They are not part of the requirements.

## Words used in this file

- **Change card**: the card a chat shows when an agent asks for approval before a tool call that changes something. In the builder chat it shows a change the builder wants to make to an agent.
- **Proposal**: one tool call that waits for approval. A versioned proposal is one call of `edit_agent_config` (or `commit_revision` in an agent's own chat) with up to 64 operations, one agent and one base revision.
- **Operation**: one change inside a call, for example "set the instructions" or "add a skill". It has the shape `{operation, target, value | edits}` (design.md D14).
- **Path**: where the change lands in Configuration, for example "Instructions › AGENTS.md". The describer returns it as a list of segments.
- **Detail**: the middle part of a card that shows what changes.
- **Footer note**: the short line at the left of the card footer that says what the main button does.
- **Warning line**: a yellow line in the detail that names a risk.
- **Result row**: the one line a call becomes after the user answers.
- **Base version**: the version of the revision the builder read before it proposed the change (`base_revision_id` in the call input).
- **Server preview**: old and new value per changed path, computed on the server and attached to the approval payload (DECIDED, design.md D14).

## Card data (design.md D14)

```ts
interface ApprovalChange {
    title: string
    path: string[]                       // segments; the card joins them with "›"
    detail:
        | {kind: "text_diff"; old?: string; new: string; fragmentsOnly: boolean}
        | {kind: "value_change"; old?: unknown; new: unknown}
        | {kind: "item"; change: "added" | "removed"; name: string; description?: string; files?: string[]; tools?: {count: number; asks: boolean}}
        | {kind: "user_step"; step: "connect" | "secret"; reason: string; abilities?: string[]; variable?: string}
    effect: "version" | "immediate"
    risks: {kind: "fewer_approvals" | "data_egress" | "cost" | "breakage"; message: string}[]
}
// ApprovalPreview gets: changes?: ApprovalChange[]
```

- The describer stays pure and synchronous. Old values are data that the card host passes back to it, as `sourceKey` and `appName` work today (`web/packages/agenta-chat/src/skin/types.ts:30-41`).
- The "vN" number is not describer output. The host reads the base version from the call and the latest version from the latest-version query.
- One function derives the card state from the interaction status and the result `status`. There is no parallel state enum.
- `effect: "version"` is a change inside the agent version. `effect: "immediate"` is a change outside it (a channel, an automation, access); it never joins the "Saved together" group. A user step (`detail.kind: "user_step"`) goes to the group "Needs you first".
- The shapes `tools` and `user_step` are PROPOSED; the naming review checks them with the rest of the contract (SC6).

## Old values: the server preview

- DECIDED (task 9.4): when the approval gate of `edit_agent_config` opens, the server runs `apply_change_set` (`api/oss/src/core/workflows/change_set.py:1894`) on the base revision with the proposed operations, saves nothing, and attaches a bounded preview to the approval payload. Owner: the builder architecture session, in its PR stack.
- Why on the server: the change-set engine has anchor matching, overlap rules, text normalization, match modes and sequential operations, where a later operation can change what an earlier one created (`apply_text_edits`, `change_set.py:1130`). A copy in the browser would drift, and a wrong approval preview is a correctness problem. No patch interpreter runs in the browser.
- If the server cannot compute the preview for one call (for example the change set does not apply to the base), that card shows the proposed values and text fragments with a label and no old value. The card never guesses an old value. The label text is not written; listed for Mahmoud.

## Which rule won

- Buttons and what Approve does (contradiction 6). BEHAVIOR 10.3, the canvas C01 and S03 use "Deny" and "Approve" and save a version. Older documents used "Apply" and "Dismiss" with an unsaved draft and Undo. BEHAVIOR and the canvas won.
- Applying on the builder page (contradiction 7). BEHAVIOR 1.10 let the builder apply changes itself on its own page. The C01 rule "one request is one card and one approval" and the product builder (permission `ask`, fixed per agent) do not support that. The program shape recommends one rule: always a card (choice 3, how the builder applies changes on its page, option A). This file follows it.
- Grouped card and transactions. The canvas draws one grouped card with one "Approve all". One call is all or nothing; several calls are not one transaction. Two approved calls on v4 can give one saved v5 and one conflict. So a grouped card with several calls shows one group and one result row per call.
- Version number. The canvas implies a number that follows the latest version. The card shows the static "Saves as v{base + 1}" and shows the conflict state before the click when the latest version is newer than the base (design.md D14). A live number needs a subscription per waiting card, and the conflict on approve already makes a stale number safe.
- Result row text. The canvas uses "Waiting for the agent" and "Your answer is saved.". Production uses "Answered, waiting for the agent" and "The answer is saved. Waiting for the agent’s next update…" (`web/packages/agenta-i18n/locales/en/chat.approvalCard.json:5-6`). The canvas won.
- "Revert" on a saved row reverts to the version before it. PROPOSED.
- "Try again" on a conflict. Not specified. PROPOSED: it sends the builder a request to read again; the exact mechanism (a user message with fixed text, or a tool result the builder reads) is open. A fixed user message would be new text.

## Today's behavior on `origin/main` (5d783fec)

- The card is `web/packages/agenta-chat/src/components/ApprovalCard.tsx`, shared by the old app and `/m`. Its header comment says the card shows "no payload, no diff, and no digest" (lines 1 to 10), and the describer type says the same (`web/packages/agenta-chat/src/skin/types.ts:30-41`). A describer returns one `sentence` and `items` with `title` and `detail` (`types.ts:24-41`).
- The card shows the eyebrow "Needs your approval", the sentence, a toggle "See what changes ({{count}})", "Always auto-approve", "Redirect", "Deny" and "Approve" (texts in `chat.approvalCard.json`). Several gates of one turn are batched and answered as a whole with "Deny all" and "Approve all" (`ApprovalCard.tsx:144-183`, labels at `:359` and `:378`).
- Read-only mode: `readOnly` and `readOnlyNote` drop every control and shortcut (`ApprovalCard.tsx:57-59`, `:171`, `:192`).
- Keyboard: Cmd or Ctrl+Enter approves, Escape denies, only for a card on screen, not while typing (`ApprovalCard.tsx:186-210`). `Alt+G` approves one gate (`web/mobile/src/features/chat/LiveConversation.tsx:855-871`). Foundation A scopes both to the focused conversation (design.md D6).
- `/m` mounts the card through `web/mobile/src/features/chat/ApprovalDock.tsx`, at the bottom of the conversation.
- Describers on main: `commit_revision` and `run_tool` (`web/packages/agenta-chat/src/model/approvalDescribers/index.ts`).
- The answer is the interaction `verdict` `"approved" | "denied"` (`api/oss/src/apis/fastapi/sessions/models.py:311-315`).
- The diff component of the version history is `ChangeSections` (`web/packages/agenta-entity-ui/src/changes/ChangeSections.tsx`; `HunkRows` at line 147, `SectionCard` at line 304). It is presentational and has its own export path. The card can reuse it.
- The server error for a stale base is "The workflow head changed. No revision was committed." (`api/oss/src/core/workflows/service.py:268,290`).

## The builder PR stack (not merged)

- PR 7409 adds the describers `describeEditAgentConfig` and `describeCreateAgent` and the settled-row summary (`web/packages/agenta-chat/src/model/approvalDescribers/describeAgentChanges.ts`). The sentence today is "Save {N} changes to the agent {agent}. Agenta saves this as a new version of that agent and does not deploy it." It shows no old values and no "vN".
- PR 7409 caps a call at 64 operations, all or nothing: `"maxItems": 64` with "If one fails, nothing is saved." (`sdks/python/agenta/sdk/agents/platform/op_catalog.py` in that PR).
- Tool result: before PR 7409 merges, `edit_agent_config` and `create_agent` return `revision: {id, version}` for the new revision, the same shape as `read_agent_config`, and `base_revision_id` keeps one meaning (the base to send with the next edit). Owner: the builder architecture session (task 9.3). On the PR branch today the result has a top-level `version` and uses `base_revision_id` for the new revision (`api/oss/src/core/tools/platform_handlers.py` in PR 7409). Refusal codes: `agent_not_found`, `agent_is_static`, `access_denied`, `create_conflict`. Approval defaults: `create_agent` and `edit_agent_config` are `ask`; reads are `allow` (PR 8345, `api/oss/src/core/workflows/builder_agent.py`).
- No stream frame announces a write to another agent. The UI reads the tool result to show "Saved as vN". When the tool result arrives, this browser runs the existing latest-version check, so open sessions of the changed agent learn of the save (design.md D7); the card only clears caches.

## What the cards read from the builder agent work

This work writes no backend code. The cards read what the builder agent work provides (builder architecture session; tasks.md "Depends on the builder agent work"), and each card waits for its part:

- Server preview on the approval payload (DECIDED, task 9.4).
- The tool result shape `revision: {id, version}` (task 9.3, builder architecture session).
- User steps (task 33, builder architecture session, small). `request_connection` and `request_secret` exist on `main` as static client tools (`api/oss/src/core/workflows/static_catalog.py:127`, `:201`). The browser renders them today with `ConnectRequestWidget` and `SecretRequestWidget` (`web/packages/agenta-entity-ui/src/clientTools/registry.tsx:57-69`). Task 33.1 adds both to the builder tool list; the card task 45 renders their parts as user-step cards and reuses the widgets' connect and vault logic. The value of a secret goes from the browser to the vault; the tool result carries only the name.
- Changes that apply at once (task 34, builder architecture session, medium): builder tools that create an automation, connect a channel and change the agent's access, each with approval `ask`. Each result carries the id of what it created or changed. The tool names are chosen in that milestone. Not verified: which existing service calls they wrap (the trigger service, the channel install, the agent sharing call).
- Risk data on the preview (task 35, builder architecture session, small): the server preview adds (1) the price ratio of the old and the new model from the price map the API already loads (`api/oss/src/core/tracing/utils/pricing.py:72`, `resolve_pricing_model` at `:146`, `price_tokens` at `:157`), (2) the skills of the agent whose text names a removed integration or MCP server (a plain text scan of the skill files on the base revision), and (3) the tool count of a new MCP server and whether its tools ask first. Not verified: whether every harness model id resolves to a price (OPEN-QUESTIONS 3.28).
- Card work: task 45 (user-step cards, waits for task 33), task 46 (groups and the cards that apply at once, waits for task 34), task 47 (cost and "stops working" lines, waits for task 35). Owner: the change card states session.
- The `create_agent` card is not drawn. PROPOSED: the same three parts, with the PR 7409 sentence as the detail. Its title is not written.
- A subagent card is not drawn. PROPOSED: the "added or removed item" form.
- The general warning text per risk kind is not written; listed for Mahmoud. The canvas lines ("The agent will close tickets without asking you.", "Ticket text will go to an outside server.", "Each session will cost more. The larger model is about 5 times the price.", "2 skills mention Gmail. They will stop working.") are examples for one agent.

## Other places that mount the changed parts

`ApprovalCard` renders in the `/m` approval dock and the old desktop dock (`web/oss/src/components/AgentChatSlice/components/ApprovalDock.tsx`, abandoned app). A contract change must keep the old app building or remove its use. `ChangeSections` also renders in the version history (`ChangesPane.tsx:14`).

## Open questions

- Keep "Always auto-approve" and "Redirect" in the agent's own chat? They are production features that the canvas does not draw. PROPOSED: keep both in the agent's own chat, hide "Always auto-approve" in the builder chat, because the builder's write permission is fixed to `ask`.
- What "Open the skill" opens on a card that waits: the proposed skill read only, or nothing until it is saved. The canvas does not say.
- A grouped card with two calls on the same base shows two groups "Saved together as v5", and only one can save. The text that tells them apart is not written; listed for Mahmoud.
- The grouped card on C01 shows "Later" after the row "Automation Daily summary". The canvas does not say what it means (a button that skips the change, or a state). PROPOSED: it is the per-row "Not now" of a change that applies at once. Mahmoud confirms.
- "Approve all" stays disabled while a "Needs you first" step is open (PROPOSED). The line that says which step to do first is not written.
- The "Not possible today" tag on four C01 cards is a design marker for the cards that needed new builder tools. It is not product text and does not show.

## States described but not drawn

The full diff view, the card of a call with no preview, the conflict state before the click, the row opened in a grouped card, the card with 64 changes, the grouped card with two calls, the answer that fails to send, the refused save, the person who may not edit the target agent, the `create_agent` card, the subagent card. The canvas draws 12 single cards, 1 grouped card and 5 result rows (C01), and the card in the panel (S03); every one is in scope. Also not drawn: the result rows of a user step (connected, "Not now") and of a change that applies at once (created, connected, shared), the sign-in that fails inside a card, the user-step card in a read-only chat.

## Text

- From the canvas board C01 and S03, new: "Saves as v{{version}}", "Saved as v{{version}}", "View full diff · {{count}} lines", "Open the skill", "can run as a program", "No longer available to the agent", "Remove", "{{count}} changes to {{agent}}", "Saved together as v{{version}}", "Open a row to see its details", "Waiting for the agent", "Your answer is saved.", "You denied this change", "Nothing was saved.", "Not saved", "Someone changed the agent after the builder read it.", "Try again", "Only the owner can approve", "You can read this chat.", "View", "Revert", "Revert to v{{version}}?", the change titles and paths quoted in `spec.md`.
- From the canvas board C01, user steps and changes outside versions, new: "Connect Stripe", "Needs you", "The agent needs Stripe to look up charges. Only you can sign in.", "It will be able to", "read charges and refunds", "The builder continues after you connect", "Not now", "Attach a secret", "The script needs a key for your billing API. Paste it here. The builder never sees the value.", "Environment variable", "Value", "Paste the secret", "Stored in the project vault", "Save & attach", "Connect a channel", "You asked for urgent tickets in Slack. Install the Agenta app in your workspace, then pick the channel.", "Channel", "Applies at once. Not part of a version.", "Add to Slack", "Add an automation", "Instruction", "It starts to run at once and each run costs money. It is not part of a version.", "Next run: tomorrow 09:00", "Create", "Change who can see the agent", "Visibility", "Private", "Shared with project", "Everyone in this project will see the agent and its sessions.", "Needs you first", "Not connected", "Connect", "Applies at once, not part of a version", "Later".
- From the canvas board C01, warning lines, new: "Each session will cost more. The larger model is about 5 times the price.", "2 skills mention Gmail. They will stop working.", "Tools", "12 tools, asks before each use", "The agent will close tickets without asking you.", "Ticket text will go to an outside server.".
- From production: "Deny", "Approve", "Deny all", "Approve all".
- The values in the examples (model names, tool counts) are sample data from the canvas, not text.
- Not written: the label of a card with no preview, the conflict state before the click, the general warning text per risk kind, the text that tells two groups on one base apart, the line that says which user step to do first, the result rows of user steps and of changes that apply at once.
- Not confirmed: none of these is in HANDOFF section 5. The text of the not-drawn states must be written and confirmed.
