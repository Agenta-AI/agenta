# Code ownership and constraints

## Policy locations

| Concern | Owner |
| --- | --- |
| Playground tool policies | `api/oss/src/core/workflows/build_kit.py` |
| Canonical creation template | `sdks/python/agenta/sdk/utils/types.py` |
| Policy precedence and read hints | `services/runner/src/permission-plan.ts` |
| Native Pi activation and interception | `services/runner/src/extensions/agenta.ts` |
| Native Claude configuration | `sdks/python/agenta/sdk/agents/adapters/claude_settings.py` |
| Native Codex configuration | `sdks/python/agenta/sdk/agents/adapters/codex_settings.py` |
| Codex ACP mode | `services/runner/src/engines/sandbox_agent/codex-mode.ts` |
| Shared settings composition | `web/packages/agenta-entity-ui/src/DrillInView/SchemaControls/AgentTemplateControl.tsx` |
| Environment and policy controls | Same directory, `agentTemplate/useModelHarness.tsx` |
| Integration defaults | Same directory, `integrationPolicy.ts`; SDK `adapters/agenta_builtins.py` |

## Important distinctions

Explicit tool permissions precede the runner fallback. Allow and Deny in the general
dropdown are fallback values, not guarantees that override every tool-specific setting.
The operator deny switch is a separate higher-priority restriction.

Pi activates read, bash, edit, write, grep, find, and ls without saved tool entries. With
Allow and no native rule, its built-in approval interception is disabled. Claude and
Codex have separate native settings; their source behavior needs live spike verification.

The creation template is loaded before remembered model/harness routing. Changing its
policy affects all routed harnesses, as approved. Do not change routing to reset policies.

The Advanced drawer buffers a whole configuration while inline edits update the live
draft. Moving Permissions outside it requires preservation against stale drawer saves.
Count schema-filtered enabled environment options, not raw environment-variable entries.

The checkout contains unrelated existing changes. Preserve them, and inspect working-tree
content rather than assuming a clean diff or editing another agent's active files.
