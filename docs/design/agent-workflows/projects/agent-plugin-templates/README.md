# Agent Plugin templates

Agenta currently creates a blank agent from a template card and asks the builder agent to configure it in chat. That works for one agent assembled from a playbook. It does not install a defined group of agents, skills, files, Model Context Protocol (MCP) servers, or automation recipes.

This project makes an [Agent Plugins 1.0](https://agent-plugins.org/specification) package the distribution unit. The standard package carries portable skills and MCP server declarations. The `ai.agenta` client extension describes Agenta agents and their starting resources. Each agent keeps its permanent instructions in a separate `AGENTS.md` file and its temporary setup guidance in a separate `SETUP.md` file.

This workspace is a design and implementation plan. The proposed format is not accepted by the current API.

## Reading order

1. [Context](context.md) explains the current user experience, the problem, and the intended result.
2. [Decisions](decisions.md) records the choices already made in this design.
3. [Data model](data-model.md) defines the Agent Plugins extension and its relationship to current Agenta configuration.
4. [Installation and setup](installation-flow.md) assigns work to the frontend, API, existing services, and setup agent.
5. [Implementation plan](plan.md) lists the delivery slices, files, and acceptance criteria.
6. [Research](research.md) links the proposal to the current code and the published Agent Plugins specification.
7. [Status](status.md) is the source of truth for progress and unresolved work.
8. [Example package](example/plugin.json) shows one package with two mutually linked agents, alternative connection providers, a skill, files, and an optional schedule.

## Terms

- **Agent Plugin:** the directory format defined by agent-plugins.org. Version 1.0 standardizes `plugin.json`, `skills/`, and `mcp.json`.
- **Agenta extension:** data and files owned by the `ai.agenta` namespace. Other Agent Plugins clients may ignore them.
- **Package snapshot:** the validated plugin directory and content digest that Agenta stores before installation.
- **Installation:** one project-scoped attempt to create resources from a package snapshot.
- **Agent key:** a package-local identifier such as `outbound` or `researcher`.
- **Connection requirement:** a need such as mailbox access, with one or more supported implementations.
- **Setup context:** `SETUP.md`, resource `setup_notes`, and current installation requirements rendered to the model during the installation session. It is not a chat message.
- **Workflow:** the current backend resource that stores an Agenta agent, its variants, and immutable revisions.
- **Runner:** the service that executes an agent through the selected coding harness.

## Recommendation

Use Agent Plugins unchanged for the portable parts. Add one small `ai.agenta` extension for agent definitions and Agenta-owned setup behavior. Keep package installation in the API. Let the created root agent handle only the choices that require a conversation.
