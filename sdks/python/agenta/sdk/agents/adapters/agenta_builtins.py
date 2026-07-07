"""The Agenta harness's forced defaults: the things ``AgentaHarness`` always applies.
(``ClaudeHarness`` shares the AGENTS.md preamble and forced platform skills; the persona and
forced tools remain Pi-only — see :mod:`.harnesses`.)

``AgentaHarness`` is Pi with an opinion. It is the same engine as :class:`PiHarness`, but
every run carries a fixed set of Agenta-shipped extras the author cannot turn off:

- a base **persona** appended to Pi's system prompt (``AGENTA_FORCED_APPEND_SYSTEM``),
- a base **AGENTS.md preamble** the author's instructions are appended to (``AGENTA_PREAMBLE``),
- a set of **forced tools** (``AGENTA_FORCED_TOOLS``),
- a set of **forced platform skills** (``AGENTA_FORCED_SKILLS``).

The forced platform skills are the actually-forced part of "forced skills". The default agent
config template embeds the platform default skill by reserved ``__ag__*`` slug, but that embed
only rides the *default* template: a custom ``pi_agenta`` config that drops the embed would
otherwise lose the platform skill entirely. To make "forced" mean forced, ``AgentaHarness``
unions ``AGENTA_FORCED_SKILLS`` into every run's skills via :func:`force_skills`, regardless of
what the author's config carries. The canonical skill content lives here (in the SDK, the lowest
layer); the server-side ``StaticWorkflowCatalog`` imports the same constant so the embed path
and the forced path stay one source of truth.

Two layers, kept distinct on purpose (matching Pi's own split, see :class:`PiAgentTemplate`):
the *persona* is an ``append_system`` (changes Pi's base prompt), while *project conventions*
belong in ``AGENTS.md``. ``AGENTA_PREAMBLE`` is the AGENTS.md layer; ``AGENTA_FORCED_APPEND_SYSTEM``
is the persona layer.
"""

from __future__ import annotations

from typing import List, Optional

from ..skills import SkillFile, SkillTemplate

# The base AGENTS.md preamble. The author's own ``instructions`` are appended after this, so
# the final AGENTS.md is ``AGENTA_PREAMBLE`` + the author's project conventions.
#
# TODO(product): replace this placeholder with the real Agenta AGENTS.md preamble.
AGENTA_PREAMBLE = """\
# Agenta agent

You are an agent running on the Agenta platform. The instructions below are Agenta's
baseline; the user's own instructions follow and take precedence where they are more
specific.

- Prefer the tools and skills provided to you over guessing.
- When a skill matches the task, read its SKILL.md fully before acting.
- Keep answers grounded in what the tools and skills actually return."""

# The base persona, always appended to Pi's built-in system prompt (never replaces it). This
# is the "who the agent is" layer, distinct from the AGENTS.md project-context layer above.
#
# TODO(product): replace this placeholder with the real Agenta persona framing.
AGENTA_FORCED_APPEND_SYSTEM = """\
You are an Agenta agent. Be precise, cite what your tools and skills return, and do not
fabricate results."""

# Built-in tools the Agenta harness forces, unioned with the agent's resolved tools. These
# grants are load-bearing on the wire: once ANY custom tool ships in ``request.tools``, the
# runner flips Pi's builtin gating from "Pi defaults" to granted-only. So ``read`` and
# ``bash`` must be granted explicitly wherever build-kit tools ship (e.g. the playground
# overlay), or Pi loses them — skills are then announced but unloadable (``read`` loads
# SKILL.md; ``bash`` runs skill helper scripts).
AGENTA_FORCED_TOOLS: List[str] = ["read", "bash"]

# Reserved slug of the platform default skill. The default agent config template embeds the
# skill by this slug; the server-side StaticWorkflowCatalog resolves the slug to the
# SkillTemplate below. Kept here so the catalogue and the forced path share one slug constant.
GETTING_STARTED_WITH_AGENTA_SLUG = "__ag__getting_started_with_agenta"
BUILD_AN_AGENT_SLUG = "__ag__build_an_agent"

