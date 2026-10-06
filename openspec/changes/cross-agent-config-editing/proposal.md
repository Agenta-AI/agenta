## Why

Today an agent can read and change only its own configuration. People who run several agents want one agent to build and maintain the others: "create a helper agent for invoices", "add the new pricing page to the support agent's instructions". Today a person has to do that by hand in each agent's playground.

## What Changes

- Add two new capabilities that an agent can have:
  - **List agents**: one tool, `list_agents`, that returns the agents in the project.
  - **Agent config**: three tools, `read_agent_config`, `create_agent` and `edit_agent_config`, that read, create and edit any agent in the project.
- Show each capability as one toggle in the playground build kit and in the Agenta tools section (the saved `agenta_tools` entry). Each tool keeps its own permission control (allow, ask, or off), the same way every platform tool works today.
- Turn both capabilities on by default, with every tool set to allow: in the build kit, and in `DEFAULT_AGENTA_TOOLS` for new agents.
- Reuse the self-edit machinery: the same ordered-operations edit format, the same commit scope, and the same stale-revision check.
- Append attribution to the commit message of every revision these tools write: which agent made it, and from which conversation.
- Leave the existing self-edit tools (`read_config`, `commit_revision`) unchanged.
- Out of scope: test-running another agent (add it as a subagent and call it instead), copying an agent, archiving, deleting, and deploying.

## Capabilities

### New Capabilities

- `agent-directory`: an agent lists the agents in its project.
- `agent-config-management`: an agent reads, creates and edits the configuration of any agent in its project.

### Modified Capabilities

None. Self-edit keeps its current behavior.

## Impact

- **SDK**: `sdks/python/agenta/sdk/agents/platform/op_catalog.py` gains four platform ops and their input schemas.
- **API**: `api/oss/src/core/tools/platform_handlers.py` gains four registered handlers. `api/oss/src/core/workflows/build_kit.py` adds the ops to `DEFAULT_BUILD_KIT_OPS`. `sdks/python/agenta/sdk/agents/tools/models.py` adds them to `AGENTA_TOOLS` and `DEFAULT_AGENTA_TOOLS`. `api/oss/src/core/workflows/commit_support.py` gains an attribution suffix for the derived message.
- **Web**: the build kit list (`buildKitDescriptors.tsx`) and the Agenta tools section (`AgentaToolsSection.tsx`) gain a capability row that groups several ops. `DEFAULT_AGENTA_TOOLS` in `web/packages/agenta-entities/src/workflow/agentaTools.ts` mirrors the SDK. Copy for the four new ops. Chat change previews show the target agent's name.
- **Runner**: no change. The new ops use the existing handler-mode dispatch and the existing `$ctx` bindings.
- **Data**: no migration. Attribution lives in the commit message.
- **Security**: any agent with Agent config can rewrite any agent in the project, including tools and integrations. This is an accepted risk; see design.md.
