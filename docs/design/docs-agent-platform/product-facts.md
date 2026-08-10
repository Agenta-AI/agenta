# Agenta agent product — UI facts reference

Ground truth for documentation writers. Every label below was read off the running product,
not from memory. If a control is not listed here, it was not verified — do not invent a name
for it.

- **Captured against:** Agenta v0.106.1 (EE, dev deployment), 30 July 2026.
- **Viewport for every screenshot:** 1440 x 900.
- **Screenshots live in:** `docs/static/images/agents/` (referenced by filename below).
- **Terminology note:** the URL path for an agent is `/apps/<id>/...` and the project home
  breadcrumb reads `Apps`, but every user-facing label in the agent surfaces says **Agent** /
  **Agents**. Write "agent"; never "app".

## Global chrome

| Control | Exact label | What it does |
|---|---|---|
| Sidebar, workspace row | `resiros` (the workspace name) | Switches workspace |
| Sidebar, project row | `demo` (the project name) | Opens the project switcher. The list shows every project plus `New project` |
| Sidebar nav | `Home`, `Prompts`, `Agents`, `Evaluation`, `Observability` | Top-level project nav. `Prompts` and `Agents` expand to list individual entities |
| Sidebar footer | `Settings`, `Invite Teammate`, `Help & Docs` | |
| Top bar right | three-icon segmented control (light / system / dark) and `agenta v0.106.1` | Theme switch, version |
| Breadcrumb | `resiros / demo / Apps` | Workspace / project / section |

Inside an agent the sidebar switches to an agent-scoped nav: `Back`, the agent name with the
subtitle `Agent`, then `Overview`, `Playground`, `Registry`, `Evaluations`, `Observability`.

---

## 1. Creating an agent

### Click path

`Sidebar > Home` — the project home *is* the agent-creation screen. There is no separate
"new agent" wizard on this screen; you type into the composer and press **Create agent**.

Second path: `Sidebar > Agents > Create` opens a full-screen **Agent** drawer that shows the
same configuration + chat panes with a `Draft` badge and a `+ Create` button.

### What you see first

The heading is **"What do you want to build?"** with the subheading
*"Describe an agent in plain language — we'll create and name it, then open the playground."*

| Control | Exact label / text | What it does |
|---|---|---|
| Composer | placeholder: `e.g. Watch our #support channel, triage each thread by urgency, and route it to the right owner — ask me before closing anything.` | Free-text description of the agent |
| Composer hints | `Ctrl B Bold`, `Ctrl I Italic`, `↵ Send`, `Ctrl ↵ Newline` | Keyboard hints, shown once the composer has focus |
| Button | `Use my coding agent` | Copies a handoff snippet to the clipboard. Toast on success: `Copied — paste into Claude Code, Cursor, Codex, or any coding agent`. The copied text starts with `npx skills add Agenta-AI/agenta-skills` followed by *"Then use the Agenta skills to create an agent that does the following:"* and your description |
| Button | `Create agent` | Creates and names the agent, then opens its playground. While it works the label reads `Creating agent` |

### Template gallery

The section is called **Templates** (not "gallery", not "examples"). It is a horizontal strip
of three cards at a time with pagination.

| Control | Exact label | Notes |
|---|---|---|
| Section title | `Templates` | |
| Category filters | `All` `28`, `Engineering` `10`, `Support` `4`, `Sales` `5`, `Knowledge` `5`, `Ops` `4` | Counts as shown on 30 Jul 2026 |
| Pager | `1–3 of 28`, `Previous templates`, `Next templates` | |
| Overflow menu (…) | `Don't show again` | Hides the strip. When hidden the line reads `Templates hidden` with a `show again` link. **Read from `web/oss/src/components/TemplateStrip/assets/constants.ts`, not opened in the UI** |
| Selecting a card | Inserts a chip above the composer reading `From template:` followed by the template name, with a `Remove template` (x) button, and prefills the composer | |

All 28 template names and one-line descriptions:

| Template | Description |
|---|---|
| PR reviewer | Reviews PRs, comments inline, flags risky changes. |
| Changelog writer | Turns merged PRs into clean release notes. |
| Issue triage | Labels new issues by area and priority, assigns an owner. |
| CI failure triage | Summarizes failed CI runs and pings the author. |
| Code Q&A | Answers questions about the repo when mentioned. |
| Dependency digest | Weekly summary of open dependency-update PRs. |
| Support triage | Reads #support, tags urgency, routes to owners. |
| Support reply drafter | Drafts replies to new tickets using your docs. |
| Bug report router | Turns complaints into Linear tickets with repro steps. |
| Feedback clusterer | Daily clusters new feedback into themes. |
| Lead qualifier | Enriches and qualifies new inbound leads. |
| CRM updater | Updates CRM records from recent email threads. |
| Outreach drafter | Drafts personalized outreach for a contact list. |
| Meeting follow-up | Drafts a follow-up email and logs notes to the CRM. |
| Pipeline digest | Daily digest of pipeline changes and stale deals. |
| Incident responder | Watches alerts, gathers context, pages on-call. |
| Error triage | Triages new Sentry errors by severity, files real ones. |
| Uptime reporter | Daily uptime and error-rate summary to Slack. |
| On-call briefer | Briefs on-call with open incidents each morning. |
| Docs Q&A | Answers questions from your docs workspace. |
| Knowledge chatbot | Customer-facing chatbot answering from your knowledge base. |
| Onboarding buddy | Answers new-hire questions from your internal wiki. |
| Content repurposer | Turns a published doc into draft social posts. |
| Newsletter drafter | Weekly newsletter drafted from shipping activity. |
| Standup summarizer | Posts a daily digest of channel activity. |
| Repo Slack digest | Twice-daily digest of issues, commits, and PRs. |
| Cross-tool sync | Mirrors new Linear issues into a Notion tracker. |
| Weekly report | Weekly report of shipping and product metrics. |