# Canonical SKILL.md body for the platform "getting started" skill. Single source of the body
# text: the server-side StaticWorkflowCatalog imports this constant rather than redeclaring it.
_GETTING_STARTED_BODY = (
    "# Getting started with Agenta agents\n"
    "\n"
    "This skill orients an agent running on the Agenta platform.\n"
    "\n"
    "## When to use it\n"
    "\n"
    "Use it at the start of a task to recall how Agenta agents are expected to behave: be "
    "concise, ask for missing inputs, and prefer the tools and skills the agent was given over "
    "guessing.\n"
    "\n"
    "## Conventions\n"
    "\n"
    "- Greet the user once, then get to work.\n"
    "- State assumptions briefly when a request is ambiguous.\n"
    "- When a skill or tool references a relative path, resolve it against the skill directory "
    "(the parent of SKILL.md) before running it.\n"
    "- Keep answers short unless the user asks for depth.\n"
)

# The platform default skill as a concrete inline package. This is the canonical content; the
# server-side catalogue serves the same SkillTemplate for the reserved slug above.
GETTING_STARTED_WITH_AGENTA_SKILL = SkillTemplate(
    name="agenta-getting-started",
    description=(
        "Getting started on the Agenta platform: how an Agenta agent should behave, ask for "
        "missing inputs, and use its tools and skills. Use at the start of a task."
    ),
    body=_GETTING_STARTED_BODY,
)

