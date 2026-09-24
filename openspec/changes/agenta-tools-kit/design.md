# Design

## Context

This section records how the build kit works on `main` at `2f9cf635ca`. Line numbers refer to that commit.

### What the build kit is

- **The list.** `DEFAULT_BUILD_KIT_OPS` (`api/oss/src/core/workflows/build_kit.py:58-83`) names 20 platform operations. `_BUILD_KIT_OP_PERMISSIONS` (`build_kit.py:30-54`) gives each one a permission. Three client tools, `request_connection`, `request_input`, and `request_secret`, are added as embeds (`build_kit.py:89-93`). Two skills, build-an-agent and agenta-apps, and a sandbox posture of `write_files: allow` and `execute_code: allow` complete the overlay (`build_agent_template_overlay`, `build_kit.py:121-153`).
- **How it is served.** The overlay is published as the static workflow `__ag__build_kit` (`api/oss/src/core/workflows/static_catalog.py:315-323` and `366-373`), with `embeddable: False`. It is also attached to `GET /simple/applications/{id}` as `additional_context.playground_build_kit` (`api/oss/src/apis/fastapi/applications/router.py:1921-1937`, re-exported by `applications/overlay.py`). The web reads the static workflow first and falls back to the application response (`web/packages/agenta-entities/src/workflow/state/store.ts:1474-1515`).

### Which runs get it

Only playground runs, plus the first run of a loaded template.

- The browser merges the overlay into the parameters of the run it is about to send (`web/packages/agenta-playground/src/state/execution/agentRequest.ts:331-345`, merge in `buildKitOverlay.ts:152-167`). Classic and `/m` share this request builder, so both get the kit.
- Loading a template sends the browser's switches with the request (`ui_build_kit_enabled`, `ui_disabled_ops`). The loader applies the same overlay on the server to the first run only (`api/oss/src/core/agent_templates/loader.py:312-318`, used at `:417`; the Python merge is `apply_ui_build_kit`, `build_kit.py:156-212`).
- Every other run sends no overlay. A Slack or Telegram turn (`api/oss/src/tasks/asyncio/channels/inbox.py:838`), an automation fire (`api/oss/src/tasks/asyncio/triggers/dispatcher.py:365`), an approval resume, an evaluation, and a plain API call all run the committed configuration. Nothing on the server adds build-kit tools to them.

### Where the switches live

In the browser only. The master switch and the list of switched-off operations are one `localStorage` record, `agenta:playground:build-kit`, keyed by revision ID (`store.ts:1517-1596`). They survive a reload in that browser. They are not saved on the agent, not shared with teammates, and never reach a production run. The drawer shows the kit as one block with a master switch and a switch per platform tool. The embeds are shown as locked on (`web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/useBuildKit.tsx:56-158`).

### How per-tool permissions work

- The kit writes an explicit `permission` on every platform entry it adds (`build_kit.py:126-131`). Automation writes are `ask`. Reads, `rename_session`, `test_subscription`, `commit_revision`, `create_app` and the rest are `allow`.
- The merge replaces an author's entry that has the same identity (`platform:<op>`) with the kit's entry (`build_kit.py:201-204`, `buildKitOverlay.ts:76-81`). So today, in the playground, **the kit wins over the author**. An author who set `create_schedule` to `deny` still gets `ask` in the playground.
- A platform operation carries only a `read_only` hint (`sdks/python/agenta/sdk/agents/platform/op_catalog.py:153-220`). The resolver copies the author's permission as it is (`platform_tools.py:123-131`). With no permission, `effective_permission` (`sdks/python/agenta/sdk/agents/tools/models.py:142-152`) allows reads and asks for writes under the default `allow_reads` mode, and follows the agent-wide mode otherwise.
- Two entries for the same operation fail the run: `Duplicate platform tool` (`platform_tools.py:103-109`). The resolver drops only exact duplicates of the three request cards (`tools/resolver.py:151-180`).

### How it avoids being committed

Three things keep it out of saved revisions.

