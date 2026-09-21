# Single-agent package data model

This is the single-agent format implemented by the loader. Agent Plugins 1.0 owns `plugin.json`, `skills/`, and `mcp.json`. Agenta owns the `ai.agenta` extension. The first version accepts one agent. The [future schema](future-extension.schema.json) is a separate design fixture for unimplemented multi-agent support.

## Source reference

The loading service takes a source, separate from portable package content:

```json
{ "kind": "internal", "key": "outbound-prospecting" }
```

An existing template card supplies its key and defaults to `internal`. Resolve the key through a backend registry. The service records source key, resolved version, and package digest in workflow/revision provenance. This follows the existing skill-import pattern without adding an installation table. Source provenance is not mutable setup status. Repository and archive sources are deferred.

## Extension manifest

```json
{
  "schema_version": 1,
  "entry": "outbound",
  "agents": {
    "outbound": {
      "name": "Outbound Prospecting",
      "description": "Research prospective customers and prepare reviewed outreach drafts.",
      "instructions": "./ai.agenta/agents/outbound/AGENTS.md",
      "setup": "./ai.agenta/agents/outbound/SETUP.md",
      "skills": ["prospect-research"],
      "connections": [],
      "automations": [],
      "workspace": { "entries": [] }
    }
  }
}
```

The agent's name, description, and instructions are required. `setup`, skills, connections, automation recipes, and workspace entries are optional. `entry` must reference the sole agent. Unknown extension fields fail validation. The first-version schema rejects `subagents` and multiple agents before creating resources.

Model/harness/sandbox selection comes from ordinary creation. A package does not carry an `llm` override. This first-version schema also omits the earlier generic `configuration` bag to avoid replacing ordinary creation settings indirectly.

## Connection declarations

```json
{
  "key": "mailbox",
  "required": false,
  "purpose": "Prepare drafts in the selected mailbox.",
  "options": [
    { "kind": "gateway", "provider": "composio", "integration": "gmail" },
    { "kind": "mcp", "server": "mail-drafts" }
  ]
}
```

Gateway options identify an integration. MCP options identify a server declaration in `mcp.json` using only the kind and server. Do not duplicate header requirements, URLs, or credentials on the option. The existing MCP gateway owns endpoint registration, project binding, authentication, and secret handling. An unresolved account or endpoint is a remaining setup need in the first message; it does not become invalid runtime configuration.

`required` describes the agent's need and preserves the existing connection step's behavior. It does not introduce a new backend readiness state. Optional connections retain current skip behavior. If the user has already declined one, include that choice in the message so the agent does not immediately ask again.

`policy` and `setup_notes` are optional. Omitted policies use existing runtime defaults. This work adds no policy editor. When supplied, policy fields must validate against the native configuration they target; the JSON example alone is not proof that every policy maps to every backend type.

## MCP support

v0.119 supports direct HTTP configuration and gateway route references with builtin, standard, or custom namespaces. Managed routes keep upstream configuration and credentials behind the gateway. Existing connection flows support OAuth, API keys, and no authentication. Use those flows rather than a new template credential schema.

The Agent Plugins example declares Streamable HTTP. v0.119 code handles JSON and SSE-framed Streamable HTTP responses; that does not imply stdio or the legacy separate SSE transport. Unsupported declarations fail import explicitly. A plain HTTP/private-network address must follow existing deployment network policy, not a hardcoded template restriction or permission bypass.

## Files and setup guidance

```json
{
  "entries": [
    {
      "type": "file",
      "source": "./ai.agenta/agents/outbound/files/target-profile.md",
      "path": "target-profile.md"
    },
    { "type": "directory", "path": "reports" }
  ]
}
```

The backend copies files and creates folders in the agent mount. No workspace entry has `setup_notes`. Optional instructions to personalize a copied file belong in the agent's `SETUP.md`. Resolved source and destination paths must remain inside their allowed roots. Reject automatic startup files; loading content is not permission to execute it.

## Automation recipes

Keep optional `automations` as descriptions of work to pass to the agent. A recipe contains its key, name, trigger configuration, optional input fields, and optional setup notes. It creates no active schedule or subscription during loading. The agent uses existing trigger tools after the handoff, with existing approval requirements. `required` on a recipe expresses author intent for the conversation, not a loading readiness condition.

## Future references

An agent's `description` describes the agent. A future subagent reference may add `tool_description` describing when the caller should use that agent. Permission, custom input schema, tool description, and setup notes are optional. The default calling description comes from the target agent. This belongs only to the deferred [multi-agent specification](../../../../../openspec/changes/support-template-subagents/specs/template-subagents/spec.md) and [future example](future-example/README.md), both NOT IMPLEMENTED.