# Bundled reference file: the exact shape of `parameters.agent`. Sourced field-by-field from
# `AgentTemplateSchema` + the `ToolConfig` union + `SkillTemplate` (sdks/python/agenta/sdk/utils/
# types.py and agents/tools/models.py, skills/models.py) so the model reads the real shape instead
# of guessing against an `additionalProperties: true` commit schema. A drift test (test_agenta_
# builtins_reference_files.py) asserts this text names every top-level template field and every
# tool `type`, so a schema that grows without updating this file fails CI.
_CONFIG_SCHEMA_REFERENCE = """\
# The agent config, field by field

Read this before your first `commit_revision`, and whenever a run misbehaves after a commit and
you need to check the shape.

`parameters.agent` is one object. You edit it by sending only the changed fields under
`commit_revision`'s `workflow_revision.delta.set.parameters.agent`. The portable definition —
`instructions`, `llm`, `tools`, `mcps`, `skills` — is flat on it; the execution parts —
`harness`, `runner`, `sandbox` — are nested sub-objects. The commit does NOT validate this shape:
a misplaced or misspelled field commits fine and only bites when the agent next runs. Get the
shape right from this reference, and verify with `test_run` after every commit.

## The whole object

```json
{
  "instructions": { "agents_md": "<who you are and what you do>" },
  "llm": { "model": "gpt-5.5", "provider": "openai", "connection": { "mode": "agenta" } },
  "tools": [],
  "mcps": [],
  "skills": [],
  "harness": { "kind": "pi_agenta" },
  "runner": { "kind": "sidecar", "permissions": { "default": "allow_reads" } },
  "sandbox": { "kind": "local" }
}
```

The example above shows one common setup; your own `harness` may be `pi_agenta`, `claude`, or
`pi_core`. Whatever it is, keep `harness`, `runner`, `sandbox`, and `llm` as they are unless the
user explicitly asks to change one.

## The fields you decide

### instructions

`instructions.agents_md` — a Markdown string, your AGENTS.md: who you are and what you do. Write
only your own project conventions here — the platform supplies its own baseline framing (on
`pi_agenta` and `claude`, a fixed Agenta preamble is prepended automatically). One or two
sentences for a simple agent; an explicit numbered procedure for a multi-tool or scheduled one
(see the instruction-writing section of SKILL.md).

### llm

You almost never touch `llm` in a delta. Keep it exactly as it is unless the user explicitly asks
to change the model, provider, or connection. The rules below matter only when they do ask:

- `model` — the model. How you NAME it depends on the harness (this is the trap):
  - `pi_core` / `pi_agenta`: a real model id, e.g. `gpt-5.5` or `anthropic/claude-...`
    (provider/id selection).
  - `claude`: an alias — `default`, `sonnet`, `opus`, or `haiku` — never a raw model id.
- `provider` — the provider family (`openai`, `anthropic`, ...); inferred from the model string
  when unset. The `claude` harness reaches `anthropic` only.
- `connection` — `{ "mode": "agenta" | "self_managed", "slug": "<vault-connection>" }`. `agenta`
  uses an Agenta vault connection (omit `slug` for the project default); `self_managed` means the
  harness owns its own auth. Omit the whole object for the project default.
- `extras` — neutral model knobs passed through unchanged (e.g. `reasoning_effort`).

### tools

A list of tool entries, each discriminated on `type`. Every entry may also carry two shared
optional fields: `render` (a UI hint) and `permission` (`allow` / `ask` / `deny`, overriding the
runner default for that one tool). The six `type` values:

- `builtin` — a harness built-in: `{ "type": "builtin", "name": "read" }`. (A per-builtin
  `permission` is dropped — builtins are granted by selection, not gated.)
- `gateway` — a server-side gateway action (Composio). Do not hand-write it: run `discover_tools`
  and copy what it returns, adding the `connection` slug once the connection is ready.
  `{ "type": "gateway", "provider": "composio", "integration": "github",
     "action": "GET_AN_ISSUE", "connection": "<connection-slug>" }`. `name` is optional.
- `code` — sandboxed code you supply: `{ "type": "code", "name": "...", "runtime":
  "python"|"node", "script": "...", "input_schema": {...}, "secrets": [...] }`.
- `client` — a tool the caller fulfills: `{ "type": "client", "name": "...", "description":
  "...", "input_schema": {...} }`.
- `reference` — another Agenta workflow run as a tool. `ref_by` picks which revision runs:
  - `{ "type": "reference", "ref_by": "variant", "slug": "my-summarizer" }` — runs that
    variant's LATEST revision, following every new commit.
  - `{ "type": "reference", "ref_by": "variant", "slug": "my-summarizer", "version": "3" }` —
    pins revision 3; later commits do not change what runs.
  - `{ "type": "reference", "ref_by": "environment", "slug": "my-summarizer",
       "environment": "production" }` — runs whatever is deployed in that environment (and must
    NOT set `version`; the environment is the pin).
  Optionally add the model-facing surface: `name`, `description`, and `input_schema`.
- `platform` — an existing Agenta endpoint exposed as a tool: `{ "type": "platform", "op":
  "discover_tools" }`. The catalog owns everything else about it.

### mcps

Declared MCP servers. Each: `{ "name": ..., "transport": "stdio"|"http", "command"/"args"
(stdio) or "url" (http), "env", "secrets", "tools", "permission" }`. Secret env resolves from the
vault at run time; tokens never live in the config.

### skills

A list; each entry is either an inline skill template or an `@ag.embed` reference.

An inline skill template:

```json
{ "name": "clear-writing",
  "description": "When to use this skill (one line — the trigger).",
  "body": "# Title\\n\\nThe know-how, in Markdown.",
  "files": [ { "path": "references/checklist.md", "content": "...", "executable": false } ],
  "disable_model_invocation": false,
  "allow_executable_files": false }
```

- `name` — required, kebab-case, <=64 chars (`^[a-z0-9]+(-[a-z0-9]+)*$`).
- `description` — required, <=1024 chars: the trigger the model matches.
- `body` — required, the SKILL.md Markdown after the composed frontmatter, <=50000 chars.
- `files` — optional bundled files, each `{ path, content, executable? }`. `path` is a relative
  POSIX path (no leading `/`, no backslash, no `..` segment, and not `SKILL.md`), <=255 chars.
  `content` is inline UTF-8, <=200000 chars. `executable` marks +x, honored only when
  `allow_executable_files` is set and the sandbox policy allows it. A folder is just `/`-joined
  segments in `path`; there is no separate folder object.
- `disable_model_invocation` — hide from the prompt (invoke only via `/skill:name`).
- `allow_executable_files` — default deny; the sandbox policy must also allow execution.

An `@ag.embed` reference points at a stored skill the backend inlines into that same shape before
the run:

```json
{ "@ag.embed": { "@ag.references": { "workflow": { "slug": "<skill-slug>" } },
                 "@ag.selector": { "path": "parameters.skill" } } }
```

## The execution parts (keep as-is unless asked)

- `harness` — `{ "kind": "pi_core" | "pi_agenta" | "claude", "permissions": {...}, "extras":
  {...} }`. `permissions` gates tool use on gating harnesses (Claude): `{ "default_mode":
  "default"|"acceptEdits"|"plan"|"bypassPermissions", "allow": [...], "ask": [...], "deny":
  [...] }`. Pi harnesses leave `permissions` empty and read prompt overrides (`system` /
  `append_system`) from `extras`.
- `runner` — `{ "kind": "sidecar", "permissions": { "default": "allow"|"ask"|"deny"|
  "allow_reads" }, "extras": {...} }`. `allow_reads` (the default) runs read-hinted tools and
  asks for everything else.
- `sandbox` — `{ "kind": "local" | "daytona", "permissions": {...}, "extras": {...} }`.
  `permissions` (optional) is the security boundary: `{ "network": { "mode": "on"|"off"|
  "allowlist", "allowlist": ["<CIDR>"] }, "filesystem": "on"|"readonly"|"off", "enforcement":
  "strict"|"best_effort" }`.

## How a delta commits (merge semantics)

`commit_revision` sends `workflow_revision.delta.set` and an optional `delta.remove`:

- `set` **deep-merges** onto your current config: a nested object key you leave out keeps its old
  value.
- **Lists replace wholesale.** `tools`, `skills`, and `mcps` are NOT merged item by item — the
  list you send REPLACES the old one. To add one tool, send the full list (your current entries
  plus the new one). Sending only the new tool wipes the rest, including the platform ops you
  configure yourself with — which severs them on your next run.
- `remove` takes dotted paths, e.g. `parameters.agent.tools`.

## Mistakes that break your agent

The commit accepts whatever you send — none of these return a validation error. Each one commits
fine and then bites later, at a different spot. Your two detectors are `test_run` (read the
`resolved` block and the executed tool list, not just the status) and a skill that fails to load
on the next run.

- `slug` or `content` as top-level fields on a skill entry. The skill's Markdown goes in `body`;
  a bundled file's text goes in that file's `content` inside `files`. Bites at RUN time: skill
  parsing rejects the unknown keys and the run fails to load the skill.
- Any unknown or misspelled key in a skill entry or a tool entry. Same failure point: the run
  rejects the entry when it parses the config, not the commit.
- `harness.kind: "claude"` paired with a non-Anthropic `provider`. Claude reaches `anthropic`
  only. Bites at RUN time: the run's Model & Harness never resolves and the agent never runs.
- A raw model id on the `claude` harness (Claude selects by alias) or an alias like `sonnet` on a
  `pi_core`/`pi_agenta` harness (Pi selects by provider/id). Bites silently: the run falls back
  to a default model with no error. Only `test_run`'s `resolved` block shows the fallback.
- Sending a short `tools`/`skills`/`mcps` list. Bites on the NEXT run: lists replace wholesale,
  so everything you left out is gone — including the platform ops you configure yourself with.
- Rebuilding the whole `parameters.agent` object instead of a narrow delta. Prefer a `delta.set`
  that touches only what you change, so `harness`, `runner`, `sandbox`, and `llm` survive the
  deep merge untouched.

## Example requests

These are complete `commit_revision` payloads, ready to adapt. Field names match exactly; only the
values are placeholders. Most of the time you change only `instructions` and `skills` — the first
two examples cover the common case.

Instructions only, the minimal two-step case — just a persona and a task:

```json
{
  "workflow_revision": {
    "message": "Set the agent's persona: triage inbound support emails.",
    "delta": {
      "set": {
        "parameters": {
          "agent": {
            "instructions": {
              "agents_md": "You triage inbound support emails. For each email: (1) classify it as bug, billing, or question; (2) draft a one-paragraph reply; (3) hand off billing issues instead of answering them."
            }
          }
        }
      }
    }
  }
}
```

Adding a skill entry — an inline skill template with one bundled reference file. `skills` replaces
wholesale too, so include your existing entries (this example assumes the list was empty):

```json
{
  "workflow_revision": {
    "message": "Add a code-review-checklist skill.",
    "delta": {
      "set": {
        "parameters": {
          "agent": {
            "skills": [
              {
                "name": "code-review-checklist",
                "description": "Use when reviewing a pull request for style and correctness issues.",
                "body": "# Code review checklist\\n\\nWalk every changed file against `references/checklist.md` before approving.\\n",
                "files": [
                  {
                    "path": "references/checklist.md",
                    "content": "- No commented-out code\\n- Tests cover the new branch\\n- Error messages are actionable\\n"
                  }
                ]
              }
            ]
          }
        }
      }
    }
  }
}
```

Adding ONE gateway tool — `tools` replaces wholesale, so resend every entry you already have (the
forced builtins, your existing platform ops, any `@ag.embed` tool) plus the new one. The gateway
entry is copied from what `discover_tools` returned, with the `connection` slug filled in.
CAVEAT: the list below is SHORTENED to keep the example readable — in a real commit, resend your
ENTIRE current tools list, every entry you have, not this subset:

```json
{
  "workflow_revision": {
    "message": "Add the GitHub create-issue tool alongside the existing build-kit tools.",
    "delta": {
      "set": {
        "parameters": {
          "agent": {
            "tools": [
              { "type": "builtin", "name": "read" },
              { "type": "builtin", "name": "bash" },
              { "type": "platform", "op": "discover_tools" },
              { "type": "platform", "op": "commit_revision" },
              { "type": "platform", "op": "test_run" },
              { "@ag.embed": { "@ag.references": { "workflow": { "slug": "__ag__some_tool" } },
                                "@ag.selector": { "path": "parameters.tool" } } },
              {
                "type": "gateway",
                "provider": "composio",
                "integration": "github",
                "action": "GITHUB_CREATE_AN_ISSUE",
                "connection": "conn_9f3a1c",
                "name": "create_github_issue"
              }
            ]
          }
        }
      }
    }
  }
}
```

Dropping one field with `delta.remove` — a dotted path, no `set` required:

```json
{
  "workflow_revision": {
    "message": "Drop the reasoning_effort override; use the model's default again.",
    "delta": {
      "remove": ["parameters.agent.llm.extras.reasoning_effort"]
    }
  }
}
```

Don't forget:

- Re-send the complete list for `tools`, `skills`, and `mcps`. A one-entry list wipes the rest,
  including the platform ops you rely on every run.
- Copy `@ag.embed` entries through unchanged; do not try to inline or edit what they point at.
- `message` is a real commit message. Say what changed and why, not a placeholder.
- After the user connects an integration, re-run `discover_tools` before committing the tool, so
  the `connection` slug is current.
- Keep `harness`, `runner`, `sandbox`, and `llm` out of `delta.set` unless you are intentionally
  changing them; a narrow delta preserves them through the deep merge.
"""