### Rest of the home screen

Below Templates sits the **Usage** bar and then **Your agents** (a table with columns `Name`,
`Last modified`, `Created at`, `Created by`). See §7 for Usage.

### The playground

Click path: `Sidebar > Agents > <agent name>`, or it opens automatically after **Create agent**.

The header row is: agent name, a variant dropdown (`default` with a chevron), a version pill
(`v1`), and a save-state dot that reads `Saved` or `Draft`. On the far right is a segmented
control labelled **Playground mode** with two options: **`Build`** and **`Chat`**.

| Mode | Layout |
|---|---|
| `Build` | Left column = **Configuration**; right column = the agent conversation with tabs (`Chat 1`), a `New session` (+) button, and a `Session history` (clock) button |
| `Chat` | Left column = **Sessions** list (with `Search sessions` and a `+` new-session button); centre = the conversation; right rail = the files panel toggle |

Chat-mode empty state: **"What can I help you with?"** / *"Ask a question, or describe a task
you want this agent to run."*

Chat input placeholder: `Ask the agent... (Enter to send, ⌘/Ctrl+Enter for newline)`.
When no model key is configured the input is read-only and reads
`Connect a model to start chatting...`, with a banner
`Add your model provider key to run this agent.` and a `Set up credentials` button.

A freshly created agent opens with a primer card in the conversation: the agent name, the model
pill, a tool-count pill, the first line of AGENTS.md, then a section headed `WE'LL START WITH`
containing your description and a `Start →` button. Below it: `Connect a model below to start.`

### Screenshots

- `home-what-do-you-want-to-build.png` — the project home / agent-creation screen with the composer, `Use my coding agent`, `Create agent`.
- `home-templates-and-usage.png` — the Templates strip, category filters, Usage bar, `Your agents` table.
- `home-template-selected.png` — composer after clicking the *PR reviewer* template, showing the `From template:` chip.
- `playground-build-mode.png` — the playground in `Build` mode, whole Configuration column visible.
- `playground-chat-mode.png` — the playground in `Chat` mode with the `Sessions` list.
- `agents-list.png` — `Sidebar > Agents` list view (`Search`, `Archived`, `Create`, columns `Name` / `Created At` / `Type`).
- `agents-list-create.png` — the full-screen `Agent` drawer opened by `Agents > Create`.

---

## 2. Agent configuration

### Click path

`Sidebar > Agents > <agent> > Playground > Build`. The left column header is **Configuration**.

### Configuration column, top row

| Control | Exact label | What it does |
|---|---|---|
| Button | `Deploy` | Opens the **Deploy variant** dialog (§5) |
| Button | `Commit` | Opens the commit dialog (§5). Disabled while the state is `Saved` |
| Overflow (⋮) | `Copy raw config`, `Revert Changes`, `Delete` | |

### Sections, in order

`Model & harness` → `Instructions` → `Tools` → `Skills` → `Advanced` → **Triggers** heading →
`Subscriptions` → `Schedules` → **Files** heading.

Each section header shows a summary on the right (for example `1 file`, `4 tools`, `None`,
`Sandbox: local`) and, where applicable, a `+` quick-add button.

#### Model & harness

Header summary reads `<harness> · <model>`, for example `Pi · gpt-5.6-luna`. A `Connect key`
pill appears when no provider credential is set.

Expanding it inline gives:

| Control | Exact label | Notes |
|---|---|---|
| Model combobox | shows the model id, e.g. `gpt-5.6-luna` | Opens the provider/model picker |
| Segmented control | `API key` / `Subscription` | Credential mode |
| Provider tiles | `OpenAI`; under `USE CUSTOM PROVIDER`: `Azure OpenAI`, `OpenAI-compatible endpoint` | |
| Field | `API key *` with placeholder `sk-…` | Helper text: `This secret is encrypted in transit and at rest.` |
| Button | `Save` | |
| Link | `Detailed configuration` | Opens the full **Model & harness** dialog |

Model picker (the combobox dropdown): a `Search` box, then a provider list with model counts —
`OpenAI` 45, `Anthropic` 14, `Google Gemini` 16, `Mistral AI` 30, `Groq` 7, `MiniMax` 3,
`Together AI` 20, `OpenRouter` 270, `OpenAI Codex` 7 — and a footer button
`+ Add custom provider`. Hovering a provider reveals its models in a second column.

**Model & harness dialog** (`Detailed configuration`) has three collapsible sections plus a
right rail:

| Section | Contents |
|---|---|
| `Harness` | Helper text: *"The harness is the runtime that executes your agent. It decides which providers, hosting and connection options you can use."* Two choices: **`Pi`** and **`Claude Code`**. The selected one shows a `Current` pill and either `✓ supports your model` or `⚠ model not available`, plus `PROVIDERS` (e.g. `openai · anthropic · gemini · mistral +5 · 137 models` for Pi; `anthropic · 5 models` for Claude Code) and `HOSTING` (`direct · custom` for Pi; `direct · custom · bedrock · vertex_ai · vertex` for Claude Code) |
| `Model` | A combobox. Helper: *"Filtered to the models this harness can reach. Selecting a model also sets its provider."* |
| `Provider credentials` | Segmented `API key` / `Subscription`. Under `API key`: provider tiles (`OpenAI`, then `USE CUSTOM PROVIDER`: `Azure OpenAI`, `OpenAI-compatible endpoint`), the description *"Standard provider · add your key and we auto-list its models."*, the `API key *` field, `Save`, and *"This secret is encrypted in transit and at rest."* Under `Subscription`: a card titled **`Self-managed`** with the bullets *"Use a Claude Code or Codex subscription, or any credential the harness reads from its own environment (env vars, prior logins)."*, *"Agenta stores and injects no key."*, *"**Requires a self-hosted Agenta deployment.**"*, a `Read the self-hosting guide →` button, and a red `Unavailable in the cloud` pill |
| Right rail | `VERSION HISTORY` with a `soon` pill (placeholder, not yet functional) |
| Footer | `Draft — applies on save`, `Cancel`, `Save` |

