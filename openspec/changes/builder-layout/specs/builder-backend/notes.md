# builder-backend: notes for implementers

These notes belong to `spec.md` in this folder. They hold the words the requirements use, today's behavior on `origin/main` with `path:line`, what the frontend reads from the builder agent work, states that are described but not drawn, and the text. They are not part of the requirements.

This capability describes inputs. The builder layout program writes no backend code. Everything below that runs on the server is provided by the builder agent work (owned by the builder architecture session, tasks.md sections 9 and 30 to 35). The program's frontend milestones that need it wait for it.

## Words used in this file

- **Builder**: the platform agent with the slug `__ag__builder`, defined in the static workflow catalog. It has no database row. Its ids are stable UUIDv5 values derived from the slug.
- **Builder chat**: a session of the builder. The interface says "chat"; the code and the API say "session".
- **Builder agent work**: the builder PR stack and the builder tools that the builder architecture session builds and merges into the program base. It is a dependency of this program, not a milestone of it.
- **Test run**: a run of another agent that the builder starts with its run tool, to try a change. The started session has the origin `builder`.
- **User step**: a step only the person can do (sign in to an app, paste a secret). The builder asks for it with `request_connection` or `request_secret`, and the card holds the step.
- **Builder stack**: the four open pull requests that add the builder: 8341 (refuse configurations the runtime cannot run), 7409 (the tools `list_agents`, `read_agent_config`, `create_agent`, `edit_agent_config` and their approval cards), 8345 (the catalog entry and the learning skill) and 8346 (the builder's learning drive).
- **Session origin**: the value that says who started a session. It is stored as the reserved tag `ag.origin` on the session row and read back as the field `origin`. The value `builder` marks a session that a builder tool started in another agent (section "Session origin builder").
- **Page context**: the ids of the page the user is on. The browser sends it as one context line in the text the model reads, and keeps the person's own words in `metadata.display_content` (page-context capability; design.md D13). No backend reads a separate field.
- **Server preview**: old and new value per changed path that the server computes for a waiting `edit_agent_config` call, with no save (DECIDED, design.md D14).
- **Choice form**: the `request_input` card that the builder uses for "Decisions for you": one single choice per decision, the recommended option first, and one free-text field.
- **Role of a field**: what a field is. **Data** is input that a model or a person reads to do the work. **Routing** selects which record, list or place something belongs to. **Metadata** describes where something came from or how to show it.

## Field table (role and owner)

| Field | Where | Role | Written by | Read by |
|---|---|---|---|---|
| page context line | the text of a user message that the model reads; the person's words in `metadata.display_content` | data (ids and names for the builder) and metadata (the chip) | frontend at send time, snapshotted when queued | the builder model; the chip of a sent message, rebuilt from the stored text |
| `revision {id, version}` | result of `edit_agent_config` and `create_agent` | data (the new revision) | builder tools (PR 7409) | change card result row, builder page agent pane, cache clear |
| `base_revision_id` | input of `edit_agent_config`; result of the tools | data (the base to send with an edit) | builder model (input); builder tools (result: the base for the next edit) | change-set engine, builder model |
| server preview (field name not fixed) | approval payload of `edit_agent_config` | data (old and new value per changed path) | the builder agent work, when the gate opens | change card host |
| `request_input` answers | interaction record (existing) | data | person | builder model |
| `origin: "builder"` (`SessionOrigin.builder`, tag `ag.origin`) | session started by a builder tool | metadata (who started the session) | the builder agent work, only in the run tool path (task 31.1) | sidebar spark, Sessions filter |
| `ag.builder.session_id` (decoded as a builder link on the session) | session started by a builder tool | routing (the "open the builder chat" link) | the builder agent work, with the origin (task 30.1) | session header, Sessions page, test tab |
| `risks[]` with `kind` in `cost`, `breakage`, `fewer_approvals`, `data_egress` | server preview | data | the builder agent work, when the gate opens (tasks 9.4, 35.x) | change card warning lines |

The page-context capability owns the format of the context line. The interface review (task 1.4) confirms the names or renames them in every file.

## Today's behavior (origin/main 5d783fec, v0.129.0)

- `SessionOrigin` has only `manual` and `trigger` (`api/oss/src/core/sessions/types.py:49-51`). The trigger attribution model is `SessionTriggerAttribution` (`types.py:59-62`), the template for a builder attribution.
- The origin is the reserved tag `ag.origin` (`api/oss/src/dbs/postgres/sessions/streams/mappings.py:30`). Only `trigger_attribution_tags` writes it (`mappings.py:72-79`), at the insert in `dao.py:345`. Reads decode it in `decode_session_attribution` (`mappings.py:101-135`); a missing tag reads as "manual" (`mappings.py:111-115`). All `ag.` tags are stripped from client reads (`mappings.py:83-98`). The query filter is in `api/oss/src/dbs/postgres/sessions/streams/dao.py:517-537`. The DTO field is `origin` (`api/oss/src/core/sessions/streams/dtos.py:93`); request filters are `origins` and `exclude_origins` (`api/oss/src/apis/fastapi/sessions/models.py:73`, `:79`).
- The frontend reads the origin in `isAutomationSession` (`web/packages/agenta-sessions/src/row/sessionTrigger.ts:30-32`) and the sidebar row icon (`web/packages/agenta-navigation/src/dynamic/sessionsSource.ts:618`).
- A user message has one metadata key that the SDK keeps: `display_content` (`sdks/python/agenta/sdk/agents/adapters/vercel/messages.py:67-72`; `Message.display_content` in `sdks/python/agenta/sdk/agents/dtos.py:677`). The web app sends the text the model reads in the message parts and the person's words in `display_content` when a message has an `executionText` (`web/packages/agenta-chat/src/hooks/useServerSessionInputs.ts:446-452`; the body is built in `web/packages/agenta-chat/src/assets/displayContent.ts:48-59`, `outboundUserParts`). The page context uses this path, so no backend change is needed.
- The runner persists only the text, the attachments and `display_content` of a user message, and only on the turn that first introduced it (guard `tailIsFreshUserMessage`, `services/runner/src/server.ts:1132-1142`). The runner protocol types `display_content` on a message at `services/runner/src/protocol.ts:44` and `:436`. The history reconstruction reads it back in `web/packages/agenta-chat/src/assets/transcriptToMessages.ts:460-461` and writes it into the message metadata at `:898`; the stored text keeps the full text the model read, so the browser can rebuild the chip from it.
- The static client tools `request_connection` (`api/oss/src/core/workflows/static_catalog.py:127`) and `request_secret` (`static_catalog.py:196-201`) exist. The browser renders them with `ConnectRequestWidget` and `SecretRequestWidget` (`web/packages/agenta-entity-ui/src/clientTools/registry.tsx:57-69`).
- The API holds a model price map: litellm's map plus local additions (`api/oss/src/core/tracing/utils/pricing.py:72`), with `resolve_pricing_model` at `:146` that maps harness aliases such as `sonnet` (`pricing.py:19-23`).
- No builder tool runs another agent, reads a session or reads traces. No builder tool attaches a secret, connects a channel, creates an automation or changes access.
- The reserved tags are written in the stream insert mapping; the trigger tags come from `trigger_attribution_tags` (`api/oss/src/dbs/postgres/sessions/streams/mappings.py:72`). The reserved prefix is `ag.` (`mappings.py:69`).
- The server publishes `workflow-changed` only when an agent is renamed or moved (`api/oss/src/core/workflows/service.py:2265-2277`), not on a saved version. The program does not change this; the browser runs the latest-version check itself (session-screen capability).
- The change-set engine is `apply_change_set` (`api/oss/src/core/workflows/change_set.py:1894`), with the text edits in `apply_text_edits` (`change_set.py:1130`).
- `request_input` exists on main as a static client tool (`api/oss/src/core/workflows/static_catalog.py:253-327`). It supports single and multi choice with `oneOf` cards, `default`, `multiline` and a stepper. The build kit embeds it (`api/oss/src/core/workflows/build_kit.py:29`, `:64-70`). The web form is `web/packages/agenta-chat/src/components/ElicitationDock.tsx`.
- Static agents have stable ids (`static_catalog.py:437-452`).

## What the builder stack holds (read with `gh pr diff`, 19 November 2026)

- PR 8345, `api/oss/src/core/workflows/builder_agent.py` (branch `feat/builder-agent-catalog`): `BUILDER_AGENT_TOOLS` at lines 27-39 lists the platform ops with `create_agent` and `edit_agent_config` on "ask" and the reads on "allow". It has no `request_input`. The tools are built as `{"type": "platform", ...}` entries at lines 212-215.
- PR 7409, `api/oss/src/core/tools/platform_handlers.py` (same branch): `edit_agent_config` returns `status`, `agent`, `version`, `base_revision_id`, `message`, `warnings` (lines 1736-1749). `create_agent` returns `status: "created"`, `agent`, `visibility`, `base_revision_id`, `message`, `warnings` (lines 1925-1936). In these results `base_revision_id` is the id of the NEW revision, while in the input it is the revision the edit starts from. One name has two meanings. Before PR 7409 merges, the results return `revision: {id, version}` for the new revision (task 9.3; owner: the builder architecture session), and `base_revision_id` keeps one meaning. The agent summary is `name`, `id`, `slug` and `url` when the deployment can build one (lines 1322-1337). Status values seen: "committed", "no_change", "created".
- PR 7409 adds `wrote_other_agent_revision` to `PlatformHandlerResult` and clears the caches for it, but emits no stream event (`api/oss/src/apis/fastapi/tools/router.py`, hunk at line 1718 of the PR; `api/oss/src/core/tools/dtos.py`, hunk at line 518). So the frontend reads the tool result, and runs the latest-version check when a `committed` result arrives.
- PR 7409 writes the commit message clause "by agent ..., session ..." for builder writes (`_attribution`, `platform_handlers.py:1340-1380`). It is text, not a field.
- PR 7409 adds the approval describers `describeEditAgentConfig` and `describeCreateAgent` (`web/packages/agenta-chat/src/model/approvalDescribers/describeAgentChanges.ts`). They show only the new operations, not the old values.
- PR 8346 creates the learning drive at the first run and lets the files pane read static revisions through `POST /workflows/revisions/retrieve`.

## What the builder agent work provides, and its scope

| Input | Scope | Task |
|---|---|---|
| Rebase and retarget the builder stack (bases `release/v0.128.14` and `feat/drive-sharing-web` are stale) | medium | 9.1, 9.6 |
| PR 8341 Medium correctness finding (500 on some malformed values) | small | 9.2 |
| Tool results `revision: {id, version}` in PR 7409 | small | 9.3 |
| Server preview on the approval payload (DECIDED) | medium | 9.4 |
| Add `request_input` to `BUILDER_AGENT_TOOLS` in PR 8345 | small | 9.5 |
| Port the optimized instructions (they need a bench run), with the behaviors and optimization session | medium | 28.1 |
| Bench for `__ag__builder`: static slug mode and answers to approvals (bench session) | medium | 29.1 |
| Session origin `builder`: enum value, tag `ag.builder.session_id`, decode, `origins` filter, frontend session type | small | 30.1 to 30.3 |
| Run tool for another agent (test run): start a session as the person, write origin and link, stream progress, return the session id | medium | 31.1 to 31.3 |
| `read_session` and `read_traces` tools (PROPOSED names) with the person's rights and a bounded result | medium | 32.1 to 32.3 |
| `request_connection` and `request_secret` in `BUILDER_AGENT_TOOLS`; the results reach the builder | small | 33.1, 33.2 |
| Tools for a secret attach, a channel, an automation and access, each behind an approval | medium | 34.1 to 34.4 |
| Risk data on the preview: price ratio, skill text scan, MCP tool count | small | 35.1 to 35.3 |
| Builder instructions that read the page context line | small | 28.1 |
| Run a static agent from `/m`: not verified that the run route and `POST /sessions/query` accept the static id | small to check | 9.6 |
| How a session stores a reference to a static agent with no database row: not verified (design.md D12) | small to check | 9.6 |

Not needed: a server tag that links a builder chat to its agent (the browser keeps the link, builder-panel capability), a `workflow-changed` publish on a saved version (the browser runs the latest-version check, session-screen capability), a stored page context field (the context line in the stored text is enough, page-context capability).

## Naming notes

- `ag.builder.session_id` follows the reserved tag pattern `ag.<subject>.<field>` (`ag.trigger.id`).
- `revision: {id, version}` in a result removes the second meaning of `base_revision_id`. `version` is a string on the wire.

## States described but not drawn

- The "Decisions for you" form in a builder chat is not on the canvas. It uses today's elicitation form.

## Text

- No user-facing text in this capability. "Started by the builder" belongs to the agent-sidebar-pages capability.

## Session origin builder (tasks 30.1 to 30.3, builder agent work)

- `SessionOrigin` gets `builder` (`api/oss/src/core/sessions/types.py:49-51`). The value names one agent; `manual` and `trigger` name a kind of starter. If a second agent can ever start sessions, a kind `agent` with the agent's identity in attribution tags is the general form. The program uses `builder`.
- The attribution follows `SessionTriggerAttribution` (`types.py:59-62`): a builder attribution holds the builder chat id. The insert writes `ag.origin` "builder" and `ag.builder.session_id` next to `trigger_attribution_tags` (`api/oss/src/dbs/postgres/sessions/streams/mappings.py:72-79`); `decode_session_attribution` (`mappings.py:101-135`) reads them back; the strip of `ag.` keys (`mappings.py:83-98`) stays.
- The `origins` filter already exists (`api/oss/src/apis/fastapi/sessions/models.py:73`; `dao.py:517-537`); it takes the new value.
- Frontend: the session type gains `origin: "builder"` and the builder link. `isAutomationSession` (`web/packages/agenta-sessions/src/row/sessionTrigger.ts:30-32`) must not treat `builder` as an automation.
- Until the run tool merges (section 31), nothing writes the value.

## Builder tools (sections 31 to 35, builder agent work)

- Test run (section 31). PROPOSED name `run_agent`. Input: the agent (id or slug), the input text, optional test set rows. It starts a session of that agent on the invoke path with the person as the caller, writes the origin and the link, returns the session id at once, and streams the state to the builder chat. Open: how the tool starts a session of another agent as the person (OPEN-QUESTIONS 3.27). Size medium.
- Read a session and read traces (section 32). PROPOSED names `read_session`, `read_traces`. Both use the person's rights. The session read returns the last turns and a cursor (no whole history). The traces read takes the filters that the `sessions` and `analytics` page parts carry. The permission the traces tool checks is open (OPEN-QUESTIONS 3.27). Size medium.
- User steps (section 33). Add `request_connection` and `request_secret` to `BUILDER_AGENT_TOOLS` (PR 8345 file `api/oss/src/core/workflows/builder_agent.py`, lines 27-39 on that branch), as task 9.5 does for `request_input`. The builder instructions say when to ask. Size small.
- Changes that apply at once (section 34). Four tools behind "ask": secret attach (through the agent configuration, so it saves a version), channel connect (the browser runs the production install step), automation create (the production trigger routes), access change (the production visibility route). Each returns a typed result. Size medium.
- Risk data (section 35). On the preview of task 9.4: `cost` from `pricing.py` (ratio of the input token prices of the two models; no risk when one price is missing; coverage of harness model ids is OPEN-QUESTIONS 3.28); `breakage` from a plain text search of the attached skills' files for the name and slug of a removed integration; the tool count of a new MCP server from the existing discovery read, with a short timeout. Size small.

## Open questions

- 3.27: how the test run tool starts a session of another agent as the person, and which permission the traces tool checks (builder architecture session, before tasks 31.1 and 32.2).
- 3.28: whether the price map covers the model ids that harnesses send, for the cost line (builder architecture session, before task 35.1).