# Bundled reference file: the `inputs_fields` template language. Verified against the runtime
# resolver (agenta.sdk.utils.resolvers.resolve_target_fields / resolve_json_selector) and the
# triggers dispatcher context builder (api/oss/src/tasks/asyncio/triggers/dispatcher.py +
# core/triggers/dtos.py TRIGGER_CONTEXT_FIELDS / SUBSCRIPTION_CONTEXT_FIELDS + the synthetic
# schedule event in core/triggers/service.py). Reality matched the external kit 1:1.
_TRIGGER_INPUTS_REFERENCE = """\
# What a schedule or subscription passes to the run

Read this when you create a schedule or subscription (`create_schedule` / `create_subscription`)
and need to control the `inputs_fields` template — the inputs your agent receives on each fire.

## The template (`inputs_fields`)

Both trigger kinds carry an optional `inputs_fields` template. On each fire the platform walks it
and resolves every leaf against the fire context (below):

- A leaf string starting with `$` is a **JSON Path** over the context (it must begin `$`, `$.`,
  or `$[`).
- A leaf string starting with `/` is a **JSON Pointer** over the context.
- **Every other leaf passes through literally** — plain strings, numbers, nested objects. There
  is **no string interpolation**: `"Summarize $.event.attributes"` stays that literal text. A
  selector must be the WHOLE leaf, not embedded inside a larger string.
- A selector that resolves to nothing becomes `null` (no error).
- If you **omit** `inputs_fields` entirely, the run receives the whole context object as its
  inputs.

## The fire context

```json
{
  "event":        { "event_id", "event_type", "timestamp", "created_at", "attributes" },
  "subscription": { "id", "name", "tags", "meta", "created_at", "updated_at" },
  "scope":        { "project_id" }
}
```

`subscription` holds the firing schedule's or subscription's own header fields — for a schedule
too, the key is still `subscription`. Only these keys are exposed; connection internals and
secrets never reach the template.

## A schedule fire (synthetic event)

On a cron tick the `event` is synthetic:

- `event.event_id` — `"<schedule_id>:<tick ISO timestamp>"` (the dedup key).
- `event.event_type` — the `event_key` you gave `create_schedule`.
- `event.attributes` — `{ "timestamp": "<tick ISO timestamp>" }`, nothing more.

A schedule has no payload worth mapping; the useful part of the template is the literal message
you want the agent to receive.

## A subscription fire (provider event)

On a provider event:

- `event.event_type` — the provider trigger slug.
- `event.attributes` — the provider's event payload (the GitHub issue, the Slack message). This
  is the part you map into the run.

## The canonical pattern

Your agent reads its task from `inputs.messages` (the same shape `test_run` uses). Give every
trigger an explicit imperative `messages` entry so the run starts from a command, not an empty
context.

A schedule that runs a fixed job every fire:

```json
{ "messages": [ { "role": "user", "content": "Run the daily digest now." } ] }
```

A subscription that hands the agent the provider payload alongside a fixed instruction (no
interpolation, so the payload rides as a SIBLING key, not inlined into the message):

```json
{
  "messages": [ { "role": "user", "content": "Triage the GitHub issue in inputs.event." } ],
  "event": "$.event.attributes"
}
```

Passing no `inputs_fields` at all gives the agent the raw context object as inputs — fine for a
smoke test, but a real agent should get an explicit `messages` entry so the run starts from an
imperative instruction.

## Example requests

These are complete `create_schedule` / `create_subscription` payloads, ready to adapt. Write the
fields exactly as shown here — top-level `name` / `data` / ... — not wrapped in an outer key.

`create_schedule` — a weekday-morning cron tick with a fixed instruction:

```json
{
  "name": "daily-digest",
  "description": "Runs the daily support digest every weekday morning.",
  "data": {
    "event_key": "daily_digest_tick",
    "schedule": "0 8 * * 1-5",
    "inputs_fields": {
      "messages": [
        { "role": "user", "content": "Run the daily digest now." }
      ]
    }
  }
}
```

`create_subscription` — a provider event, with the payload mapped alongside a fixed instruction:

```json
{
  "name": "github-issue-triage",
  "description": "Fires when a new issue is opened in the connected repo.",
  "connection_id": "conn_9f3a1c",
  "data": {
    "event_key": "GITHUB_ISSUE_OPENED",
    "trigger_config": { "owner": "agenta-ai", "repo": "agenta" },
    "inputs_fields": {
      "messages": [
        { "role": "user", "content": "Triage the GitHub issue in inputs.event." }
      ],
      "event": "$.event.attributes"
    }
  }
}
```

Don't forget:

- A selector must be the WHOLE leaf. `"Summarize $.event.attributes"` stays that literal text; put
  the selector on its own key instead.
- Give every trigger an explicit imperative `messages` entry so the run starts from a command, not
  raw context.
- `schedule` is five fields, UTC, with a one-minute floor. Convert the user's timezone yourself
  before writing it.
- Map the provider payload as a sibling key, such as `"event": "$.event.attributes"`, never inlined
  into the message text.
"""