1. The browser merges it into a throwaway copy of the run parameters. The draft and the commit never see it (`buildKitOverlay.ts:1-13`).
2. The static workflow is not embeddable. A revision that embeds `__ag__build_kit` is refused on commit (`api/oss/src/core/workflows/service.py:1722` and `1764-1800`, also `:2736`) and by the `commit_revision` handler (`api/oss/src/core/tools/platform_handlers.py:883`).
3. The template loader keeps the kit in `runtime_parameters`, which feed the first run only (`loader.py:312-318`).

Nothing stops an author from listing `create_schedule` by hand in `tools`. That entry is committed like any other tool.

### Instructions tied to the kit

`compose_platform_instructions` (`sdks/python/agenta/sdk/agents/platform_instructions.py:412-420`) adds `AGENTA_CONFIG_SECTIONS` (`:256-305`) only when the run has `commit_revision` (`:22-25`). That block holds the trigger guidance ("Triggers run you later ...", `:285-287`) and "Setting up an automation" (`:300-305`). `session_context_guidance` asks the agent to name the session only when `rename_session` is present (`:394-400`).

### What a Slack or Telegram thread can show

A channel turn can draw exactly one kind of interactive card: an approval card with Approve and Deny (`api/oss/src/core/channels/render/render.py:160-235`). It cannot draw the request-input form, the connection card, or the secret card.

## Goals / Non-Goals

**Goals:** Make `rename_session`, the automation tools, and the channel tools available in every run of an agent. Let an author turn them off, all at once or one by one, and save that choice on the agent. Never add a tool twice. Respect the author's permission. Keep write tools out of runs where nobody expects side effects.

**Non-Goals:** Changing what any tool does. Moving authoring tools out of the playground. Making the request cards work in Slack or Telegram. Per-environment switches. A new permission model.

## Decisions

### 1. Which runs get the Agenta tools

**Decision:** Every run that passes through the SDK agent handler (`make_agent_handler`, `sdks/python/agenta/sdk/agents/handler.py:353`). That covers the playground, `/m`, the API, Slack and Telegram turns, automation fires, approval resumes, and loaded-template first runs. Three kinds of run get less, see decision 5.

| Option | Covers | Trade-off |
| --- | --- | --- |
| **A. Add them in the SDK handler, just before `comp.resolve_tools` (`handler.py:386`)** | Every run, including inline-config playground runs and a standalone SDK user connected to Agenta | One place. Needs no browser change for runs. The handler must read the switch from the parameters and must know the run kind. |
| B. Add them on the API when it loads a revision for a run | Channel, automation, and API runs | Misses the playground, which sends its configuration inline and skips loading. Two code paths to keep in step. |
| C. A browser overlay, like the build kit | Playground only | Exactly the problem this change fixes. |
| D. Write the tools into every agent's `tools` list | Every run | Rewrites every revision, makes the tools look like author choices, and cannot follow later changes to the kit. |

Option A also matches the rule that agent runtime fixes live in the SDK, not the core API. The step does nothing when the platform connection has no API base URL. Otherwise every standalone SDK run would fail with the resolver's missing-URL error (`platform_tools.py:63-70`).

### 2. What is in the kit

**Decision:**

