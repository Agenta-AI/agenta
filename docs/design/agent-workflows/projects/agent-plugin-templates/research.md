# Research

Research was verified on 2026-09-17 against Agenta main at `3f73fee73cc89a31b9a49eec15fb87b19e6cee40` and Agent Plugins specification commit `ff8ab5e392cc87bd88d87c060815a87490e51003`.

## Agent Plugins contract

- [Agent Plugins repository](https://github.com/agentplugins/agent-plugins-spec/tree/ff8ab5e392cc87bd88d87c060815a87490e51003) identifies 1.0.0 as the current published release and 1.1.0 as a working draft. This plan targets 1.0.0.
- [Specification 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/ff8ab5e392cc87bd88d87c060815a87490e51003/spec/1.0.0.md) defines the package root, path containment, closed `plugin.json`, fixed skill and MCP locations, failure isolation, client extensions, and client conformance.
- [Plugin schema 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/ff8ab5e392cc87bd88d87c060815a87490e51003/schemas/1.0.0/plugin.schema.json) allows client data only under `extensions` and requires each namespace value to be an object.
- [MCP schema 1.0.0](https://github.com/agentplugins/agent-plugins-spec/blob/ff8ab5e392cc87bd88d87c060815a87490e51003/schemas/1.0.0/mcp.schema.json) defines stdio, Streamable HTTP, and legacy SSE server entries.
- The published specification defines no portable OAuth or credential-reference fields. Static MCP headers and environment values are visible package data and must not contain secrets. Agenta must own credential collection and secret-reference binding.
- The standard defines only skills and MCP servers as portable components. Agent definitions, setup, files, and automations belong in the `ai.agenta` extension.

## Current template flow

- [Frontend template registry](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/web/packages/agenta-entities/src/workflow/agentTemplates.ts) stores card data, connection slots with alternatives, instructions, examples, and builder messages. Its `TemplateConnection` shape already proves that a requirement can be optional and satisfied by one of several providers.
- [Shared create hook](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/web/packages/agenta-home-ui/src/useCreateAgent.ts) creates one ephemeral agent and commits it as one workflow.
- [Web create wrapper](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/web/oss/src/components/pages/agent-home/hooks/useCreateAgent.ts) appends setup prose to the seed, stores the first-run seed, and navigates to the playground.
- [First-run seed state](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/web/oss/src/components/AgentChatSlice/state/firstRunSeed.ts) is a frontend Jotai list. It has session and revision association, but it is not backend installation state.
- [Setup selection logic](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/web/packages/agenta-entities/src/workflow/agentSetup.ts) treats alternatives as one satisfiable slot and appends connected-account facts in the user's voice because the current seed has no separate setup context.
- [Template selection](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/web/oss/src/components/pages/agent-home/hooks/useCreateAgentFromTemplate.ts) creates the agent first and sends the builder message. No backend package installer runs.

## Current runtime configuration

- [AgentTemplateSchema](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/sdks/python/agenta/sdk/utils/types.py) is the strict saved `parameters.agent` shape. It already holds permanent instructions, model selection, tools, MCP servers, skills, harness, runner, and sandbox settings.
- The same schema documents `instructions.agents_md` as the agent's `AGENTS.md`. A package file can compile directly into this field.
- [Gateway connection tools](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/sdks/python/agenta/sdk/agents/tools/models.py) store a project connection slug and a per-agent permission policy. Package requirements cannot use this native shape until installation binds a target-project connection.
- The same file defines `ReferenceToolConfig`. It calls another workflow by slug and exposes an authored description and input schema. The model-visible name derives from the real workflow slug.
- [Native MCP configuration](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/sdks/python/agenta/sdk/agents/mcp/models.py) supports HTTP servers, public headers, header secret references, and policy. It does not accept Agent Plugins stdio or SSE forms. A loader can support standard Streamable HTTP first and compile it to the native HTTP form.

## Reusable backend services

- [SimpleWorkflowsService](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/api/oss/src/core/workflows/service.py) creates the workflow, variant, initial revision, and configured revision through several calls. The installer needs persisted reconciliation across these calls.
- The workflow service also provides checked revision commits with expected-base conflict handling. Installation-scoped child edits should use this path.
- [SkillsService](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/api/oss/src/core/skills/service.py) validates `SkillTemplate`, creates project skill workflows, and commits revisions with conflict checks.
- [MountsService](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/api/oss/src/core/mounts/service.py) validates agent ownership, creates deterministic agent mounts, validates destination paths, writes files, and creates folder markers.
- [ConnectionsService](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/api/oss/src/core/gateway/connections/service.py) owns project connections and server-owned validity. A package or model statement cannot mark a connection valid.
- [Trigger DTOs](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/api/oss/src/core/triggers/dtos.py) define schedules and subscriptions as separate project resources with workflow references and input mappings.
- [TriggersService](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/api/oss/src/core/triggers/service.py) owns trigger creation and provider interaction. The package installer should coordinate it, not duplicate it.

## Setup context path

- [SessionContext DTO](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/sdks/python/agenta/sdk/agents/dtos.py) currently carries agent name, session name, and first-turn state.
- [Session context resolver](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/sdks/python/agenta/sdk/agents/platform/session_context.py) reads trusted facts from the backend rather than request metadata.
- [Agent handler](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/sdks/python/agenta/sdk/agents/handler.py) resolves those facts for every normal handler run and passes them to `SessionConfig`.
- [Agent interfaces](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/sdks/python/agenta/sdk/agents/interfaces.py) render session context to `turnContext`, which is separate from chat messages. Extending this path is smaller than adding a hidden message type.
- [Build-kit overlay](https://github.com/Agenta-AI/agenta/blob/3f73fee73cc89a31b9a49eec15fb87b19e6cee40/api/oss/src/core/workflows/build_kit.py) supplies the current self-configuration tools. It has no installation-scoped child operations today.

## Current gaps

- No Agent Plugins parser or `ai.agenta` extension exists.
- No package snapshot or multi-resource installation record exists.
- No package installer creates several linked workflows.
- No setup context is associated with a backend installation session.
- No current build-kit operation can edit a declared child by package key.
- No workflow callback call-chain guard was found. Mutual reference tools therefore need an explicit runtime recursion boundary before they ship.
- No current native MCP configuration supports Agent Plugins stdio or legacy SSE transports.
