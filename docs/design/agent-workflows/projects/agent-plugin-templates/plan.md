# Implementation plan

This is a plan only. The [OpenSpec tasks](../../../../../openspec/changes/load-single-agent-templates/tasks.md) are the actionable checklist; all remain unchecked.

1. Resolve the internal template source and validate a single-agent package, including descriptions, optional notes/policies, MCP references, and safe paths.
2. Compose its content with ordinary creation defaults. Use existing workflow, skill, and mount services to create the agent and copy known resources.
3. Preserve the current connection controls. Reuse gateway services and the existing connection tools for unresolved needs.
4. Deliver one normal first message containing setup guidance and remaining recipes. Close general request/session deduplication gaps if needed.
5. Verify unchanged template entry behavior, correct saved resources, and first-message acceptance. Stop the feature's responsibility there.

Do not implement child agents, new setup-specific tools, installation status, backend readiness gates, or a new template UI. The [future subagent tasks](../../../../../openspec/changes/support-template-subagents/tasks.md) are separate and NOT IMPLEMENTED.

There is no saved-agent migration. Replacing built-in template content does not rewrite existing user agents. Reverting the loading handler changes future template creates only.
