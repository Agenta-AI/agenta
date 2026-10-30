# Tasks

Prerequisites: none for the project scope. The reason `not_shared` ships with M5; `needs_your_account` ships with M7. Parentheses name the spec requirement.

## 1. Check

- [ ] 1.1 Server function that reads every reference of a revision or draft and returns requirements for the seven kinds. (One server check returns requirements)
- [ ] 1.2 `POST /workflows/revisions/requirements/query`, view permission, hidden labels for items the caller cannot see; Fern client. (Query route)

## 2. Tag and banner

- [ ] 2.1 `/m` calls the query route in parallel with its other requests when it opens an agent; requery after draft edits (debounced) and after a commit. (The check adds no wait)
- [ ] 2.2 Tag and reason line on every item card in `AgentTemplateControl`; remove the eight old states for this problem. (Needs setup in the editor and the chat)
- [ ] 2.3 Model banner in `@agenta/chat`, composer block for model items only; the approved model-unavailable design. (Needs setup in the editor and the chat)

## 3. Fix sheet

- [ ] 3.1 Replace sheet (pick, connect, sign in, remove) and Set up sheet; one revision per fix. (One fix for every use of an item)

## 4. Run

- [ ] 4.1 Services agent handler: run every resolve step, collect failures, MCP existence and sign-in check sent concurrently, model items fail with `agent_needs_setup`, other items left out, old codes kept as `detail.code`. (Only model items block a run; The check adds no wait)
- [ ] 4.2 Chat shows `agent_needs_setup` with the model banner. (Needs setup in the editor and the chat)

## 5. Automations and channels

- [ ] 5.1 Delivery state `skipped` with reason `agent_needs_setup`, no retry, schedule stays on; automation row. (Automations skip only for model items)
- [ ] 5.2 Turn-on refusal for schedules, triggers and channels, checked as the automation's principal. (Automations skip only for model items)
- [ ] 5.3 No change to channel replies; test today's reply. (Channels keep today's reply)

## 6. Copy

- [ ] 6.1 Get owner approval for every new string except the approved ones ("Needs setup", "No longer available", "The model needs setup before this agent can run."). Draft strings are on the needs-setup design page.

## 7. QA matrix

OSS and EE. Real-stack tests. Every local QA also proves that self-managed agents still work (subscription sidecar, with and without a slug).

| Boundary | Test |
| --- | --- |
| Check | Each kind and reason; one requirement for many paths; ready agent returns an empty list. |
| No added wait | Opening an agent: the query starts with the page's other requests. Run start: statement and request counts equal today's, plus one concurrent MCP request. |
| Run | Model key, subscription login and model block before the sandbox; secret, MCP server, MCP sign-in and connected app are left out with no new message. |
| Save | Save succeeds with every kind missing. |
| Fix | One revision writes every path; a sign-in changes no revision; Remove is not offered for model items. |
| Automations | Model item: one `skipped` delivery, no retry, schedule stays on. Other items: the run happens. Turn-on refused only for a model item. |
| Channels | Model item: today's reply. Other items: answer, no extra message. |
| Templates | Skipped optional slot shows no tag. |
| Privacy | A requirement for another person's item shows "Another person's account" and no slug. |
