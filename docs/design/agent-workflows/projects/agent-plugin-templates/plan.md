# Single-agent loading plan

This is a plan only. Runtime behavior remains **NOT IMPLEMENTED**.

The complete test-first plan is [Single-Agent Template Loading Implementation Plan](../../../../superpowers/plans/2026-09-20-load-single-agent-templates.md). It defines the service contracts, files, dependency order, tests, commands, and commit boundaries. The [OpenSpec task list](../../../../../openspec/changes/load-single-agent-templates/tasks.md) is the shorter progress checklist. All tasks remain unchecked.

The implementation has six stages:

1. Resolve a versioned internal source and validate one bounded Agent Plugin package before writes.
2. Re-read target-project connections, compile native agent configuration, and compose the first message without side effects.
3. Add general idempotent workflow/skill creation, preserve-existing mount materialization, and durable session starts.
4. Orchestrate those services behind one authorized `POST /agent-templates/load` operation.
5. Convert every current card to an internal package and replace only the existing template load action in both hosts.
6. Verify saved resources, retry behavior, unchanged interface behavior, and durable first-message acceptance.

Do not implement child agents, new setup-specific tools, installation status, backend readiness gates, or a new template UI. The [future subagent tasks](../../../../../openspec/changes/support-template-subagents/tasks.md) are separate and **NOT IMPLEMENTED**.
