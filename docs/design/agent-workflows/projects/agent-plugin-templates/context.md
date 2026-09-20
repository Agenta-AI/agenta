# Context

## What users experience today

The home page has a static `AgentStarterTemplate` registry with display copy, connection slots, an example, and a builder message. [PR #6395](https://github.com/Agenta-AI/agenta/pull/6395) adds account selection to this flow. Desktop asks before Create. Mobile creates the agent and session first, then holds the first message behind an in-session connection card when a required account is missing or a provider choice exists.

The build-an-agent skill then matches the request to a bundled playbook. The agent discovers tools, asks for missing details, and commits its own configuration. Connection choices reach the builder as prose appended to the visible user message. They are not persisted package bindings. [Integration with the existing connection step](onboarding-integration.md) specifies what to reuse and what package installation must replace.

This flow shipped the first useful template catalog. It has three limits for the next use case:

1. A card describes one agent. It cannot define several agents and links between them.
2. The package content is split between frontend card data and Python playbooks. It cannot be imported from a repository or shared archive as one unit.
3. Skills, starter files, MCP servers, and automation recipes are instructions for a model to recreate. They are not declared resources that the backend installs.

## What this project adds

A template becomes a versioned Agent Plugin directory. The package declares:

- one or more named agents;
- one entry agent that opens after Create;
- a separate `AGENTS.md` and optional `SETUP.md` for each agent;
- standard Agent Skills under `skills/`;
- standard MCP servers in `mcp.json`;
- Agenta gateway connection options;
- links between agents;
- starter files and folders;
- automation recipes;
- setup notes attached to the resources the setup agent must configure.

The API validates and snapshots the package, creates the declared resources, and opens one setup conversation with the entry agent. The entry agent receives setup guidance as model context, not as a transcript bubble. It uses installation-scoped operations to finish missing connection bindings, child configuration, files, and automations.

## Example outcome

A user selects **Outbound Prospecting** and presses Create.

Agenta creates:

- an Outbound Prospecting agent;
- a Prospect Researcher agent;
- links in both directions because each agent declares the other as a callable child;
- the shared prospect-research skill;
- starter profile and outreach files;
- an optional weekday schedule recipe.

Agenta then opens the Outbound Prospecting setup session with this visible message:

> Hi Outbound Prospecting. Please setup yourself

The model also receives `SETUP.md`, resource setup notes, selected account bindings, and unresolved requirements through the existing per-turn context path. These items do not appear as user messages.

## Goals

- Use the published Agent Plugins format as the package base.
- Keep Agenta-specific behavior inside the `ai.agenta` extension.
- Create each declared agent once, then resolve links by stable package key.
- Allow optional connection requirements and alternative implementations such as Composio or MCP.
- Keep permanent instructions in `AGENTS.md` and temporary guidance in `SETUP.md`.
- Install known resources in backend code instead of asking a model to reproduce them.
- Preserve explicit approval for credentials, external writes, and recurring actions.
- Make retries safe after refreshes, timeouts, and partial failures.

## Non-goals for the first delivery

- Standardizing agents or automations in the Agent Plugins core specification.
- Supporting Agent Plugins stdio or legacy SSE MCP servers. Agenta will support the published Streamable HTTP form first and report the other forms as unsupported.
- Automatically applying publisher updates to installed agents.
- Installing executable startup hooks into an agent workspace.
- Allowing a package to carry raw credentials, project connection identifiers, active trigger identifiers, or private sessions.
- Building a marketplace before the package loader and installer work for a bundled package.

## Success criteria

A bundled package can create its agents, skills, files, links, and inactive automation recipes with one user action. A retry does not duplicate resources. The entry agent can finish setup through one conversation. The same validated package snapshot can later arrive from a repository or archive without changing installation semantics.
