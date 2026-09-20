# Load one agent from an Agent Plugin template

## Why

A template currently asks a model to reconstruct an agent from a playbook. A package can provide its instructions, skills, and files directly, so the first conversation can focus on the user's remaining choices.

## What Changes

- Resolve a template source, defaulting to Agenta's bundled internal templates.
- Load exactly one agent from the package and copy its declared resources through existing services.
- Preserve the current template-opening interface and model-selection behavior.
- Send one first message containing setup instructions and unfinished actions. The agent continues with existing build-kit tools.
- Keep all setup notes and permission overrides optional. Put workspace setup guidance in the agent's optional `SETUP.md`.
- Use the v0.119 MCP gateway and authentication paths. An MCP option contains only its kind and server key.
- Exclude an installation lifecycle, setup-specific model tools, readiness gates, and multi-agent loading.

## Capabilities

### New Capabilities

- `template-sources`: Resolve internal package sources and retain provenance.
- `single-agent-template-loading`: Validate and load one agent with its resources and ordinary creation defaults.
- `template-first-message`: Deliver setup context once through the existing conversation path.
- `template-entry-behavior`: Preserve the current interface while changing the template loading behavior.

### Modified Capabilities

None. This repository had no OpenSpec capability specifications when this proposal was created.

## Impact

The implementation will touch template creation, package parsing, existing workflow/skill/mount services, and the first-message handoff. It must reuse the existing MCP gateway and build kit. This PR supplies proposed contracts, examples, and tasks only. It changes no runtime behavior. Multi-agent support has its own deferred proposal.