#### Instructions — where AGENTS.md lives

The section is called **Instructions**. The single instruction file is called **`AGENTS.md`**
and its row shows `Markdown · <n> words` plus a content preview.

The `+` button is labelled `Add instruction file` and is **disabled**, with the tooltip
`Multiple instruction files coming soon`.

Clicking the `AGENTS.md` row opens a dialog titled `AGENTS.md`:

| Control | Exact label | Notes |
|---|---|---|
| Segmented control | `Edit` / `Preview` | |
| Toolbar | `Normal text` (text-style menu), `Bold`, `Italic`, `Bulleted list`, `Numbered list`, `Link`, `Insert table`, `Source` | `Source` toggles raw markdown |
| Right rail tips box | `Writing a good AGENTS.md` with four bullets: *"Open with the agent's role and goal in one or two lines."*, *"Keep short, labelled sections (Role, Tools, Guardrails)."*, *"Be concrete about the output format and hard limits."*, *"Prefer imperative instructions over long prose."* | |
| Right rail | `SUGGESTED` chips: `+ Output format`, `+ Tone & style`, `+ Guardrails` | Insert boilerplate headings |
| Right rail | `VERSION HISTORY` + `soon` pill | Placeholder |
| Footer | `Draft — applies on save`, `Cancel`, `Save` | |

#### Tools — where tools are added

Header summary: `<n> tools`. The `+` button is labelled `Add tool` and opens a menu:

| Group | Item | Sub-label |
|---|---|---|
| `ADD EXISTING` | `Reference a workflow` | `Call a published workflow as a tool` |
| `ADD EXISTING` | `Third-party integration` | `Connect an app, pick actions` |
| `CREATE NEW` | `Tool definition` | `JSON schema, executed by your app` |
| `CREATE NEW` | `Create with AI` | `Describe a tool and let AI build it` — **disabled** in this build |

Tools are grouped in the panel under uppercase group headers: `CONNECTED APPS` and `BUILT-IN`.
A newly added tool carries a green `New` badge until commit. Each row has a `Remove` (trash)
button.

Default built-in tools on a newly created agent: `read`, `bash`, `edit`, `write` (4). Older
agents may carry more (`grep`, `find`, `ls`).

**`Third-party integration`** opens a dialog titled **`Add app tools`**:

| Region | Exact label |
|---|---|
| Left rail | `YOUR CONNECTIONS` (with a count) listing connected apps, then `BROWSE BY CATEGORY` with `All apps` plus category names (`developer tools`, `analytics`, `crm`, `marketing automation`, `project management`, `team collaboration`, `artificial intelligence`, `documents`, `ecommerce`, `task management`, `accounting`, `ai web scraping`, `images & design`, `file management & storage`, `productivity`, `social media marketing`, `team chat`, `ai agents`, `databases`, `customer support`, `email newsletters`, `forms & surveys`, `hr talent & recruitment`, `payment processing`, `phone & sms`, `social media accounts`, `video & audio`, `video conferencing`, `calendar`, `scheduling & booking`) |
| Main | `Search apps…`, the `ALL APPS` grid with a count (`100 of 1069`) |
| App detail | The app card with a `Connected` status, `CHOOSE AN ACTION`, `+ Connect another account`, `Search actions`, then the action list. Read-only actions carry a `READ-ONLY` badge |
| Footer | `Pick actions from a connected app — added instantly.` and a `Done` button. After adding, the footer reads `1 app tool added` |

**`Tool definition`** opens a tool editor dialog (see the permission table below for its fields).

**`Reference a workflow`** opens a dialog titled `Reference a workflow` with
`Search workflows`, the helper *"The agent calls the chosen workflow as a tool; it runs
server-side and returns its output."*, type tabs (`All`, `Completion`, `Agent`, `Evaluator`…),
the workflow list, an empty right pane reading *"Select a workflow / Preview its inputs and pick
a version before adding it as a tool."*, and footer buttons `Cancel` / `Add reference`.

#### Where per-tool permissions are set

Click any **connected-app** or **custom function** tool row to open its detail dialog. The
right pane is headed `TOOL DETAILS`:

| Field | Exact label | Values |
|---|---|---|
| Name | `Name` | e.g. `tools__composio__github__LIST_PULL_REQUESTS__github-u4u` |
| Description | `Description` | placeholder `What the tool does and when to use it` |
| Permission | `Permission` | Dropdown with exactly four options: **`Allow`**, **`Ask`**, **`Deny`**, **`Inherit`** (default `Inherit`) |
| Toggle | `Allow extra properties` | Helper: `Only the listed parameters are accepted.` |

The left pane is headed `PARAMETERS` with an `Add` button and one row per parameter
(name + JSON type). A segmented `Form` / `JSON` control sits top-right. Footer:
`Changes apply to this agent configuration`, `Cancel`, `Save`.

Built-in tools (`bash`, `read`, …) open a read-only JSON view with the subtitle
`Provider built-in tool` and **no** permission control — they are governed by the
agent-level `Permissions` policy in `Advanced` instead.

#### Skills — where skills are added and the drop target