_BUILD_AN_AGENT_BODY = """\
# Build an Agenta agent

You turn a plain-language request into a working, verified Agenta agent. You are configuring
yourself: the committed template you edit is the agent that will keep running. Optimize for the
fewest calls and the least time. A simple no-tool ask is two actions: write better
`instructions.agents_md`, then call `commit_revision`.

## When to use

Use this when the user asks you to build, set up, configure, or automate an agent.

## The shape of your config

You decide four things under `parameters.agent`:

- `instructions.agents_md`: who you are and what you do.
- `tools`: integration actions and platform ops you can call.
- `skills`: reusable know-how packaged as skill templates.
- A trigger: either a schedule or an event subscription, only when the user asked for one.

Everything else is fixed unless the user explicitly asks to change it. Configure yourself with
`commit_revision` by setting `parameters.agent` fields; do not create a separate app.

Read `references/config-schema.md` before your first `commit_revision`. It gives:

- the exact shape of every field,
- the tool-entry types,
- the skill-entry shape,
- the delta merge semantics,
- the mistakes that break your agent.

Read `references/trigger-inputs.md` before you write a schedule or subscription's
`inputs_fields`.

## Decision table

| The ask... | Needs | What to add |
|---|---|---|
| transform text the user pastes, such as summarize, rewrite, classify | nothing extra | `instructions.agents_md` only |
| apply reusable know-how, such as a style guide or review rubric | a skill | one `skills` entry |
| read or write in an outside tool, such as GitHub or Slack | gateway tools | `discover_tools`, then `tools` entries |
| run on a clock | a schedule | `create_schedule` after committing |
| react to an outside event | a subscription | `discover_triggers`, then `create_subscription` |

Do not discover tools or triggers for an ask that does not need them.

## The loop

1. Clarify the ask. Get the missing timezone, channel, repo, account, output style, and success
   criteria. Do not guess concrete destinations. When you need typed values the user must
   confirm — which actions to enable, non-secret settings such as a subdomain or workspace,
   schedule details — ask with `request_input` (renders an inline form) instead of prose.
   Never request secrets through it; credentials go through `request_connection`.
2. Decide from the table. Most agents need only instructions. If the ask needs outside actions,
   call `discover_tools` with one short fragment per capability, such as "list github issues" or
   "post a slack message".
3. Read discovery as a search result, not an oracle. It is a high-recall keyword match over the
   live catalog, so check three things before wiring anything:
   - Per-integration connection state is authoritative, not the headline match. The primary match
     can be the wrong integration while reporting ready, and the tool you wanted can sit in
     `alternatives` with `needs_auth`. Trust the per-integration connection block, not the top
     `ready` line.
   - Right integration is not enough — read the matched event's description. A fragment like "new
     github issue" can match a `..._ARTIFACT_CREATED` event on the shared word "created" with a
     ready connection. Confirm the matched action or event actually does what the user asked.
   - If nothing in the match or its alternatives plausibly corresponds, stop and tell the user the
     integration does not support that action yet. Never wire the closest keyword hit.
4. If a needed connection is not ready, call `request_connection` for that integration and stop.
   Give the user the connection request and wait for them. Re-run `discover_tools` after they
   connect; do not silently create, fake, or skip connections.
5. Configure yourself. Put the chosen `capability.tool` entries and needed alternatives in
   `tools`, write `instructions.agents_md`, and call `commit_revision`. This is an approval stop.
   If the commit is denied or fails, earlier connections or triggers are not undone.
6. Verify with `test_run`. First warn the user that this is a real run: external write tools may
   perform their action if approved. Then call `test_run` with `inputs.messages` as a blunt
   instruction-framed test message and `expectations.terminal_tool` set to the final tool that
   proves success. Read `verdict`, `verdict_reason`, `tools`, `approvals`, and `resolved`; a 200
   response is not proof. The four verdicts:
   - `pass` — the terminal tool ran and returned; done.
   - `incomplete` — the run stopped short (did the early reads, then wandered or stopped before the
     terminal action). Rewrite `instructions.agents_md` as a blunter numbered procedure, call
     `commit_revision`, and run `test_run` again.
   - `unconfirmed` — the terminal tool's completion could not be proven: it was dispatched but
     never returned a result (the stalled-approval signature), or no `expectations.terminal_tool`
     was set. A tool NAME appearing in the executed list is not proof it completed. If `approvals`
     is non-empty this is an approval stop: report the waiting gate and wait for the user.
   - `failed` — a tool errored or the run failed outright; read `verdict_reason` and fix.

   For an EXTERNAL WRITE, even a returned result is only truly confirmed by reading the side effect
   back (fetch the channel history, re-read the issue). Use `query_spans` to read back SCHEDULED
   run spans after a schedule or subscription fires.
7. Add a trigger only if asked. For schedules, cron is UTC, five fields, with a one-minute floor;
   convert the user's timezone yourself, then stop for approval before `create_schedule`: say what
   you are about to create and wait for the gate. After approval, call `create_schedule`, then
   confirm with `list_schedules`. For events, call `discover_triggers`, ensure the integration is
   connected, then stop for approval before `create_subscription`: say what you are about to create
   and wait for the gate. After approval, call `create_subscription`, and confirm with
   `list_deliveries`. `test_subscription` waits for a real event, so warn the user before using it
   in a chat turn. Use `remove_schedule` or `remove_subscription` only when cleaning up a wrong
   trigger. Shape the run's inputs with `inputs_fields` (see `references/trigger-inputs.md`).
   Triggers do NOT follow a new revision: after any later `commit_revision`, existing schedules and
   subscriptions still point at the old revision, so re-point them to the new one.
8. Report short: what you became, what is connected, what is scheduled, what you verified, and
   what still needs the human.

## Writing instructions for multi-tool and scheduled agents

When you write `instructions.agents_md` for a multi-tool or scheduled agent, write an explicit
numbered procedure that names the exact tools in order, pins concrete ids, and ends on the
terminal action.

Example:

> Every run, do exactly these steps and nothing else: (1) call LIST_REPOSITORY_ISSUES for
> owner/repo X; (2) call LIST_COMMITS for X; (3) write a 3-bullet digest; (4) call SEND_MESSAGE to
> channel C0XXXX with that digest. Do not check triggers, do not stop before step 4.

- Pin concrete ids, such as channel id and repo, instead of telling the agent to re-resolve them.
- Make the final numbered step the terminal side effect, such as the post or write.
- Say "finish by doing step N" so the run does not stop after the early read steps.
- Write the persona as an explicit imperative — who the agent is and what it does, stated as a
  command, not a vague topic. On ambiguous input the harness falls back to a generic coding
  assistant instead of doing the job. (Same reason a test message is phrased as a command.)
- Prefer narrow, filtered tools over list dumps. A huge list payload (e.g. a `LIST_ALL_*` action)
  pushes the run to reach for a shell or code tool to sift it, which trips a separate
  code-execution approval gate and derails the run. Pick the narrowest action (a `FIND_*` or
  `GET_A_*` over a `LIST_ALL_*`), resolve an id once, and pin it into the instructions.

## Prefer wired tools

Prefer your wired tools (`discover_tools`, `request_input`, `request_connection`, `commit_revision`,
`test_run`, `query_spans`, `create_schedule`, `list_schedules`, `discover_triggers`,
`create_subscription`, `test_subscription`, `list_deliveries`, `remove_schedule`,
`remove_subscription`) over harness builtins. Touch Terminal, RemoteTrigger, File tools, or raw
HTTP only when your wired tools cannot do the job, and say so when you do.

## When something fails

- A denied or failed `commit_revision` does not undo earlier connections or triggers; they still
  exist. Do not redo them.
- The commit does not validate your config: a wrong shape commits fine and surfaces at run time —
  a skill fails to load, the model silently falls back, a tool goes missing. So verify with
  `test_run` after every commit: read `resolved` and the executed tool list, and when something
  is off, check the shape against `references/config-schema.md` and re-commit the fix; do not
  start over.
- After any commit, existing schedules and subscriptions still point at the previous revision.
  Re-point them so they run the new config.
- If `test_run`'s `resolved` harness or model differs from what you committed, the config silently
  fell back (usually a harness/model/provider mismatch). Fix it against `references/config-schema.md`
  and re-test.

## Footguns

- Empty output is not enough to fail a run; read the `test_run` verdict, tools, approvals,
  and verdict_reason before judging.
- Never surface raw provider slugs such as `provider_action` to the user; speak in Agenta terms.
- Re-run discovery after the user connects an integration so the committed tool gets the concrete
  connection id.
- A subscription without a ready connection never fires.
- Trigger inputs must match what the instructions expect, or the run starts empty.
"""

