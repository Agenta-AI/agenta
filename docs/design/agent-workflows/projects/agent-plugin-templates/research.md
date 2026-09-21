# Verified implementation references

Current comparison baseline: release/v0.119.0 at `ebb825d1da345e7bf9741e832d7664a972e6f72e`. This updates the earlier v0.118-era design assumptions. Code inspection verifies the statements below; it does not substitute for runtime acceptance.

## Template entry and creation

[PR #6395](https://github.com/Agenta-AI/agenta/pull/6395) introduced the connection step. `/m` is the new default application on desktop and mobile. Its in-session card and the older web host's pre-create flow are different host implementations, not a device split.

[Shared creation](https://github.com/Agenta-AI/agenta/blob/ebb825d1da345e7bf9741e832d7664a972e6f72e/web/packages/agenta-home-ui/src/useCreateAgent.ts) commits an ephemeral agent through the standard workflow path. Its module-level latch prevents overlapping creates in one frontend module; it is not durable cross-request idempotency.

[Creation defaults](https://github.com/Agenta-AI/agenta/blob/ebb825d1da345e7bf9741e832d7664a972e6f72e/web/packages/agenta-entities/src/workflow/state/appUtils.ts) load runnable model candidates, apply the user's selection rules, and ensure an enabled sandbox. Reuse this behavior instead of choosing a model from a template.

## Sources and resources

[Skill source fetching](https://github.com/Agenta-AI/agenta/blob/ebb825d1da345e7bf9741e832d7664a972e6f72e/api/oss/src/core/skills/fetcher.py) separates source retrieval from parsing. Its current public GitHub fetcher resolves a snapshot and enforces extraction limits. An internal template resolver should follow that separation, without claiming GitHub import ships for templates in version one.

[Skill import](https://github.com/Agenta-AI/agenta/blob/ebb825d1da345e7bf9741e832d7664a972e6f72e/api/oss/src/core/skills/import_service.py) uses normal workflow resources and namespaced origin/provenance metadata. Reuse that pattern rather than creating a template installation lifecycle.

[Workflow service](https://github.com/Agenta-AI/agenta/blob/ebb825d1da345e7bf9741e832d7664a972e6f72e/api/oss/src/core/workflows/service.py) and [mount service](https://github.com/Agenta-AI/agenta/blob/ebb825d1da345e7bf9741e832d7664a972e6f72e/api/oss/src/core/mounts/service.py) remain the owners of created agents and files.

## MCP in v0.119

[Native MCP models](https://github.com/Agenta-AI/agenta/blob/ebb825d1da345e7bf9741e832d7664a972e6f72e/sdks/python/agenta/sdk/agents/mcp/models.py) accept direct HTTP connections and managed gateway routes in builtin, standard, and custom namespaces. Managed routes keep upstream configuration and credentials at the gateway. Policies include optional whole-server and per-tool permissions.

[Gateway endpoint models](https://github.com/Agenta-AI/agenta/blob/ebb825d1da345e7bf9741e832d7664a972e6f72e/api/oss/src/core/gateways/mcps/dtos.py) own endpoint route data, secret/connection references, and OAuth metadata. [Gateway auth schemes](https://github.com/Agenta-AI/agenta/blob/ebb825d1da345e7bf9741e832d7664a972e6f72e/api/oss/src/core/gateways/dtos.py) include OAuth, API key, and none.

[HTTP relay](https://github.com/Agenta-AI/agenta/blob/ebb825d1da345e7bf9741e832d7664a972e6f72e/api/oss/src/core/gateways/mcps/providers/http/adapter.py) and [probe](https://github.com/Agenta-AI/agenta/blob/ebb825d1da345e7bf9741e832d7664a972e6f72e/api/oss/src/core/gateways/mcps/probe.py) implement the HTTP path, including Streamable HTTP responses framed as SSE. No stdio process connection or legacy separate SSE connection was found in these author models and relay paths. Do not infer those transports from the word SSE in response parsing.

[Request-connection schema](https://github.com/Agenta-AI/agenta/blob/ebb825d1da345e7bf9741e832d7664a972e6f72e/api/oss/src/core/workflows/static_catalog.py) already accepts an MCP target. See [the build-kit audit](build-kit-audit.md) for exact capabilities and limits.

## Package and specification formats

Agent Plugins 1.0.0 remains the portable package format. The [pinned published schema](https://github.com/agentplugins/agent-plugins-spec/tree/ff8ab5e392cc87bd88d87c060815a87490e51003/schemas/1.0.0) defines plugin and MCP files. Its portable schema does not define Agenta agent records or project-owned credentials.

The specification workspace was created with [OpenSpec](https://github.com/Fission-AI/OpenSpec) CLI 1.13.1. The npm package checksum was verified against registry integrity before execution. Requirements are kept in proposed changes; they are not archived as shipped capabilities. OpenSpec format validation does not test the product implementation.