Header summary: `None` when empty; the body then reads `No skills yet — add a skill`. The `+`
button is labelled `Add skill` and opens a dialog titled **`New skill`** with the subtitle
`Inline SKILL.md package` and a `skill` badge.

| Region | Exact label |
|---|---|
| Segmented control | `Form` / `JSON` |
| Left column | `Files` with an `Add file` (+) button and a `SKILL.md` entry |
| **Drop target** | `Drag a skill folder, .zip, or .skill here` with a `Browse files` button, and underneath: `…or paste a SKILL.md anywhere here to fill the fields` |
| Right column | `Name` (placeholder `my-skill`), `Description` (placeholder `When the agent should reach for this skill`), `SKILL.md` (rich-text editor with the same toolbar as AGENTS.md and placeholder `# My skill Step-by-step instructions the agent follows…`) |
| Toggles | `Hide from prompt`, `Allow executable files` |
| Footer | `Changes apply to this agent configuration`, `Cancel`, `Create` |

#### Advanced — see §3

#### Triggers — see §6

#### Files — see §4

### Screenshots

- `model-and-harness-panel.png` — the inline `Model & harness` panel with the `API key` / `Subscription` control and provider tiles.
- `model-picker-providers.png` — the model picker showing the nine providers and `Add custom provider`.
- `model-picker-anthropic-models.png` — the same picker with the `Anthropic` model list expanded.
- `model-and-harness-dialog.png` — the full `Model & harness` dialog with `Harness` / `Model` / `Provider credentials` and the `Pi` harness selected.
- `harness-claude-code.png` — the same dialog with `Claude Code` selected, showing its providers and hosting list.
- `credentials-subscription.png` — the `Subscription` credential mode and its `Self-managed` card.
- `instructions-agents-md-editor.png` — the `AGENTS.md` editor dialog with the `Writing a good AGENTS.md` tips and `SUGGESTED` chips.
- `tools-add-tool-menu.png` — the `Add tool` menu with all four entries.
- `tools-add-app-tools.png` — the `Add app tools` dialog, app grid and category rail.
- `tools-github-actions.png` — choosing a GitHub action, with `READ-ONLY` badges.
- `tools-panel-connected-app.png` — the Tools panel after adding an app tool (`CONNECTED APPS` group, `New` badge, state flipped to `Draft`).
- `tool-detail-permission.png` — a tool's detail dialog with the `Permission` dropdown open showing `Allow` / `Ask` / `Deny` / `Inherit`.
- `tool-definition-dialog.png` — the `Tool definition` editor (schema-only tool).
- `tool-reference-workflow.png` — the `Reference a workflow` picker.
- `skills-new-skill-dialog.png` — the `New skill` dialog including the drag-and-drop target.

---

## 3. The Advanced area and the playground build kit

### Click path

`Playground > Build > Configuration > Advanced`. The section header summary reads
`Sandbox: local`. Clicking it opens a dialog titled **`Advanced`** with three collapsible
sections and a `VERSION HISTORY` / `soon` right rail. Footer: `Draft — applies on save`,
`Cancel`, `Save`.

### The "playground build kit"

The founder's "playground build kit" is labelled in the UI as exactly **`Playground build kit`**.
It is the **first section inside the `Advanced` dialog**, with a status of `Removed on commit`
and an on/off switch (on by default).

Its description: *"These playground-only tools, skills, and permissions help the assistant build
and revise this agent. None of this is part of the published agent."*

Expanded, it lists four labelled groups:

| Group | Exact label | Contents |
|---|---|---|
| `Platform tools` | each row: tool name + `Platform-owned playground tool`, badges `platform` and `Locked` | `discover_tools`, `commit_revision`, `annotate_trace`, `query_spans`, `test_run`, `discover_triggers`, `create_schedule`, `create_subscription`, `list_schedules`, `list_deliveries`, `test_subscription`, `remove_schedule`, `remove_subscription` |
| `Embedded tools` | each row: `Provided by Agenta. This item cannot …`, badges `@ag.embed` and `Locked` | `Request connection`, `Request input` |
| `Embedded skills` | badges `@ag.embed`, `Locked` | `build-an-agent` |
| `Sandbox permissions` | | `write_files` → `allow`, `execute_code` → `allow` |

### Execution environment

Second section, labelled **`Execution environment`**. Description: *"Where the agent's tools and
code run, and what that sandbox may touch."*

| Field | Exact label | Options |
|---|---|---|
| Sandbox | `Sandbox` | `Local`, `Daytona` |
| Network egress (Daytona only) | `Network egress` | `Allow all egress`, `Block all egress`, `Allowlist (CIDR ranges)`. Choosing the allowlist reveals an `Allowlist` textarea with placeholder `10.0.0.0/8` / `192.168.0.0/16` |
| Filesystem (Daytona only) | `Filesystem` | `Read / write`, `Read-only`, `No access`. Shows `Not declared` when unset |
| Enforcement (Daytona only) | `Enforcement` | `Strict (fail if unenforceable)`, `Best effort` |

### Permissions

Third section, labelled **`Permissions`**. Description: *"What the agent may do on its own before
it must ask."*

| Field | Exact label | Options / behaviour |
|---|---|---|
| Policy | `Policy` | Exactly four options, each with a sub-line: **`Allow reads`** — *Reads run, writes ask; default*; **`Allow all`** — *Every tool runs without asking*; **`Ask`** — *A human approves every tool call*; **`Deny all`** — *Every tool call is refused* |
| Harness label | `Pi harness` (a small pill above the next field) | Names the harness whose built-ins the next field lists |
| Built-in tools | `Built-in tools` | Multi-select tags: `Read`, `Bash`, `Edit`, `Write` |
| Auto-approve | `Auto-approve` | When empty: `Nothing auto-approved — every gated tool asks each time.` Otherwise lists the granted tool patterns. Tooltip: *"Tools that run without asking. Added from an approval card's "Always allow". Everything else still prompts, and commit stays gated."* |

