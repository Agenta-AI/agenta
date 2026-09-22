# Decisions

## Load one agent

Version one accepts one agent definition. It loads known content in backend code and hands remaining work to that agent. Multi-agent packages and reference tools stay in a separate future specification.

## Preserve the interface

Keep existing cards, template-opening controls, connection-card placement, and navigation. `/m` is the new default app for all screen sizes. The older web host remains a distinct implementation, not the definition of desktop.

## Resolve a source

The service accepts a typed template source and defaults existing card keys to the internal catalog. Follow the skill-import pattern of source resolution and provenance. This is a content-loading change, not a migration of saved agents.

## Reuse current creation settings

Use the same model, harness, and sandbox selection as ordinary agent creation. Do not put a separate model-selection rule in templates. Version-one packages do not override `llm`.

## Keep references small

An MCP option contains only `kind` and `server`. MCP configuration and authentication belong to existing server declarations and gateway services. Permission policy is optional. An agent owns its description; a future subagent reference has an optional `tool_description` for when to call it.

## Copy workspace content in the backend

Files and folders are copy declarations. They do not need resource-level setup notes. Put any later user-specific file changes in the optional agent `SETUP.md`. All remaining setup notes are optional.

## End at the first message

Provide setup context in the normal first message. Reuse the existing build kit for the subsequent conversation. Do not introduce installation status, an installation-read operation, template-specific edit operations, or a template readiness gate.

## Keep request retries separate from conversational setup

Prevent duplicate create requests and duplicate first messages through the owning resource/session services. Request keys and fingerprints do not create a new conversational lifecycle. See [the loading flow](installation-flow.md) for the remaining general session-input gap.
