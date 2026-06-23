# Agent Template

The agent template is the portable description of what the agent is. It should not silently
mix product identity, harness runtime options, and deployment infrastructure.

## Intended Shape

The baseline template is:

- `AGENTS.md` content: the main instructions.
- Skills: a folder-shaped set of skill files, serialized into a JSON-safe representation.
- Tools: managed builtin tools, inline code tools, and future MCP tool references.
- Metadata: name, description, and other product identity fields when the UI needs them.

This mirrors the file-based agent convention used by local coding agents while keeping the
wire shape JSON-friendly. File bytes can be base64 encoded when plain text is not safe.

## Configuration Layers

| Layer | Examples | Status |
| --- | --- | --- |
| Generic agent identity | `AGENTS.md`, skills, tool references, template metadata | Intended long-term template surface. Partly represented today by `agents_md` and tool config. |
| Harness-specific config | Harness id, model, harness option bags, permission policy | Present today. Permissions are not generic yet. |
| Runtime infrastructure | Local versus Daytona, runner sidecar URL, filesystem isolation, secret channels | Present as a POC selection in `RunSelection`, but should not become durable agent identity by default. |

The current code still accepts `sandbox` in request config. That is useful for the POC and
tests, but the long-term template should not require users to encode where the platform is
deployed.

## Current Implementation

Today the request surface includes:

- `parameters.agent.agents_md`
- `parameters.agent.model`
- `parameters.agent.tools`
- `parameters.agent.mcp_servers`
- `parameters.agent.harness`
- `parameters.agent.sandbox`
- `parameters.agent.permission_policy`
- harness-specific options such as Pi prompt overrides

The runtime also has forced Agenta policy in `AgentaHarness`, but that content is
experimental and not a general template system.

## Missing Work

- A first-class persisted template DTO that separates identity from run selection.
- Skills folder serialization and loading outside forced Agenta harness content.
- A stable tool contract based on URI, schema, and execution body or delivery reference.
- Clear UI grouping for generic template fields, harness-specific fields, and runtime
  infrastructure.
- Import/export behavior for `AGENTS.md` and skills folders.

## Deferred Work

Hooks, assets, extra code snippets, and a generic permissions overlay are deferred. The POC
should leave space for them without pretending they are supported.

## See also

For the live config contract today, from the playground form through the catalog type and
SDK interface down to what the runtime reads, see `agent-configuration.md`. This page is the
intended shape; that page is the current reality, field by field.