| Tool | Kit | Default permission | Condition |
| --- | --- | --- | --- |
| `rename_session` | Agenta tools | allow | Dropped when the run has no session ID. Its binding `$ctx.session.id` would fail the call. |
| `discover_triggers`, `list_schedules`, `list_subscriptions`, `list_deliveries` | Agenta tools | allow (read-only) | None |
| `test_subscription` | Agenta tools | allow | Captures a sample event without running the agent. |
| `create_schedule`, `create_subscription` | Agenta tools | ask | Dropped when the run has no variant ID, which their binding needs. Dropped in automation runs (decision 5). |
| `remove_schedule`, `remove_subscription` | Agenta tools | ask | Dropped in automation runs (decision 5). |
| `list_channel_destinations`, `read_channel_messages`, `search_channel_messages` | Agenta tools | allow (read-only) | Only when the agent has an active bot (decision 8). |
| `send_channel_message` | Agenta tools | allow (Mahmoud's decision) | Only when the agent has an active bot. |
| `commit_revision`, `read_config`, `test_run`, `rename_agent`, `search_skills`, `check_skill_updates`, `apply_skill_update`, `discover_tools`, `create_app`, `list_starters` | Build kit | Unchanged | Playground only |
| `request_connection`, `request_input`, `request_secret` | Build kit | Unchanged | Playground only |

**The request cards stay in the build kit.** Each one is a client tool: the run pauses until the browser draws a form and sends the answer back. A Slack or Telegram thread can draw only an approval card (`render.py:160-235`), so a request card would leave the turn paused with nothing for the person to click. In an automation run nobody is there at all.

| Option | Trade-off |
| --- | --- |
| **Keep all three in the build kit** | Honest about what works. In Slack the agent asks in plain text and links to the Agenta page where the person can connect an app. |
| Move `request_input` only, and render it in channels as a numbered text question | Useful, but it needs a new channel renderer and a way to map a typed reply back to the form. A separate change. |
| Move all three and render a link card | The person leaves Slack to finish in Agenta, and the turn has to wait for them. Needs the same new renderer. |

A follow-up can move `request_input` once channels can render it.

`pause_schedule`, `resume_schedule`, `pause_subscription`, `resume_subscription`, and `list_connections` are in the catalog but not in the build kit today. This change does not add them. Adding them later is one line each.

### 3. Where the switch lives

**Decision:** A new optional block in the agent configuration, committed with the revision:

```json
"agenta_tools": { "enabled": true, "disabled_tools": ["create_subscription"] }
```

A missing block, or a missing field, means on. `disabled_tools` names tools from the kit. An unknown name is ignored, so a later rename of a tool does not break a saved agent.

| Option | Trade-off |
| --- | --- |
| **A field in the agent configuration** | Versioned with everything else. A deployment to production carries the setting that was tested. An evaluation of an old revision reproduces it. The handler reads it from the parameters it already has, with no extra call. API users can set it. Turning a tool off needs a commit, which is the same as every other production setting. |
| A setting on the agent, stored outside revisions | Takes effect at once for every environment, with no commit. But it is not versioned, the handler needs one more API read per run, and a switch flipped while testing changes production immediately. |
| Per-tool switches only, through the author's own tool entries (an explicit entry with `deny`) | No new field. But the model still sees a tool it can never use, there is no "all off", and the list fills with entries the author did not really choose. |

**How this fits "the build kit is never committed".** The rule stays true for both kits. The tools are never written into `tools`. Only the switch is saved. The `__ag__agenta_tools` static workflow (decision 7) is also not embeddable, like `__ag__build_kit`.

The agent can change the block with `commit_revision`, like any other part of its configuration. Turning a tool off only removes power, so this is not a way to gain access. The platform instructions tell the agent to change it only when the person asks.

### 4. Permissions and precedence

**Decision:** Add an optional `default_permission` to platform operations (`PlatformOp` in `op_catalog.py`). The channel-tools draft proposed the same field (its task 2.7). Whichever change lands first adds it. The resolver uses it only when the author set no permission and the agent-wide mode is `allow_reads`. The kit adds its entries with no permission, so the kit and a hand-written bare entry behave the same.

Precedence, highest first:

1. The operator kill switch in the runner.
2. The author's permission on their own entry for the tool.
3. An agent-wide mode of `ask` or `deny`.
4. The operation's `default_permission`.
5. The `read_only` hint under `allow_reads`: reads allow, writes ask.

| Option for who wins | Trade-off |
| --- | --- |
| **The author's entry wins, everywhere** | What the author wrote is what runs, in the playground and in production. This changes today's playground behavior, where the kit overwrites the author's entry (`build_kit.py:201-204`). |
| The kit wins, as in the build kit today | Keeps today's playground behavior, but an author could never tighten a tool, for example set `create_schedule` to `deny` for a public Slack bot. |

| Option for automation writes in Slack and Telegram | Trade-off |
| --- | --- |
| **ask** | The approval card appears in the thread (`render.py:160-235`). Nobody gets a schedule they did not approve. One extra click. |
| allow | Smooth, but anyone who can talk to the bot in a channel can make the agent create automations that run and spend credits with nobody reviewing them. |
| Different defaults per surface (for example `allow` in the playground, `ask` in channels) | Harder to explain, and the permission is no longer a property of the tool. |

Who may answer an approval card in a shared channel is set by the channels feature, not by this change. The plan checks it during QA.

### 5. Runs that get fewer tools

**Decision:**

| Run kind | What it gets | Why |
| --- | --- | --- |
| Test run started by `test_run` (`run_kind = "test"`, set at `platform_handlers.py:136-139`) | Read-only Agenta tools only | A test must not create real schedules or post real messages. |
| Evaluation run | Read-only Agenta tools only | Running an agent over 200 test cases must not post 200 messages to Slack. |
| Automation run (a schedule or subscription fire) | Everything except `create_schedule`, `create_subscription`, `remove_schedule`, `remove_subscription` | An automation that creates automations can multiply without a person noticing, and nobody is there to answer an approval. It can still read, rename its session, and post to a channel. |
| Every other run | The full kit | |

The handler already reads the run kind from `request.meta.run_kind` (`handler.py:454-461`). Today only test runs set it. The trigger dispatcher (`api/oss/src/tasks/asyncio/triggers/dispatcher.py:365`) and the evaluation runtime (`api/oss/src/core/evaluations/runtime/adapters.py:130` and `:538`) will set `automation` and `evaluation`. The marker comes from the request body, so a caller could set it. That is safe because it can only remove tools.

| Option | Trade-off |
| --- | --- |
| **Filter by run kind in the handler** | One rule, in the same place the tools are added. Needs two callers to set a marker. |
| Rely on permissions only | An `ask` in an automation run parks the run until someone opens the session. A channel send is `allow`, so an evaluation would post for real. |
| Leave them all in | Simplest, and dangerous for evaluations. |

### 6. Duplicates

**Decision:** The kit adds a tool only when the run's tool list has no platform entry for the same operation. It compares on the operation name, the same identity the resolver uses (`platform_tools.py:103-109`). An author's entry is kept exactly as written. Because of this rule, a run can never fail with `Duplicate platform tool` because of the kit.

This also covers the rollout. A browser that still has the old build kit cached sends `rename_session` and the automation tools in its overlay. The handler sees them as entries already present and adds nothing. The old overlay's `ask` then applies for that run, which matches today's behavior.

### 7. How the playground shows them

**Decision:** A new **Agenta tools** block in the agent configuration drawer, in the tools area, not in Advanced, because it affects production. It has one master switch and one row per tool. Each row has the tool's name, a one-line description, its default permission as a label, and a switch. There is no permission editor in the row.

- A row whose tool the author also listed by hand shows "Set in your tools" and no switch. The author's entry decides.
- The channel rows show "Active when this agent is connected to Slack or Telegram" when no bot is connected, and stay switchable.
- A switch edits the draft `agenta_tools` block. The draft becomes dirty, and a commit saves it, like any other field. This is different from the build kit's switches, which are per browser and never committed.
- The list comes from a new static workflow, `__ag__agenta_tools`, built from the same SDK definition as the handler, so the drawer and the run never disagree. It is read-only and not embeddable.
- The build kit block keeps its current look and loses the moved rows.

| Option | Trade-off |
| --- | --- |
| **Separate block with its own switches** | Clear which tools reach production and which are playground help. |
| Merge both kits into one block with a "playground only" tag | Fewer blocks, but one list mixing saved and per-browser switches is confusing. |
| Show Agenta tools as ordinary rows in the tools list | Looks like the author added them, and invites editing that the kit does not support. |

### 8. Channel tools

**Decision:** The four channel tools are members of the Agenta tools kit with one extra condition: the agent must be bound to an active, verified bot. This replaces the separate `resolve_channel_tools` hook the channel-tools draft proposed next to `handler.py:332` (its task 1.8). The availability check, its deadline, and its "failure adds nothing" rule stay as the channel-tools draft describes them. The check runs inside the kit step, and only when at least one channel tool is switched on.

The kit switch and the three bot settings from the channel-tools draft both apply. The kit switch decides whether the model sees a tool. The bot settings decide whether a call may post or read. An admin who turns off "Can post outside the conversation" on the bot blocks sends even when the agent's author left `send_channel_message` on.

| Option | Trade-off |
| --- | --- |
| **One kit, with a condition on the channel tools** | One step, one switch block, one duplicate rule, one place in the UI. |
| Keep a separate channel hook next to the kit | Two injection paths with their own duplicate and precedence rules. |
| Channel tools always present, refusing when unconnected | The model sees tools it cannot use and wastes turns on them. |

### 9. Instructions

**Decision:** Split `AGENTA_CONFIG_SECTIONS` (`platform_instructions.py:256-305`) by the tools each part talks about.

- **Stays with `commit_revision`:** "Task, or a change to you?", "Your configuration" (without the Triggers bullet), and "Learn from the conversation".
- **New `AGENTA_AUTOMATION_SECTION`, included when `create_schedule` or `create_subscription` is present:** the Triggers bullet and "Setting up an automation". It adds one rule for chat surfaces: a scheduled run starts a new Agenta session and does not answer in the Slack or Telegram thread by itself. When the person asks from a channel, write the destination into the scheduled task ("post the result to destination X with `send_channel_message`"). When there is no channel tool, tell the person where the results will appear.
- **New `AGENTA_CHANNEL_SECTION`, included when `send_channel_message` is present:** use `list_channel_destinations` to find IDs, never guess one, and follow the base rule about confirming a message sent in the person's name.
- The session-naming line already follows `rename_session` (`:394-400`) and needs no change.

| Option | Trade-off |
| --- | --- |
| **Gate each section on the tools it describes** | The model reads only about tools it has. A Slack run with the automation tools gets the automation guidance. |
| Keep everything behind `commit_revision` | Slack runs get the automation tools with no guidance, including no hint that a schedule does not post back to Slack. |
| Put the guidance in each tool's description | Tool descriptions are already long. The cross-tool advice about where a result appears does not belong to any one tool. |

## Risks / Trade-offs

- **Slack users can create automations.** Anyone who can talk to the bot can ask for a schedule. Mitigations: `ask` by default, the approval card, the author's per-tool setting, the kit switch, and the agent-wide `ask` mode.
- **Behavior change for existing agents.** Production runs gain tools they did not have yesterday. Mitigation: the switch, a changelog note, and the defaults above.
- **Lost browser switches.** A person who turned off `create_schedule` in the build kit gets it back, because that choice was per browser. Mitigation: the changelog note tells authors to use the new saved switch.
- **Credential reach.** A channel or automation run calls the automation routes with that run's credential. If that credential lacks trigger permissions, the call is refused and the agent reports it. The plan checks this in QA.
- **Run-kind marker gaps.** A run started by a path that forgets the marker gets the full kit. Mitigation: tests on the two callers, and the kit never adds a write tool that the author did not leave on.

## Migration Plan

1. Ship the SDK step with the new kit (plan phase 1). The build kit still sends the moved tools from the playground. The duplicate rule keeps runs working.
2. Remove the moved tools from the build kit and add `__ag__agenta_tools` (phase 2). From this release, the tools come only from the Agenta tools kit.
3. Ship the drawer block (phase 4). Until then the kit is on for everyone with no switch in the UI. The switch still works through the API or a hand edit.
4. Ship the channel tools into the kit when the channel-tools change lands (phase 5).

Rollback: disable the step with an environment variable, `AGENTA_AGENT_TOOLS_KIT_ENABLED=false`, and restore the build kit list. Saved `agenta_tools` blocks are ignored by older code, because the runtime template accepts unknown top-level keys (`_validate_agent_template_shape`, `sdks/python/agenta/sdk/agents/dtos.py:1528-1535`).

## Verification Plan

SDK unit tests cover the kit list, the switch, the duplicate rule, precedence, each run-kind filter, and the missing session or variant cases. API unit tests cover the smaller build kit and the new static workflow. Web unit tests cover the block and its draft edits. Live QA covers one agent in the playground, over the API, in a Slack thread, in a Telegram chat, and in a schedule fire, plus an evaluation run. [plan.md](plan.md) lists every test and command.

## Effort

| Component | Engineer-days |
| --- | ---: |
| SDK kit definition, handler step, duplicate rule, default permission, run-kind filters | 2-3 |
| API build kit trim, static workflow, run-kind markers on automations and evaluations | 1-2 |
| Instructions split and tests | 0.5-1 |
| Playground block (classic and `/m`) | 2-3 |
| Channel tools into the kit (replaces channel-tools task 1.8, net saving about 1 day there) | 0.5 |
| Live QA and fixes | 1.5-2 |
| Total | 7.5-11.5 |