BUILD_AN_AGENT_SKILL = SkillTemplate(
    name="build-an-agent",
    description=(
        "Build or configure an Agenta agent end to end. ALWAYS read this skill at the start "
        "of the conversation, before your first reply, to load context on what you are and "
        "how you configure yourself. Then follow it when the user asks to set up, automate, "
        "connect tools for, schedule, or subscribe an agent."
    ),
    body=_BUILD_AN_AGENT_BODY,
    files=[
        SkillFile(path="references/config-schema.md", content=_CONFIG_SCHEMA_REFERENCE),
        SkillFile(
            path="references/trigger-inputs.md", content=_TRIGGER_INPUTS_REFERENCE
        ),
    ],
)

# Platform skills every pi_agenta run carries, regardless of the author's config. These are the
# actually-forced skills (see module docstring); unioned in by `force_skills`.
AGENTA_FORCED_SKILLS: List[SkillTemplate] = [GETTING_STARTED_WITH_AGENTA_SKILL]


def _join(*parts: Optional[str]) -> Optional[str]:
    """Join the non-empty parts with a blank line, or ``None`` when nothing remains."""
    kept = [part.strip() for part in parts if part and part.strip()]
    if not kept:
        return None
    return "\n\n".join(kept)


def compose_instructions(user: Optional[str]) -> Optional[str]:
    """The AGENTS.md the harness ships: the base preamble with the author's instructions
    appended after it."""
    return _join(AGENTA_PREAMBLE, user)


