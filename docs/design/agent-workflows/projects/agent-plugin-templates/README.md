# Agent Plugin templates

A template should load one configured agent, its skills, and its starter files, then send the agent a first message explaining the remaining setup. The interface stays as it is. The agent continues with its existing build-kit tools.

This PR contains specifications only. The first version has no installation lifecycle, readiness gate, new setup tools, or multi-agent creation. `/m` is the new default application for both desktop and mobile.

## Read the specifications

1. [Single-agent proposal](../../../../../openspec/changes/load-single-agent-templates/proposal.md): what version one does and where it stops.
2. [Single-agent design](../../../../../openspec/changes/load-single-agent-templates/design.md): source loading, existing services, first-message delivery, and responsibilities.
3. [Source specification](../../../../../openspec/changes/load-single-agent-templates/specs/template-sources/spec.md): internal sources and provenance.
4. [Loading specification](../../../../../openspec/changes/load-single-agent-templates/specs/single-agent-template-loading/spec.md): one agent, descriptions, defaults, skills, files, and MCP references.
5. [First-message specification](../../../../../openspec/changes/load-single-agent-templates/specs/template-first-message/spec.md): setup context and the handoff boundary.
6. [Interface specification](../../../../../openspec/changes/load-single-agent-templates/specs/template-entry-behavior/spec.md): unchanged template entry behavior.
7. [Future subagent specification](../../../../../openspec/changes/support-template-subagents/specs/template-subagents/spec.md): deferred, NOT IMPLEMENTED.

## Supporting documents

- [Context](context.md) and [decisions](decisions.md) explain scope.
- [Data model](data-model.md), [schema](extension.schema.json), and [example](example/README.md) define the single-agent package.
- [Loading flow](installation-flow.md) and [onboarding integration](onboarding-integration.md) explain the existing interface and backend handoff.
- [Build-kit audit](build-kit-audit.md) checks each setup action against v0.119 code.
- [Research](research.md) links the exact code baseline.
- [Plan](plan.md), [detailed implementation plan](../../../../superpowers/plans/2026-09-20-load-single-agent-templates.md), and [validation](validation.md) define implementation work and acceptance.
- [Review responses](review-responses.md) map PR comments to changes.
- [Status](status.md) separates document validation from runtime implementation.

## Terms

An **Agent Plugin** is the portable package format from agent-plugins.org. The **Agenta extension** adds agent-specific declarations under `ai.agenta`. A **source** identifies where the package comes from; the default source is Agenta's bundled catalog. **Provenance** records which version and content were loaded. **MCP** means Model Context Protocol, the protocol used to connect tool servers. The **build kit** is the existing set of tools for configuring an agent. A **handoff** is the durable acceptance of the first message, after which the ordinary agent conversation owns setup.
