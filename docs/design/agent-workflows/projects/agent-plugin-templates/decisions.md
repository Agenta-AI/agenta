# Decisions

## Use Agent Plugins 1.0 as the package base

Agent Plugins 1.0 is the current published release. It defines package identity, filesystem containment, standard skill discovery, standard MCP server discovery, and client extension namespaces.

Agenta will validate the published core contract without changing it. The package will declare Agenta-owned fields under `extensions.ai.agenta` and store Agenta-owned files under `ai.agenta/`.

Agent Plugins does not make the full Agenta package portable. Other clients can load its standard skills and supported MCP servers, but they may ignore its agents, files, setup guidance, and automation recipes.

## Keep the extension manifest in its namespace directory

`plugin.json` stays small:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "outbound-prospecting",
  "extensions": {
    "ai.agenta": {
      "manifest": "./ai.agenta/agents.json"
    }
  }
}
```

The extension value points to `./ai.agenta/agents.json`. Agenta owns the path field and therefore defines its validation and failure behavior. The path must begin with `./`, resolve inside the package root, and point into `ai.agenta/`.

## Define agents once and link them by key

Agents live in one map. A link names another key from that map. This supports shared children and mutual links without nesting or copying definitions.

```json
{
  "entry": "outbound",
  "agents": {
    "outbound": {
      "subagents": [{ "agent": "researcher" }]
    },
    "researcher": {
      "subagents": [{ "agent": "outbound" }]
    }
  }
}
```

The installer creates every workflow first and writes reference tools in a second pass. Package cycles are valid. Runtime call cycles are not. A workflow callback must carry its active call chain, reject a target already in that chain, and enforce a maximum depth. This lets either agent call the other from an independent task while stopping synchronous `A -> B -> A` recursion.

## Keep instructions and setup guidance in files

Each agent points to an `AGENTS.md` file. The installer reads it into the current `parameters.agent.instructions.agents_md` field.

Each agent may also point to `SETUP.md`. This file applies only while the installation is incomplete. It does not become permanent agent instructions.

Resource declarations may add `setup_notes`. These notes explain how the setup agent should resolve that resource. They are data for the setup conversation. They never grant permission or prove that a setup action succeeded.

## Model connection needs as slots with choices

A connection declaration says what the agent needs, whether it is required, and which options can satisfy it. An option may be an Agenta gateway integration or a named server from standard `mcp.json`.

```json
{
  "key": "mailbox",
  "required": false,
  "purpose": "Prepare drafts in the selected mailbox.",
  "options": [
    { "kind": "gateway", "provider": "composio", "integration": "gmail" },
    { "kind": "mcp", "server": "mail-drafts" }
  ],
  "setup_notes": "Ask whether the user wants mailbox access. If skipped, save Markdown drafts."
}
```

The package never names a project connection slug or secret slug. The installation stores the selected option and the verified project binding.

Tool policy belongs to the agent's connection declaration because it controls what that agent may do. Credentials belong to the installation because they exist in the target project. Source metadata belongs to the package snapshot. These fields must not share one untyped metadata object.

## Extend the current per-turn context for setup

The current SDK already resolves `SessionContext` from the backend and renders it into `turnContext`. Extend that path with an optional setup section for an active installation session.

The setup section contains the agent's `SETUP.md`, resource setup notes, selected bindings, and unresolved requirements. The backend derives it from the session and installation. The browser cannot submit it as trusted request metadata.

This design needs no hidden chat-message type and no separate setup-context service. The normal transcript stores only the visible greeting and subsequent conversation. The setup section stops rendering when the installation becomes ready or cancelled.

## Let the backend install declarations and the agent resolve choices

The backend creates workflows, skills, files, and reference tools because the package already defines them. The setup agent handles choices that require user input, including account selection, user-specific values, and activation approval.

The setup agent receives narrow operations scoped to one installation. It does not receive project-wide authority to edit arbitrary workflows.

## Pin installed content

An installation records a content digest and copies the package definitions into project resources. A later repository or marketplace update does not change installed agents automatically. Update review and conflict handling are separate work after the first installer ships.