def compose_append_system(user: Optional[str]) -> Optional[str]:
    """The ``append_system`` the harness ships: the forced base persona with the author's own
    ``append_system`` appended after it."""
    return _join(AGENTA_FORCED_APPEND_SYSTEM, user)


def force_tools(builtin_tools: List[str]) -> List[str]:
    """Union the resolved built-in tools with the forced set, order-stable and de-duplicated
    (resolved tools first, then any forced tools not already present)."""
    seen = set()
    out: List[str] = []
    for name in list(builtin_tools) + AGENTA_FORCED_TOOLS:
        if name and name not in seen:
            seen.add(name)
            out.append(name)
    return out


def force_skills(skills: List[SkillTemplate]) -> List[SkillTemplate]:
    """Union the author's skills with the forced platform skills, de-duplicated by name.

    The author's skills come first and win on a name clash (a config that already carries the
    resolved platform skill — e.g. via the default template's embed — is not doubled), then any
    forced platform skill not already present is appended. This is what makes the ``_agenta``
    platform skill actually forced on a custom ``pi_agenta`` config that drops the embed."""
    seen = {skill.name for skill in skills}
    out: List[SkillTemplate] = list(skills)
    for forced in AGENTA_FORCED_SKILLS:
        if forced.name not in seen:
            seen.add(forced.name)
            out.append(forced)
    return out