### Approval cards (the runtime side of permissions)

When a gated tool is called mid-run, the conversation shows a card titled
**`Approval needed to continue`**:

| Element | Exact text |
|---|---|
| Body | `The agent wants to use <Tool> before it can keep going.` |
| Collapsible | `Details` followed by the tool arguments as JSON |
| Buttons | `Deny`, `Approve` |
| Toggle | `Always allow <Tool> for this agent` with the sub-line `Applies when you approve; commit to use it in triggers.` |
| Status above the card | `Waiting for your input`; the tool row reads `<Tool>  Awaiting approval` |
| Composer while waiting | placeholder `The agent is waiting for your response — new messages will be queued` |

### Screenshots

- `advanced-playground-build-kit.png` — the `Advanced` dialog with `Playground build kit` expanded, showing the `Removed on commit` state and the `Platform tools` list.
- `advanced-build-kit-embedded-tools.png` — the rest of the build kit: `Embedded tools`, `Embedded skills`, `Sandbox permissions`.
- `advanced-execution-environment.png` — `Execution environment` with `Sandbox: Local`.
- `advanced-execution-environment-daytona.png` — the same section with `Daytona` selected, revealing `Network egress`, `Filesystem`, `Enforcement`.
- `advanced-permissions.png` — the `Permissions` section with `Policy`, `Pi harness`, `Built-in tools`, `Auto-approve`.
- `advanced-permissions-policy-options.png` — the `Policy` dropdown open with all four options and their sub-lines.
- `chat-approval-card.png` — a live `Approval needed to continue` card with `Deny` / `Approve` and `Always allow Write for this agent`.

---

## 4. Files

### Click path

`Playground > Build > Configuration > Files` (bottom of the configuration column), or the
right-hand rail button whose tooltip reads `Show files`. Once the rail is open its two buttons
are `Open the files drawer` and `Collapse panel`.

### What each thing is called

| Element | Exact label | Meaning |
|---|---|---|
| Section | `Files` | Header summary reads `<n> files`, or `No files` when empty |
| Empty state (no run yet) | `No conversation open yet — the agent's working files appear here once a chat starts.` | |
| File origin badge — durable | **`Agent`** | The agent's durable mount, shared across all of that agent's sessions. Presented in the browser as the folder **`agent-files/`** |
| File origin badge — ephemeral | **`Session`** | The session's working directory (cwd), scoped to this conversation |
| Right-rail panel (Chat mode) | `Files` with a count, an `Open the files drawer` (folder) button and a `Collapse panel` button | Lists recently touched files |
| Full drawer | breadcrumb `root` + `<n> files`, `Search files`, a file-tree toggle (`Hide file tree`), a hidden-files toggle (`Hide hidden files`), `Expand drawer`, and a `More actions` (…) menu whose single item is `Download all` | |
| Empty drive | `This drive is empty` / `Created on the conversation's first run.` | |
| Error state | `Some files couldn't be loaded` with a `Try loading files again` action | |

In the conversation itself, a file the agent produced renders as a card: the filename, a
`Created` badge, `Markdown · 70 B`-style metadata, and a `Download <filename>` button.

### Screenshots

- `config-files-section.png` — the `Files` section at the bottom of the Configuration column.
- `files-drawer.png` — the full file drawer at `root`, showing the `agent-files` folder alongside session files.
- `files-drawer-agent-files.png` — inside `agent-files/`.
- `chat-run-with-file-artifact.png` — a completed run with the `notes.md` `Created` file card in the conversation.

---

## 5. Versions

Agenta uses three names, and they are not interchangeable:

- **variant** — a named line of configuration. Every agent starts with one called `default`.
- **revision / version** — a numbered snapshot of a variant, shown as `v1`, `v2`, …
- **deployment** — a variant+revision published to an environment.

### Where you see version state

| Place | Exact label |
|---|---|
| Playground header | the variant dropdown (`default`), the version pill (`v1`), and a state dot reading `Saved` or `Draft` |
| Variant dropdown | a `Search` box, then the variant name as a group heading with its revisions listed as `v1` + a `Last modified` pill |
| Configuration header | `Commit` (disabled while `Saved`) and `Deploy` |

### Committing

`Playground > Configuration > Commit` opens a two-pane dialog:

| Pane | Exact label |
|---|---|
| Left | `What's changing` with a change count, a `View as JSON` link, and one row per changed section (e.g. `Tools` with a green `1 added` pill) |
| Right | Title `Commit <agent name>`; a `New version` / `New variant` chooser; for `New version` the explanation `Saves as version 2. Everyone using <agent> gets your changes.`; a `Commit message` textarea pre-filled with a generated summary (e.g. `Added 1 tool.`) |
| Footer | `Cancel`, `Commit` (with a split-button chevron) |

### The configuration history — the Registry

The configuration history is called the **Registry**.

Click path: `Sidebar > Agents > <agent> > Registry`.

| Control | Exact label |
|---|---|
| Page title | `Registry` |
| Top-right tabs | `Variants`, `Deployments` |
| Segmented control | `Variants` / `Revisions` |
| Actions | `Search`, `Compare`, `Deploy`, `Use API` |
| Table columns (Revisions) | `Name` (variant + `v1` + `Last modified`), `Model`, `Created on`, `Created by`, `Commit notes` |
| Deployments tab | three environment cards — `Development`, `Staging`, `Production` — each showing `Variant` and `Last modified` (or `No deployment`); plus a table with `Revision`, `Variant`, `Notes`, `Date modified`, `Modified by`, and actions `Export CSV`, `Deploy`, `Use API` |

