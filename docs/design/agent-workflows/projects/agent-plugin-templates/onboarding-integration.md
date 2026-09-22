# How the existing template flow changes

The user opens the same template card and sees the same screens. The difference is what Agenta loads behind that action.

Today, the action creates an agent and gives it a playbook to build itself. The new loader reads an internal Agent Plugin package, saves the agent's instructions and description, installs its skills, copies its files, and sends a first message with the remaining setup work.

## What stays

PR #6395's connection controls, alternative-provider choices, opening actions, and navigation remain. `/m` is the new default app on both desktop and phone screens. Its connection card stays inside the session. The older web app keeps its current flow. Free-text and blank-agent creation stay on their existing paths.

The same model-selection logic runs for all agent creation. Existing runtime approval controls remain responsible for permissions. This work adds no new account selector, package preview, policy editor, migration screen, or installation status.

## What changes underneath

The template key resolves to a source such as `internal:outbound-prospecting`. The source service loads the package. Existing connection choices reach the ordinary agent configuration or the first message, rather than being lost during the change in loading behavior.

Use current connection/settings tools for any unresolved gateway or MCP need. If the present template card cannot express a package option, do not extend the screen in this change. Keep the bundled template's initial choices compatible with current controls and let the normal conversation handle remaining setup.

## No saved-agent migration

The built-in template content moves from playbook-driven reconstruction to package files. Existing saved agents are untouched. Their instructions, connections, and sessions do not need conversion. There is no customer migration process. A rollback changes which loader future template actions use.

The first-version responsibility ends at first-message delivery. The [OpenSpec interface requirements](../../../../../openspec/changes/load-single-agent-templates/specs/template-entry-behavior/spec.md) and [validation plan](validation.md) check that this remains a loading change.
