## Context

Source: `Agenta-AI/agenta` at `release/v0.122.3` `30c36d60` (2026-10-06).

### Today: an agent can only edit itself

| Behavior | Today | Evidence |
|---|---|---|
| Read config | `read_config` reads the running agent's own variant. The target is bound server-side from `$ctx.workflow.variant.id`; the model cannot name another agent. | `sdks/python/agenta/sdk/agents/platform/op_catalog.py:1558` |
| Edit config | `commit_revision` commits a delta to the running agent's own variant, bound the same way. | `op_catalog.py:1973` |
| Binding fails closed | A missing bound variant id is refused, never defaulted. | `api/oss/src/core/tools/platform_handlers.py:677` |
| Delta only | A whole configuration is refused with `full_data_not_committable`. | `platform_handlers.py:811` |
| Commit scope | Agent commits are confined to `parameters.agent`, minus harness kind, harness, runner and sandbox permissions, sandbox kind and sandbox credentials. | `api/oss/src/core/workflows/change_set.py:571-581` |
| Stale edits | An edit names the `base_revision_id` it read. A moved head is refused with a conflict, and the agent re-reads. | `api/oss/src/core/workflows/service.py:198` (`RevisionConflictError`) |
| Commit message | With ordered operations, the server derives the message from the operations. The model never writes it. | `service.py:2963`, `api/oss/src/core/workflows/commit_support.py:146` |
| Build kit | The kit is a fixed list of ops, injected into playground runs only, each set to `allow`. Per-tool choices live in the browser (change `configure-build-kit-permissions`). | `api/oss/src/core/workflows/build_kit.py:35`, `:100-104`, `:107-118` |
| Build kit UI | Each op is one row with its own copy. There is no grouping of several ops under one toggle. | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/buildKitDescriptors.tsx:38` |
| Agenta tools (the Tools picker) | A saved `agenta_tools` entry maps tool names to `allow` or `ask`. A tool not in the map is off. The resolver expands the entry into platform tools for every run. Only tools in `AGENTA_TOOLS` are accepted; `DEFAULT_AGENTA_TOOLS` is what new agents get. | `sdks/python/agenta/sdk/agents/tools/models.py:261`, `:280`, `:286`; `tools/resolver.py:196`; change `agenta-tools` |
| Agenta tools defaults on load | The playground adds the default entry to an agent that has none when it loads it. An agent that already has an entry keeps it. | `web/packages/agenta-entities/src/workflow/agentaTools.ts:8`, `:42` |
| Agenta tools UI | The section groups rows into Write and Read-only, with presets. | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/agentTemplate/AgentaToolsSection.tsx:71` |
| Listing agents | `query_workflows` exists in the catalog but is in neither the kit nor `AGENTA_TOOLS`, and it returns raw workflow artifacts. | `op_catalog.py:604`, `:1862` |
| New agent | The web app builds a new agent from the server's workflow catalog template, then commits it. There is no server-side "create agent" path. | `web/packages/agenta-entities/src/workflow/state/appUtils.ts:172-205` |
| Agent flag | Workflows carry an `is_agent` flag. | `api/oss/src/core/workflows/dtos.py:144` |

### Expected

An agent with the two new capabilities can list every agent in its project, read any agent's configuration, create a new agent, and edit any agent's configuration. Each change shows up in the target's revision history with a message that names the editing agent and the conversation.

## Goals / Non-Goals

**Goals**

- One agent can build and maintain other agents in the same project.
- Turning a capability off removes its tools. Nothing else changes.
- Reuse the self-edit path end to end: edit format, scope, conflict check, derived message.
- Every cross-agent change is traceable from the target's history.

**Non-Goals**

- Test-running another agent. Adding it as a subagent covers this for now.
- Copying, archiving, deleting or deploying an agent.
- Limiting which agents a caller can reach, or what an edit may grant.
- Changes to `read_config` or `commit_revision`.
- Reaching agents in another project.

## Decisions

### D1. Which agents can a caller reach?

| Option | Trade-off |
|---|---|
| **Any agent in the project** | Simplest. No picker. Largest blast radius. |
| An explicit list picked in the UI | Visible scope. Needs a picker and stored list. |
| Only agents it created | Very safe. Cannot maintain existing agents. |
| Any agent, permission per target | Most flexible. Most UI. |

Chosen by Mahmoud: any agent in the project.

### D2. How are the tools grouped?

| Option | Trade-off |
|---|---|
| **Two capabilities: List agents (`list_agents`) and Agent config (`read_agent_config`, `create_agent`, `edit_agent_config`)** | Listing can be on without write power. One toggle per capability. |
| One capability with all four tools | Fewer toggles. Cannot grant discovery alone. |
| One toggle per tool | Most control. Read without edit is rarely useful on its own. |

Chosen by Mahmoud. Test-run is out of scope.

### D3. Defaults

| Option | Trade-off |
|---|---|
| Build kit on with writes on ask; Tools picker off | Safer for unattended runs. Interrupts authoring. |
| **On everywhere, every tool allow** | No friction. A prompt injection can rewrite every agent silently. |
| Off everywhere | Safest. Extra step before first use. |

Chosen by Mahmoud. Each tool's permission stays editable in both places.

In practice: the build kit lists the four ops with `allow`, like every other kit op. The Tools picker is the Agenta tools section, so the four ops join `AGENTA_TOOLS` and `DEFAULT_AGENTA_TOOLS` with `allow`. Note the contrast: self-edit (`read_config`, `commit_revision`) is off by default in Agenta tools, while these are on. That is Mahmoud's choice here and is recorded so a reviewer does not "fix" it.

### D4. Can an edit widen the target's power?