### Deploying

`Deploy` opens a dialog titled **`Deploy variant`**: *"Select an environment to deploy `default`
`v1`"*, a table with `Environment` / `Current variant` rows for `Development`, `Staging`,
`Production`, a `Notes (optional)` field with placeholder `Add a brief summary of what changed`,
and `Cancel` / `Deploy`.

> Note: several drawers (`Model & harness`, `AGENTS.md`, `Advanced`) show a right-rail
> `VERSION HISTORY` block with a `soon` pill. That per-field history is **not implemented yet** —
> do not document it as a feature.

### Screenshots

- `commit-dialog.png` — the commit dialog with `What's changing`, `New version` / `New variant`, and the `Commit message`.
- `deploy-dialog.png` — the `Deploy variant` dialog with the three environments.
- `registry-revisions.png` — the `Registry` page, `Variants` tab, `Revisions` view.
- `registry-deployments.png` — the `Registry` page, `Deployments` tab with `Development` / `Staging` / `Production`.

---

## 6. Automations and triggers

There are two places: per-agent (in the playground) and project-wide (in Settings).

### In the playground

`Playground > Build > Configuration`. Below `Advanced` there is a plain heading **`Triggers`**
with a summary of `None`, followed by two sections:

| Section | Exact label | Quick-add button | Empty text |
|---|---|---|---|
| Event triggers | **`Subscriptions`** | `Add subscription` | `No subscriptions yet — add a subscription` |
| Scheduled runs | **`Schedules`** | `Add schedule` | `No schedules yet — add a schedule` |

#### Adding a subscription (event trigger)

`Add subscription` opens a dialog titled **`Choose a trigger`**: a `YOUR CONNECTIONS` rail, a
`Search apps…` box and an `ALL APPS` grid. Picking an app shows its connection card
(`Connected`, `· connected <date>`), `CHOOSE AN EVENT`, `+ Connect another account`, a
`Search events` box and the event list (GitHub examples: `New Workflow Artifact Created`,
`Branch Changed`, `New Branch Created`, `Check Run Status / Conclusion Changed`,
`Check Suite Status / Conclusion Changed`, `New Code Scanning Alert Created`,
`New Repository Collaborator Added`, `Commit Event`, `New Deployment Created`,
`GitHub Deployment State Changed`, …).

Picking an event opens a dialog titled **`New trigger`** with four sections:

| Section | Exact label | Fields |
|---|---|---|
| 1 | `Name` | `Trigger name` |
| 2 | `When this happens *` | The chosen event card (`<Event name>` / `via <App>`) and `Event filters` — per-event fields, e.g. GitHub's `Owner *`, `Repo *`, `Interval` (*"Periodic Interval to Check for Updates & Send a Trigger in Minutes"*) |
| 3 | `Which version runs? *` | A `Pinned` mode (*"Runs one exact variant + revision."*) and a variant select |
| 4 | `What the agent gets` | *"Write the message your agent receives. Click a field to drop in its live value."* Two columns: `EVENT FIELDS` (with a `Test event` action) and `MESSAGE` (placeholder *"Type a message and click a field on the left to insert its value..."*) |
| Footer | | `Active` toggle, `Cancel`, `Run in playground`, `Create` |

#### Adding a schedule

`Add schedule` opens a dialog titled **`New schedule`**:

| Section | Exact label | Fields |
|---|---|---|
| 1 | `Name` | `Schedule name` |
| 2 | `When should it run? *` | Cadence list `Hourly`, `Daily`, `Weekly`, `Monthly`, `Custom`; then `On these days` (`Mon`…`Sun`) and `At these times (UTC)` with a time field and an `Add time` button. A green confirmation line shows the parsed schedule and the next fire time, e.g. `Mon at 09:00 (UTC) · next 2026-08-03 09:00 UTC`. A collapsed `Active window` sub-section sets a start/end window |
| 3 | `Which version runs? *` | `Pinned` — *"Runs one exact variant + revision."* — and a variant select |
| 4 | `What should the agent do?` | A textarea (placeholder *"Summarize yesterday's support tickets and post the digest to #ops."*) with the helper *"Sent to the agent as the user message on each run."* and an `Advanced — raw JSON` link |
| Footer | | `Active` toggle, `Cancel`, `Run in playground`, `Create` |

### Project-wide

`Sidebar > Settings > Triggers`. Page title **`Triggers`**, subtitle *"Connect an app, then run
workflows automatically — when one of its events fires, or on a recurring schedule."*
Three sections:

| Section | Exact label | Description | Action |
|---|---|---|---|
| 1 | `Connections` | *"Link an app like GitHub or Slack so its events can trigger your workflows."* | `+ Connect`. Table: `Integration`, `Name`, `Slug`, `Status`, `Created at` |
| 2 | `Event triggers` | *"Run a workflow whenever an event fires in a connected app — like a new GitHub issue."* | `+ Subscribe`. Table: `Name`, `Connection`, `Event`, `Status`, `Created at`. Empty state: `No event triggers yet` |
| 3 | `Scheduled runs` | *"Run a workflow automatically on a recurring schedule — hourly, daily, or any cron cadence."* | `+ Schedule`. Table: `Name`, `Schedule`, `Window (UTC)`, `Bound workflow`, `Status`, `Created at`. Empty state: `No scheduled runs yet` |

Connected apps are also listed under `Settings > Tools` (page title `Tools`, `+ Connect`, columns
`Integration`, `Name`, `Slug`, `Status`, `Auth`, `Created at`).

### Screenshots

