# Onboarding connect step

Issue [#6043](https://github.com/Agenta-AI/agenta/issues/6043) / AGE-4134.

Agent onboarding creates the agent first and asks for accounts later — mid-run, several
turns in, through the builder's `request_connection` client tool. This workspace adds a
**setup step before create**: identify the accounts the agent will need, connect them, and
carry the result into the created agent.

## Files

- `context.md` — why this exists, what today actually does (including a correction to the
  issue's premise), goals, non-goals, and the locked decisions D1–D7.
- `research.md` — verified findings from the tree: the two onboarding paths, the flag
  matrix, the connect machinery that already exists, and what the frontend can and cannot
  infer.
- `design.md` — the step's anatomy, the gating rule, detection strategy, the two new
  questions, carry-through mechanisms, and copy.
- `plan.md` — WP-1…WP-6, sized to land independently, plus the verification plan.
- `qa.md` — the live browser matrix. Not yet run.
- `status.md` — where things stand. Source of truth for progress.

## Mockups

Design iteration 1 (three variants, state matrix, decisions) is published as an artifact:
<https://claude.ai/code/artifact/df1e9483-6da8-43b9-82ca-0c8fbd0da82d>

Iteration B ("inline reveal") was chosen. A ("setup drawer") survives only as the flag-off
template arm; C ("the agent asks first") is parked until the builder can plan pre-commit
server-side — its copy voice is borrowed for B.

## Quick orientation

- Free-text path: `web/oss/src/components/pages/agent-home/StripHome.tsx` →
  `hooks/useAgentHomeActions.ts` → `hooks/useCreateAgent.ts`.
- Playground-native path: `agent-home/PlaygroundOnboarding/useAgentOnboarding.ts` (`commit`).
- Template path: `agent-home/hooks/useCreateAgentFromTemplate.ts` (default) and
  `hooks/useTemplateSelect.ts` + `components/TemplateSetupDrawer/` (flag-off only).
- Connect machinery, reused as-is: `@agenta/entities/gatewayTool` (connections, catalog),
  `@agenta/entity-ui/gatewayTool` (`ConnectDrawer`),
  `@agenta/entity-ui/clientTools/useConnectFlow.ts` (the OAuth flow).
- Template registry + provider catalog: `web/packages/agenta-entities/src/workflow/agentTemplates.ts`.
- Flag pattern: `web/oss/src/components/pages/agent-home/assets/constants.ts`.
