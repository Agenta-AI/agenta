# Data model

The package uses two contracts. Agent Plugins owns the portable contract. Agenta owns the extension contract.

The complete example is under [example/](example/). The proposed extension schema is [extension.schema.json](extension.schema.json).

## Package layout

```text
outbound-prospecting/
├── plugin.json
├── mcp.json
├── skills/
│   └── prospect-research/
│       └── SKILL.md
└── ai.agenta/
    ├── agents.json
    └── agents/
        ├── outbound/
        │   ├── AGENTS.md
        │   ├── SETUP.md
        │   └── files/
        │       └── target-profile.md
        └── researcher/
            ├── AGENTS.md
            └── SETUP.md
```

`plugin.json`, `skills/`, and `mcp.json` follow Agent Plugins 1.0. The `ai.agenta/` directory follows the Agenta extension described here.

## Core manifest

`plugin.json` contains portable identity and one extension pointer:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  "name": "outbound-prospecting",
  "version": "1.0.0",
  "description": "Research prospects and prepare reviewed outreach drafts.",
  "extensions": {
    "ai.agenta": {
      "manifest": "./ai.agenta/agents.json"
    }
  }
}
```

Agenta validates this file against a locally bundled copy of the published 1.0 schema. It must not fetch a schema during package loading.

## Extension manifest

`ai.agenta/agents.json` contains one entry key and a flat map of agent definitions:

```json
{
  "schema_version": 1,
  "entry": "outbound",
  "agents": {
    "outbound": {
      "name": "Outbound Prospecting",
      "instructions": "./ai.agenta/agents/outbound/AGENTS.md",
      "setup": "./ai.agenta/agents/outbound/SETUP.md",
      "configuration": {
        "runner": { "permissions": { "default": "allow_reads" } }
      },
      "skills": ["prospect-research"],
      "connections": [],
      "subagents": [],
      "automations": [],
      "workspace": { "entries": [] }
    }
  }
}
```

Unknown extension fields are errors. This differs from an unknown namespace in `plugin.json`, which Agent Plugins clients ignore.

## Agent definition

An agent definition has these roles:

| Field           | Role                     | Installation result                                                    |
| --------------- | ------------------------ | ---------------------------------------------------------------------- |
| `name`          | Display data             | Workflow name.                                                         |
| `instructions`  | Package path             | File content copied into `parameters.agent.instructions.agents_md`.    |
| `setup`         | Package path             | Temporary setup context for this installation.                         |
| `configuration` | Runtime configuration    | Supported model and execution settings merged into `parameters.agent`. |
| `skills`        | Package-local references | Pinned skill embeds on the workflow revision.                          |
| `connections`   | Requirements and policy  | Selected gateway tools or MCP entries after binding.                   |
| `subagents`     | Package-local routing    | Workflow reference tools resolved after all agents exist.              |
| `automations`   | Inactive recipes         | Schedules or subscriptions configured during setup.                    |
| `workspace`     | File copy declarations   | Files and empty folders copied into the agent mount.                   |

`configuration` accepts `llm`, `harness`, `runner`, and `sandbox`. It does not accept instructions, tools, MCP servers, or skills because the surrounding package fields own those roles. The compiler emits the current `AgentTemplateSchema` shape.

## Connection requirement

Each connection entry describes one need for one agent:

```json
{
  "key": "mailbox",
  "required": false,
  "purpose": "Prepare drafts in the selected mailbox.",
  "options": [
    {
      "kind": "gateway",
      "provider": "composio",
      "integration": "gmail"
    },
    {
      "kind": "mcp",
      "server": "mail-drafts",
      "credential_requirements": [
        {
          "kind": "header",
          "name": "Authorization",
          "key": "mail-drafts-authorization",
          "description": "Authorization header for the selected mail MCP server."
        }
      ]
    }
  ],
  "policy": {
    "permissions": { "default": "ask" }
  },
  "setup_notes": "Ask whether mailbox access is useful. If skipped, save Markdown drafts."
}
```

The option types have different meanings:

- A `gateway` option selects an Agenta gateway provider and integration. The installation binds it to a verified project connection slug. The compiler emits `GatewayConnectionToolConfig` with this declaration's policy.
- An `mcp` option selects a server key from the standard `mcp.json`. Agenta initially accepts only `streamable-http`. The compiler maps it to the current native HTTP MCP shape. Static headers remain public package data. Header credential requirements bind to target-project secret references and never carry secret values.

`required: false` means the installation can become ready when the user explicitly skips the requirement. It does not mean the installer should silently choose no option.

The installer must confirm that each required declaration has at least one option Agenta supports. It must not claim that two options have equivalent tools merely because the package groups them.

For frontend mapping, canonical option identity, concrete account selection, and skip persistence, see [onboarding integration](onboarding-integration.md). Connected provider slugs alone do not satisfy the package binding contract.

## Subagent link

A subagent declaration becomes a current workflow reference tool:

```json
{
  "agent": "researcher",
  "description": "Research a company and return source-backed facts.",
  "permission": "ask",
  "input_schema": {
    "type": "object",
    "properties": {
      "messages": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "role": { "const": "user" },
            "content": { "type": "string" }
          },
          "required": ["role", "content"],
          "additionalProperties": false
        }
      }
    },
    "required": ["messages"],
    "additionalProperties": false
  }
}
```

The installer resolves `agent` to the created workflow slug and emits `ReferenceToolConfig`. When `input_schema` is absent, the compiler uses the current message input shape. The compiler rejects a custom schema it cannot map to the target workflow.

The package graph may contain cycles. Resource creation does not recurse through it. Runtime callbacks carry the current workflow call chain. A callback returns `recursive_agent_call` when the target already appears in that chain and `agent_call_depth_exceeded` when it exceeds the configured maximum.

## Skill reference

An agent lists skill names discovered under the standard `skills/` directory:

```json
{ "skills": ["prospect-research"] }
```

The installer validates each standard skill, creates or reuses an identical project skill snapshot through `SkillsService`, and pins the reference to that revision. A package cannot contain a source-project workflow identifier or follow-latest registry reference.

## Automation recipe

An automation declaration is a recipe, not an active trigger:

```json
{
  "key": "weekday-prospects",
  "name": "Weekday prospect research",
  "required": false,
  "trigger": {
    "type": "schedule",
    "schedule": "0 9 * * 1-5"
  },
  "inputs_fields": {
    "messages": [
      {
        "role": "user",
        "content": "Research prospects from the saved profile. Prepare drafts only."
      }
    ]
  },
  "setup_notes": "Confirm the time and timezone. Activate only after the user approves."
}
```

The setup agent may change declared setup fields such as schedule time or event filters. It cannot change the target agent or create an undeclared automation through the installation-scoped operation. `required: false` allows an explicit declined disposition.

## Workspace entries

A workspace lists only files and folders that the installer should copy:

```json
{
  "entries": [
    {
      "type": "file",
      "source": "./ai.agenta/agents/outbound/files/target-profile.md",
      "path": "target-profile.md",
      "setup_notes": "Replace the unknown values after the user confirms the target profile."
    },
    {
      "type": "directory",
      "path": "reports"
    }
  ]
}
```

`source` must remain inside the package root. `path` must remain inside the agent mount. The first release rejects symlink escapes, absolute paths, `..` segments, control characters, `.tools/setup.sh`, and other declared automatic startup files. It copies only declared entries, not the whole extension directory.

A copied file records its package hash and initial copy result. Setup may edit it later. Installation completion checks that the initial copy succeeded, not that user-tailored content still matches the package.

## Installation record

The package is portable. The installation is project-specific:

```text
TemplateInstallation
  id
  project_id
  package_digest
  entry_agent_key
  status
  setup_session_id
  resources[agent_key]
    workflow_id
    workflow_slug
    variant_id
    revision_id
    mount_id
  connection_bindings[agent_key, connection_key]
    option_kind
    option_key
    project_reference
    disposition
  automation_bindings[agent_key, automation_key]
    trigger_id
    disposition
  steps[stable_step_key]
    status
    resource_reference
    error
```

`status` is one of `installing`, `setup`, `ready`, `failed`, or `cancelled`. Detailed progress lives in stable step keys such as `agent:outbound:create` and `file:outbound:target-profile.md`. Retrying the same installation reuses completed step results.

Credentials do not belong in this record. It stores only project-owned connection or secret references.

## Source and snapshot records

A package source may be bundled, a repository revision, or an uploaded archive. Source location is provenance. The content digest is installation identity.

Agenta validates and snapshots a package before installation. It records:

- the source type and source locator;
- the resolved repository revision when applicable;
- the Agent Plugins version;
- the Agenta extension version;
- the package content digest;
- validation diagnostics;
- the immutable package archive location.

The package's human version string helps users. It does not replace the digest.