- `triggers-choose-a-trigger.png` — the `Choose a trigger` app picker.
- `triggers-github-events.png` — the GitHub event list under `CHOOSE AN EVENT`.
- `subscription-event-form.png` — the `New trigger` form with all four sections.
- `schedules-new-schedule.png` — the `New schedule` dialog.
- `settings-triggers.png` — `Settings > Triggers` with `Connections`, `Event triggers`, `Scheduled runs`.
- `settings-tools-connections.png` — `Settings > Tools` connection list.

---

## 7. Cost and usage

### The Usage bar on the project home

`Sidebar > Home`, below Templates. The section is called **`Usage`**.

Collapsed it is a single row: a date-range button (default label `Last 1 month`), then
`Requests`, `Latency`, `Cost`, `Tokens` with their values, and an `Expand` / `Collapse` control.

Expanded it shows four charts:

| Card | Exact stat labels |
|---|---|
| `Requests` | `Total:` and `Failed:` |
| `Latency` | `Avg:` |
| `Cost` | `Total:` and `Avg:` |
| `Tokens` | `Total:` and `Avg:` |

### The agent Overview

`Sidebar > Agents > <agent> > Overview`. Same four cards — `Requests` (`Total:`),
`Latency` (`Avg:`), `Cost` (`Total:` / `Avg:`), `Tokens` (`Total:` / `Avg:`) — with a
`Last 1 month` range control, then a `Deployment` block (`Development` / `Staging` /
`Production` cards) and a `Recent Prompts` section with a `Playground` button.
Empty charts read `No data`.

### Per-message cost

Each assistant message footer in the playground shows three values inline: duration (e.g.
`3.05s`), tokens (e.g. `32.2K`) and cost (e.g. `$0.003666`).

### Traces

Traces live under **`Observability`**, available both project-wide
(`Sidebar > Observability`) and per agent (`Agents > <agent> > Observability`).

| Control | Exact label |
|---|---|
| Page title | `Observability` |
| Top-right tabs | `Traces`, `Sessions` |
| Toolbar | a refresh button, `Search`, a filter button with a count badge, a date-range button (`Last 24 hours`), and an `auto-refresh` toggle |
| Scope segmented control | `Root` / `LLM` / `All` |
| Actions | `Export`, `Delete`, `+ Add` |
| Table columns | `Name`, `Inputs`, `Outputs`, `Duration`, … (column set is configurable via the gear icon) |
| Empty state | `No traces found` / `Try adjusting your filters or time range to view traces.` |
| Sessions tab | a `All activity` / `Latest activity` segmented control; empty state `No sessions found` / `Try adjusting your filters or time range to view sessions.` |

Opening a trace row opens a full-screen drawer:

| Region | Exact label |
|---|---|
| Header | `Trace` + the trace id, and an `Add annotation queue` button |
| Left | a span tree with a `Search in tree` box; each node shows duration, cost and token count. A footer note reads `<n> spans hidden by key spans` with a `Show all` link |
| Centre tabs | `Overview`, `Raw Data`, `Linked Spans`, `Annotations` |
| Centre actions | the span id, `Playground`, `Add to testset`, `Annotate`, a delete button |
| Centre body | `inputs`, `parameters`, `outputs` blocks, each with a `Pretty JSON` format selector and a copy button |
| Right rail | `Annotations`; `Trace info` with `Type`, `Status`, `Latency`, `Timestamp` (`Start` / `End`) and **`Tokens & Cost`**; `References` with `Applications` and `Variants`; `Linked spans` |

### Where model credentials and API keys live

`Sidebar > Settings` has three groups:

- **Project**: `API Keys`, `Secrets`, `LLMs`, `Tools`, `Triggers`, `Webhooks`
- **Organization**: `General`, `Members`, `Projects`, `Access & Security`, `Audit Log`, `Usage & Billing`
- **Personal**: `Account`, `Feature flags`

`Settings > LLMs` is the model-provider key store: a `Standard providers` filter, a table with
`Name` / `API Key` / `Created at`, a `Configure now` button per unconfigured provider, and a
`+ OpenAI-compatible endpoint` button with its own table (`Name`, `Provider`, `Models`,
`Created at`). Providers listed: `OpenAI`, `Mistral AI`, `Cohere`, `Anthropic`, `Anyscale`,
`Perplexity AI`, `DeepInfra`, `Together AI`, `Aleph Alpha`, `OpenRouter`, `Groq`,
`Google Gemini`, `MiniMax`.

`Settings > Secrets` is a separate store (`+ Create`; columns `Name`, `Slug`, `Content`,
`Format`, `Created at`).

### Screenshots

- `home-usage-expanded.png` — the `Usage` section expanded with the four charts.
- `agent-overview.png` — the agent `Overview` page with the four stat cards and `Deployment`.
- `observability-traces.png` — the `Observability` `Traces` tab with real rows.
- `observability-sessions.png` — the `Sessions` tab and its `All activity` / `Latest activity` control.
- `observability-trace-detail.png` — a trace drawer with the span tree and the `Trace info` rail including `Tokens & Cost`.
- `project-observability.png` — project-wide `Observability`.
- `settings-llms.png` — `Settings > LLMs` (provider keys are masked by the product, e.g. `sk-…AAA`).

---

## 8. MCP servers (Claude Code only)

Captured 30 July 2026 against the same v0.106.1 EE dev deployment, viewport 1440 x 900.

### Why this section was missed on the first pass

The section only renders when the selected harness declares MCP support. Only **Claude Code**
does; on a **Pi** agent the section is absent from the Configuration column entirely. The first
capture pass used a Pi agent, so nothing was there to photograph.