| Option | Trade-off |
|---|---|
| **No extra limit** | Simple. An agent can grant another agent tools or integrations it lacks itself. |
| Power-widening edits always ask | Human on the risky edits. Stalls unattended runs. |
| Target never exceeds the editor | Strongest. Complex, and blocks real setup work. |

Chosen by Mahmoud. "No extra limit" means no limit beyond what self-edit already refuses: `edit_agent_config` and `create_agent` use `AGENT_COMMIT_SCOPE` unchanged, so harness kind, sandbox kind, sandbox credentials and the harness, runner and sandbox permission blocks stay out of reach. Tools, integrations, MCP servers, skills, instructions, model and the two new capabilities are all editable.

### D5. What does `create_agent` start from?

| Option | Trade-off |
|---|---|
| **The same catalog template "New agent" uses, plus optional operations in the same call** | One source of defaults. Same edit format as self-edit. |
| A full configuration from the agent | Full control. Long, error-prone, brittle. |
| Copy an existing agent | Good for variants. Silently copies tools. Second path. |

Chosen by Mahmoud. Today the template is applied in the browser, so the API gains a small server-side builder that reads the same catalog template. A later `copy_from` field stays possible.

### D6. New tools or a target field on the self-edit tools?

| Option | Trade-off |
|---|---|
| **Four new ops; self-edit unchanged** | Toggle maps to tools. Self-edit keeps its unforgeable self binding. |
| Optional `agent` field on `read_config` and `commit_revision` | Fewer tools. A gating bug exposes cross-agent edits to every self-editing agent. |

Chosen by Mahmoud.

### D7. Attribution

| Option | Trade-off |
|---|---|
| **The commit message always ends with who made the change and from where** | No new column, no new UI. Visible wherever history is shown. |
| A separate metadata field and history label | Structured. More work. |
| B plus a notice in the target's playground | Most visible. Most UI. |

Chosen by Mahmoud: keep it simple and put it in the commit message.

The server appends a suffix to the derived message. It uses values bound from run context, never from the model:

```
set parameters.agent.instructions.agents_md (by agent "Support Triage" 019f…, session 01a1…)
```

`create_agent` writes `Created by agent "<name>" <id>, session <id>` as the first revision's message, followed by the derived clauses when operations were sent.

### D8. Defaults decided without a question

- **Target identity.** Tools take an agent `id` or `slug` from `list_agents`. The server resolves it to the agent's default variant in the caller's project. An unknown id, a workflow without `is_agent`, an archived agent, or a static workflow such as the build kit is refused.
- **Self as target.** `edit_agent_config` and `read_agent_config` refuse the caller's own agent and point it to `read_config` and `commit_revision`. This keeps one path for self-edits, including the draft-run warning that only the self tools know about.
- **What gets edited.** The target's latest saved revision. Deployed environments do not change. These tools never deploy.
- **Conflicts.** Same rule as self-edit: the edit names the `base_revision_id` it read, and a moved head is refused so the agent re-reads.
- **Platform tools.** The existing check that rejects committing build kit entries applies to targets too.
- **The `agenta_tools` entry.** The operations engine keys it by its type, `agenta_tools` (the runtime allows one per agent). An agent turns one Agenta tool on with one `set` on `[..., {"list":"tools","key":"agenta_tools"}, "tools", "<tool>"]`, for itself and for another agent, instead of replacing the whole `tools` list.
- **A runnable result.** An agent's commit (`commit_revision`, `edit_agent_config`, and the operations of `create_agent`) runs the runtime's own parse of `parameters` (`AgentTemplate.from_params`) on the result and refuses it with `final_validation_failed` and the field path, for example `skills[0].body is required`. Entries that hold an embed are skipped, because embeds resolve before a run.
- **A create that stops part of the way.** The writes are not one transaction, the same as the web path. The partial agent is archived, and the refusal says whether the archive worked and is not retryable.
- **Listing.** `list_agents` pages over the project's applications, newest first, and keeps those whose default-variant head (the head read and edit use) is flagged `is_agent`. A page can hold fewer agents than `limit`.

## Risks / Trade-offs

- **Project-wide silent rewrites (accepted).** With D1, D3 and D4, a prompt injection reaching one agent that holds Agent config can rewrite every agent in the project, without approval. Mitigation: attribution in every commit message, so any change is traceable and revertible from history. People can set any of the tools to ask or turn the capability off.
- **Capability spread (accepted).** An agent can grant Agent config to other agents.
- **Privilege escalation through subagents (accepted).** An agent can add an integration to a helper agent and then call the helper.
- **Template drift.** If the browser and the server read the catalog template differently, "New agent" and `create_agent` diverge. Mitigation: one shared server-side builder, and a test that compares the two.
- **Model confusion between self and other.** Two read tools and two edit tools exist side by side. Mitigation: clear descriptions, and the self-target refusal names the right tool.

## Migration

No data migration.

- **Build kit.** The kit is injected at run time, so every agent gets both capabilities in the playground as soon as this ships.
- **Agenta tools.** New agents get the four tools through `DEFAULT_AGENTA_TOOLS`. An existing agent with no `agenta_tools` entry gets the new default entry the next time the playground loads it and someone saves. An existing agent that already has an entry keeps it unchanged until someone turns the capabilities on. Rewriting saved entries would be a silent bulk change, which this design avoids.
- **Runs without a session.** Attribution uses the session id when the run has one, and writes `session none` otherwise. Changed in implementation: the runner refuses a call whose `$ctx.session.id` binding has no value, so `create_agent` and `edit_agent_config` are not offered to a run without a session (task 2.7). Triggers and channels mint a session, so they keep both.
