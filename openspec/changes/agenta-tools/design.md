# Design

## Context

Line numbers refer to `origin/release/v0.121.2` at `f0a37cd746`.

### The build kit today

- **What it holds.** `DEFAULT_BUILD_KIT_OPS` (`api/oss/src/core/workflows/build_kit.py:33-58`) lists 21 platform tools, among them `get_current_session` (`:42`) and `rename_session` (`:43`). Three request cards and two skills are added with them (`:63-67`, `:104-135`).
- **Which runs get it.** The browser merges it into the run it is about to send (`web/packages/agenta-playground/src/state/execution/agentRequest.ts:332-345`). `/w` and `/m` share this request builder (`web/packages/agenta-chat/src/hooks/useAgentConversation.ts:415`). A loaded template's first run also gets it (`api/oss/src/core/agent_templates/loader.py:312-324`). No other run gets it: a Slack, Telegram or WhatsApp turn builds its request from the agent's bound references (`api/oss/src/tasks/asyncio/channels/inbox.py:1089-1108`), and a schedule or trigger fire builds its own (`api/oss/src/tasks/asyncio/triggers/dispatcher.py:224-250`).
- **Its controls.** The Advanced drawer has a "Build kit" panel (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useModelHarness.tsx:759-767`). It offers a kit-level choice (Allow all, Ask all, Allow reads, Deactivate, and Custom when rows differ) and, per tool, Allow, Ask or Deactivate (`BuildKitSection.tsx:25-52`). Rows are grouped into Write and Read-only from each tool's `read_only` flag. Its copy reads "Tools the assistant uses here. Choices stay with this agent across commits, in this browser. They do not change the published agent." (`BuildKitSection.tsx:85-89`).
- **Where its choices are saved.** In the browser, per agent, under the local storage key `agenta:playground:build-kit:agents` (`web/packages/agenta-entities/src/workflow/state/store.ts:1531-1536`). They never reach the saved agent or another browser.
- **How a choice becomes a run.** Every kit tool is added with `permission: "allow"` (`build_kit.py:104-113`). A per-tool Ask replaces it, and Deactivate removes the tool from the run (`build_kit.py:138-180`, and the browser twin in `buildKitOverlay.ts`).

### The channel tools today

- PR #7134 added one step to the SDK agent handler. `_with_channel_tools` (`sdks/python/agenta/sdk/agents/handler.py:167-195`) asks the API which channel tools the agent's bots allow and appends them to the run just before its tools are resolved (`:424-428`). A slow or failed check adds nothing. An entry already in the run with the same name wins (`:183-193`). The module calls itself a stand-in for an always-on kit (`sdks/python/agenta/sdk/agents/platform/channel_tools.py:1-7`).
- **Where their settings are saved.** Not in the agent configuration. The channel tools are added at run time, and the only settings are the bot's own: `can_post_outside_conversation` and `readable_space_keys` in `ChannelAgentToolSettings` (`api/oss/src/core/channels/dtos.py:392-402`). They are stored on the channel-agent row, the record that binds one bot to one agent (`ChannelAgentData.tools`, `dtos.py:405-408`). They are not versioned and apply only to runs through that bot.

### How a tool's permission works

- An author lists a platform tool in the agent's `tools` as `{"type": "platform", "op": "...", "permission": "allow" | "ask" | "deny"}` (`sdks/python/agenta/sdk/agents/tools/models.py:111`, `:448-463`).
- A tool's own permission wins over the agent-wide mode. With no permission, reads are allowed and writes ask under the default mode (`effective_permission`, `models.py:142-152`).
- `deny` does not remove the tool. The model still sees it, and the runner refuses each call (`services/runner/src/permission-plan.ts:61-81`). Removing a tool means not adding it.
- Two entries for the same platform tool fail the run (`sdks/python/agenta/sdk/agents/platform/platform_tools.py:108`).

### The tools in this change

Each tool below is in the op catalog (`sdks/python/agenta/sdk/agents/platform/op_catalog.py`) and in today's build kit.

| Tool | What it does | Catalog line | Read-only |
| --- | --- | ---: | --- |
| `get_current_session` | Get the link to this chat | 1865 | yes |
| `rename_session` | Rename this chat | 1885 | no |
| `rename_agent` | Rename the agent | 1899 | no |
| `create_schedule` | Add a schedule | 1961 | no |
| `create_subscription` | Add a trigger | 1973 | no |
| `remove_schedule` | Remove a schedule | 2030 | no |
| `remove_subscription` | Remove a trigger | 2038 | no |
| `list_schedules` | Check schedules | 1985 | yes |
| `list_subscriptions` | List triggers | 1993 | yes |
| `discover_triggers` | Find a trigger | 1953 | yes |
| `commit_revision` | Save changes | 1924 | no |
| `read_config` | Read the agent setup | 1522 | yes |
| `apply_skill_update` | Apply a skill update | 1849 | no |

Decision 1 covers `list_deliveries` (2001, read-only), `test_subscription` (2021, write), `check_skill_updates` (1841, read-only) and `search_skills` (1833, read-only).

### `get_current_session` today

- It takes no model arguments. The session ID is bound from the run (`op_catalog.py:1881`). It calls `POST /api/sessions/tools/current` (`api/oss/src/apis/fastapi/sessions/router.py:421-427`, handler `:570-600`), which checks the caller can view sessions (`:574-579`).
- It returns the session ID, name, and a link, or a reason there is none (`api/oss/src/apis/fastapi/sessions/utils.py:28-76`). The link is the classic playground tab: `/w/<ws>/p/<project>/apps/<agent>/playground?session_id=<id>` (`:59-75`). With no `workflow` reference on the session, it returns `agent_reference_missing` and no link (`:32-37`).
- **What opening it does.** The desktop gate sends a phone to `/m`, and a desktop browser to `/m` only when its Classic-mode cookie is off. A browser with no cookie stays on `/w` (`web/packages/agenta-shared/src/utils/mobileGate/index.ts:303-314`). In `/m`, a browser with Classic mode on is sent back to the classic tab when `?agent=` is present, and to the observability drawer otherwise (`:232-241`, `:350-352`). `/m` is the default app for everyone (`openspec/config.yaml`).
- **Who can open it.** Signed-in project members who can view sessions. Sessions are gated per project, not per person: the session list has no creator filter (`api/oss/src/core/sessions/dtos.py:39-61`), and both apps open any session ID in their URL and let the server check access.
- **Sessions from other surfaces.** Channel and automation runs carry a token signed for a real user, with the workspace in it: the linked sender or the agent's creator for channels (`inbox.py:198-219`), the automation's creator for fires (`dispatcher.py:250`), signed at `api/oss/src/core/workflows/service.py:3099` and read by the auth middleware (`api/oss/src/middlewares/auth.py:1150-1153`). So the tool call passes its checks. These sessions appear in the web session lists, which apply no origin filter by default (`web/mobile/src/features/sessions/sessionListPolicy.ts:4-7`). A channel agent can be bound by an `application` reference instead of `workflow` (`api/oss/src/core/channels/dtos.py:380-388`). Its sessions carry no `workflow` key, so today they get no link.

### Today and expected, by surface

| Surface | Today | Expected |
| --- | --- | --- |
| Playground, `/w` | Build kit tools only, including `get_current_session`. The link opens the classic tab. | Build kit tools plus the Agenta tools that are on. The link opens `/m`, and a Classic-mode browser is sent to the classic tab. |
| Playground, `/m` | Same build kit. The link points at `/w`, and the person returns to `/m` only on a phone or with Classic mode off. | Same as `/w`. The link opens the `/m` session page directly. |
| API | Only tools the author listed by hand. | The author's tools plus the Agenta tools that are on. |
| Slack | Only the author's tools and the channel tools. Asked for the session link, the agent says it has no access. | Also the Agenta tools that are on. By default it can give the link and name the session. |
| Telegram | Same as Slack. | Same as Slack. |
| WhatsApp | Same as Slack. | Same as Slack. The person chatting is usually a customer with no Agenta access (decision 7). |
| Automations | Only the author's tools and the channel tools. | Also the Agenta tools that are on. |

## Goals / Non-Goals

**Goals:** Tools the agent needs in production reach every run. Each is on or off per agent, with Allow or Ask, saved with the agent's version. The session link opens in the default app and stays private.

**Non-Goals:** Changing what any tool does. Moving the channel tools. Changing the build kit's tools, defaults, controls, or where its choices are saved. Public session links. Per-surface or per-environment settings. Filtering tools by run kind (test, evaluation, automation) (see Risks).

## Decisions

### Decided by Mahmoud: the defaults

`get_current_session` and `rename_session` are on, with Allow. Every other Agenta tool is off, including `rename_agent`, `commit_revision` and `read_config`. "Rename this chat" and "Rename session" are the same tool, `rename_session`.

### 1. Which borderline tools join the Agenta tools

**Decision:** `list_deliveries`, `test_subscription` and `check_skill_updates` join, off by default. `search_skills` stays in the build kit only.

| Option | Trade-off |
| --- | --- |
| **Add the three that pair with a tool already in the section** | `list_deliveries` and `test_subscription` complete the trigger tools: an agent that adds a trigger in Slack can check it fired. `check_skill_updates` is how the agent learns there is an update for `apply_skill_update` to apply. All are off by default, so nothing changes until an author turns them on. |
| Add all four | `search_skills` finds new skills to install, which is building work. It adds a row nobody needs outside the playground. |
| Add none | The section stays at 13 rows, but an author who turns on `apply_skill_update` has no way for the agent to know an update exists. |

### 2. Where the Agenta tools choices are saved

**Decision:** In the agent's configuration, as a new optional block.

| Option | Trade-off |
| --- | --- |
| **A. In the agent's configuration (the version)** | Saved with each version, so the tested version is the version that ships, and a rollback restores the choices. The handler reads it from the configuration it already has, with no extra call. A playground run uses the unsaved choices, like any other draft edit, for any tool the build kit does not already add (decision 3). Turning a tool on for production needs a commit, like every other production setting. |
| B. Next to the channel settings, on the channel-agent row | This is where the bot's channel settings live, but that row exists only per bot. Playground, API and automation runs have no bot, so they would have no settings. An agent with two bots would have two answers. |
| C. On the agent, outside its versions | A change applies at once everywhere, with no commit. But it is not versioned, a switch flipped while testing changes production immediately, and every run needs one more lookup. |

The build kit choices stay in the browser. They are for the person building the agent, and they never reach production, so the browser remains the right place for them.

**The shape.** A map from tool name to its setting, under the agent section of the configuration:

```json
{
  "agent": {
    "tools": [
      {"type": "platform", "op": "list_schedules", "permission": "allow"}
    ],
    "agenta_tools": {
      "create_schedule": "ask",
      "rename_session": "off"
    }
  }
}
```

- `allow`: the tool is added and runs without asking.
- `ask`: the tool is added and asks before each call.
- `off`: the tool is not added. The model never sees it.
- **Not in the map**: the tool's default applies. A missing block means every default. So an agent saved before this change gets `get_current_session` and `rename_session`, and nothing else.
- The UI writes a key only when the author's choice differs from the default, so an agent that never touched a tool follows a later change to that tool's default.
- An unknown tool name is ignored, so a later rename in the kit does not break a saved agent.

**How this differs from the author's own `tools` entry.** An entry in `tools` with `permission: "deny"` keeps the tool in front of the model and refuses each call. `off` in `agenta_tools` removes the tool. An entry in `tools` for an Agenta tool is the author's hand-written choice and wins over `agenta_tools` (decision 3).

### 3. When a tool is on in more than one place

**Decision:** The entry already in the run wins. Nothing is added twice.

A tool can reach a run from three places: the author's own `tools` list, the build kit (playground runs only), and the Agenta tools step in the handler. The handler runs last, so it sees what the other two put in.

| Option | Trade-off |
| --- | --- |
| **The entry already in the run wins** | One rule, the same one the channel tools use (`handler.py:183-193`). In the playground, the build kit's choice applies to a tool that is in both, which is the setting the person building sees next to the chat. Outside the playground, the author's own entry wins, then `agenta_tools`. A run can never fail with a duplicate. |
| The stricter choice wins (Ask over Allow) | Safer when the two disagree, but the handler cannot tell a build kit entry from an author's entry, so it would also override the author. |
| One home per tool: remove every Agenta tool from the build kit | No overlap to explain. But it changes the build kit, and `commit_revision` and `read_config` are off by default in Agenta tools, so building in the playground would stop working until the author turns them on. |

The build kit keeps all its tools, including `get_current_session` and `rename_session` (Mahmoud: "the build kit should not be changed"). Every Agenta tool is also in the build kit today, so in a playground run the build kit's choice applies to all of them, and the Agenta tools choices matter only outside the playground: the API, Slack, Telegram, WhatsApp and automations. For example, turning `rename_session` off in Agenta tools stops Slack runs from naming their sessions, but a playground run still has it if the build kit has it on. The UI marks each Agenta tools row that is also in the build kit: "In the playground, the Build kit setting applies."

### 4. How the tools reach every run

**Decision:** A step in the SDK agent handler, next to the channel tools step.

| Option | Trade-off |
| --- | --- |
| **The handler step, before tools are resolved** | Every run passes through it: `/w`, `/m`, the API, channels, automations, approval resumes. It needs no browser change, reads the choices from the configuration it already has, and needs no network call. |
| On the API, when it loads a version for a run | Misses the playground, which sends its configuration inline. Two code paths to keep in step. |
| Write the tools into each agent's `tools` list | Every version would need rewriting, and the tools would look like the author's own choices. |

The step adds each tool whose setting is `allow` or `ask`, with that permission, unless the run already has an entry for it. It adds `get_current_session` and `rename_session` only when the run has a session ID, which the service normally mints before the handler runs (`sdks/python/agenta/sdk/agents/platform/session_context.py:321-324`). It adds nothing when the handler has no Agenta API address. The channel tools step stays as it is.

### 5. The settings UI

**Decision:** An "Agenta tools" section beside "Build kit" in the Advanced drawer, with the same controls, in `/w` and `/m`.

- **Agenta tools** comes first, because it affects production. Copy: "Tools your agent can use wherever it runs: the playground, the API, Slack, Telegram, WhatsApp and automations. Saved with the agent." A draft for Mahmoud to approve.
- **Build kit** keeps its tools and controls. New copy: "Tools the assistant uses only while you build in the playground. They are not available in Slack, Telegram, WhatsApp, automations or the API. Saved in this browser." A draft for Mahmoud to approve.
- Both have the kit-level choice (Allow all, Allow reads, Ask all, Deactivate, Custom) and the per-tool choice (Allow, Ask, Deactivate), with Write and Read-only groups.
- **Read-only and write tools.** Both groups offer the same three choices. The difference is the kit-level choice "Allow reads", which sets read-only tools to Allow and write tools to Ask. Write tools are listed first, because they change something.
- Changing an Agenta tools choice edits the draft and marks it unsaved. A commit saves it. A Build kit choice saves in the browser at once, as today.

```
Advanced
+-- Agenta tools ---------------------------------------- [ Custom  v ] --+
|  Tools your agent can use wherever it runs: the playground, the API,   |
|  Slack, Telegram, WhatsApp and automations. Saved with the agent.      |
|                                                                        |
|  WRITE                                                                 |
|  Rename this chat                                       [ Allow    v ] |
|  Rename the agent          In the playground, Build kit applies        |
|                                                         [ Deactivate v]|
|  Add a schedule                                         [ Deactivate v]|
|  ...                                                                   |
|  READ-ONLY                                                             |
|  Get the link to this chat                              [ Allow    v ] |
|  Check schedules                                        [ Deactivate v]|
|  ...                                                                   |
+------------------------------------------------------------------------+
+-- Build kit ------------------------------------------ [ Allow all v ] -+
|  Tools the assistant uses only while you build in the playground.      |
|  Not available in Slack, Telegram, WhatsApp, automations or the API.   |
|  Saved in this browser.                                                |
|  WRITE     Save changes [Allow v]   Add a schedule [Allow v]   ...     |
|  READ-ONLY Read the agent setup [Allow v]   ...                        |
+------------------------------------------------------------------------+
```

| Option | Trade-off |
| --- | --- |
| **Two sections with the same controls** | Clear which tools reach production and which help only while building. Reuses the build kit's controls. |
| One list with a "playground only" tag | Fewer blocks, but one list would mix choices saved with the agent and choices saved in the browser. |
| Agenta tools as ordinary rows in the agent's tools list | Looks like the author added them by hand, and the controls there differ. |

### 6. Where the session link points

**Decision:** The session's page in `/m`: `/m/w/<ws>/p/<project>/sessions/<id>?agent=<agent>`, without `?agent=` when the session has no agent reference.

| Option | Trade-off |
| --- | --- |
| The classic playground tab (today) | Classic-mode users land where they expect. Everyone else on a desktop with no saved preference also lands in classic, although `/m` is the default app. A session with no agent reference gets no link. |
| **The `/m` session page** | Opens in the default app. The `/m` gate already sends Classic-mode users to the classic tab (`mobileGate/index.ts:350-352`). The page needs only the session ID, so a Slack agent bound by application reference also gets a link, and `agent_reference_missing` goes away. |
| A new short route that picks the app | Shortest link, but a new route for something the two gates already do. |

### 7. Who can open the link, and when the agent shares it

**Decision:** Signed-in project members only, as today. The agent shares the link when asked, and when it ends a long piece of work in a chat app or automation whose detail does not fit in the reply.

| Option for who | Trade-off |
| --- | --- |
| **Project members who can view sessions** | No change. A session can hold customer messages and tool output, so it stays private. A Slack colleague without an account sees the sign-in page. |
| A public read-only link | Anyone the link is forwarded to could read the session. Needs sharing, expiry and revocation. A separate feature. |

| Option for when | Trade-off |
| --- | --- |
| Only when asked | Predictable, but people in Slack do not know a link exists to ask for. |
| **When asked, and at the end of long work in a chat app or automation** | Covers "Details: <link>" after a long Slack task. One sentence in the tool description. The model decides, so it may sometimes skip it. |
| The platform adds an "Open in Agenta" link to every channel reply | Always there, but noisy on short answers, and useless to a WhatsApp customer. A channels change. |

The description also tells the agent to share the link only with people who can open it, and to say it opens in Agenta for people with access. On WhatsApp, where the person is usually a customer, it shares the link only when asked.

## Risks / Trade-offs

- **Test runs and evaluations run with the author's choices.** If an author turns on `create_schedule`, a test run or an evaluation can create a real schedule. All write tools are off by default, so this needs an author's choice. A later change can drop write tools from those runs by run kind, as the earlier kit draft proposed.
- **Anyone who can talk to a Slack bot can use the tools the author turned on.** Mitigation: off by default, Ask available per tool, and the Slack approval card.
- **Channel sessions look person-started.** They carry no origin marker, so in the session list a Slack session reads like one started by hand. Not a blocker for the link.
- **The sign-in return.** A person who signs in from the link should land on the session. QA checks this in both apps.
- **Two places save settings.** Agenta tools save with the agent, Build kit in the browser. The section copy says which is which.
- **The playground does not show the Agenta tools choices.** Every Agenta tool is also a build kit tool, so a playground run follows the build kit, not the Agenta tools. An author who turns a tool off in Agenta tools still sees it in the playground. The row note and the section copy say so, and live QA checks the choice from Slack or the API.

## Open Points

- **Build kit copy.** Mahmoud said "the build kit should not be changed". This change keeps the build kit's tools, controls and storage as they are, and proposes only new copy that says it is playground-only (decision 5). If he meant no change at all, the Build kit copy stays as it is today, task 3.4 covers only the Agenta tools copy, and the Build kit copy requirement in `specs/agenta-tools-settings/spec.md` is removed. Not decided here.

## Migration Plan

1. Ship the handler step and the kit definition. Existing agents have no `agenta_tools` block, so every run gets the two defaults, `get_current_session` and `rename_session`. No saved configuration is rewritten.
2. In the same release, ship the `/m` link. The build kit is unchanged, and a tool it sends that the Agenta tools also add appears once (decision 3).
3. Ship the Agenta tools section. Until then, authors can set the block through the API or the JSON editor.

Existing agents lose nothing: in the playground the build kit is unchanged, and elsewhere they had none of these tools before.

Rollback: remove the handler step. Saved `agenta_tools` blocks are ignored by older code, because unknown top-level keys of the agent configuration are accepted (`sdks/python/agenta/sdk/agents/dtos.py:1531`).

## Verification Plan

SDK unit tests cover the defaults, each setting (`allow`, `ask`, `off`, missing), the precedence rule, the session-ID condition, and the standalone case. API unit tests cover the unchanged build kit list and the `/m` link with and without an agent reference. Web unit tests cover the section and its draft edits. Live QA runs one agent from `/w`, `/m`, the API, Slack, Telegram and a schedule: it asks for the link, turns `create_schedule` on with Ask and uses it from Slack, and turns `rename_session` off and checks that Slack runs stop naming their sessions while the playground follows the build kit. It then opens the link as a member with Classic mode on and off, on a phone, signed out, and as a non-member.

## Effort

About 5 to 7 engineer-days: handler step, kit definition and tests (1.5), API link, build kit and listing (1), settings section in `/w` and `/m` (2 to 3), live QA and fixes (1 to 1.5).