To reach it: `Playground > Build > Model & harness > Detailed configuration`, pick **`Claude Code`**
under `Harness`, pick a model the harness can reach (the picker lists `Sonnet` and
`Opus (1M context)` among five Anthropic models; leaving a non-Anthropic model selected shows
`⚠ model not available`), then `Save`. The section appears immediately.

### The section in the Configuration column

| Fact | What the product says |
|---|---|
| Section heading | **`MCP servers`** |
| Position | Between `Tools` and `Skills`, so the full order on a Claude Code agent is `Model & harness` → `Instructions` → `Tools` → **`MCP servers`** → `Skills` → `Advanced` |
| Right-hand summary when empty | `None` |
| Add control | A `+` icon button whose tooltip reads **`Add MCP server`**. There is no text button |

Note this corrects the section list in §2, which was captured on a Pi agent and therefore runs
`Tools` → `Skills` with no MCP row.

### The new-server drawer

Clicking `+` opens a right-side drawer straight away. There is no intermediate picker or menu.

| Fact | What the product says |
|---|---|
| Title | **`New MCP server`**, and it rewrites itself to the server name as soon as you type one (typing `internal-search` changes the title to `internal-search`) |
| Badge next to the title | `MCP server` |
| Subtitle | `Model Context Protocol server` |
| View toggle, top right | Segmented control `Form` / `JSON`, defaulting to `Form` |
| Footer left | `Changes apply to this agent configuration` |
| Footer buttons | `Cancel` and **`Create`**. `Create` stays disabled until the form is valid |

Fields, in the order they appear:

| # | Label | Control | Placeholder / options |
|---|---|---|---|
| 1 | `Server name` | Text input | Placeholder `exa` |
| 2 | `MCP URL` | Text input | Placeholder `https://example.com/mcp` |
| 3 | `Authentication` | Dropdown, defaults to `None` | `None`; `Secret header`; `OAuth`, greyed out with a `Soon` tag on the right |
| 4 | `Header name` | Text input with an info icon | Only shown when `Authentication` is `Secret header`. Placeholder `x-api-key` |
| 5 | `Project secret` | Dropdown with an info icon | Only shown when `Authentication` is `Secret header`. Placeholder `Select a project secret`. With no secrets in the project the list reads `No project secrets found` |

`Settings > Secrets` is confirmed: it sits under the `Project` group in the settings sidebar,
the page is titled `Secrets`, the table columns are `Name`, `Slug`, `Content`, `Format`,
`Created at`, and the button is `+ Create`.

### Where the source-derived guide was wrong

1. **The heading is `MCP servers`, not `MCPs`.** The code falls back to the string `MCPs` in
   `AgentTemplateControl.tsx`, but the live config schema supplies `MCP servers`, and that is
   what renders. The commit-diff summary code still says `MCPs`, so that label may show up in
   version-history text; the configuration column does not use it.
2. **The confirm button is `Create`, not `Save`.** The drawer footer reads `Cancel` / `Create`.
3. **`Add MCP server` is a tooltip, not button text.** The visible control is a bare `+`.
4. **The drawer title is not fixed.** It starts as `New MCP server` and becomes the server name
   as you type, so a reader who typed a name first will not see `New MCP server` on screen.
5. **The `Form` / `JSON` toggle and the `MCP server` badge were not in the source-derived guide.**

Everything else held: the field labels, their order, the three `Authentication` options with
`OAuth` disabled and tagged `Soon`, the conditional `Header name` and `Project secret` fields,
and the fact that the key is referenced by project secret rather than pasted in.

### Screenshots

- `mcp-section.png` — the `MCP servers` row in the Configuration column of a Claude Code agent,
  with the `Add MCP server` tooltip showing on the `+` button.
- `mcp-new-server-drawer.png` — the drawer with `Authentication` set to `Secret header`, so all
  five fields are visible. Values are fictional (`internal-search`, `https://mcp.example.com/sse`,
  `x-api-key`); no secret was selected because the demo project has none.

---

## Not found

Things from the seven areas that I could not locate, or that exist only as placeholders:

1. **Per-field version history.** The `Model & harness`, `AGENTS.md` and `Advanced` drawers each
   show a right-rail block labelled `VERSION HISTORY` with a `soon` pill and skeleton rows. It is
   not functional. The only working configuration history is the **Registry** page.
2. **Multiple instruction files.** The `+` next to `Instructions` is permanently disabled with
   the tooltip `Multiple instruction files coming soon`. Only `AGENTS.md` exists today.
3. **`Create with AI` for tools.** Present in the `Add tool` menu with the sub-label
   `Describe a tool and let AI build it`, but disabled in this build.
4. **A skills catalog / marketplace.** `Add skill` goes straight to the `New skill` authoring
   dialog. There is no browse-existing-skills picker equivalent to `Add app tools`.
5. **Skills drag-and-drop outside the dialog.** The drop target
   (`Drag a skill folder, .zip, or .skill here`) exists **only inside** the `New skill` dialog.
   I found no drop target on the `Skills` section row itself.
6. **The `Deliveries` view for triggers.** The build-kit tool list includes `list_deliveries`,
   but I found no Deliveries table in `Settings > Triggers` or in the playground.
7. **`Evaluations` / `Evaluation`.** Present in both navs; out of scope for this pass and not
   documented here.
8. **Trigger "deliveries"/run history for a schedule.** Not verified — no schedule was created.
9. **The `Sessions` observability tab with data.** The tab exists and its controls are recorded,
   but every agent I checked showed `No sessions found`, so I could not confirm its column names.
10. **`Usage & Billing`.** Listed in `Settings > Organization`; not opened (EE billing screen,
    likely out of scope for agent docs).
11. **What the `Archived` toggle on the `Agents` list does.** Recorded as a control; behaviour
    not verified.
