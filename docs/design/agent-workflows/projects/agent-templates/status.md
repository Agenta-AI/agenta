# Agent templates: status

Source of truth for progress. Keep this current.

## Current state (2026-07-10)

- Phase: workspace drafted, research done, no implementation started. Draft PR for review:
  [#5188](https://github.com/Agenta-AI/agenta/pull/5188).
- This workspace was created from three research passes (skill plumbing, frontend surfaces,
  inventory and prompting) and Mahmoud's hand-written changelog-writer exemplar. The research is
  synthesized and reconciled in [research.md](research.md); the raw reports are superseded.
- All five work packages ([plan.md](plan.md)) are pending. Nothing in code has changed.
- Awaiting Mahmoud's review of [open-questions.md](open-questions.md). #1 (category set) and #5
  (display versus required integrations) gate the frontend work; #2 (elicitation defaults) and #3
  (CHECK templates) gate scope.

## Decisions folded in from research (do not relitigate)

- **request_input has no default field.** Playbooks use an enum-first "figure it out" option plus
  guidance in the field description. The exemplar and [playbook-spec.md](playbook-spec.md) are
  corrected accordingly. Whether to add a real `default` field is open question #2.
- **test_run exercises uncommitted tools via a delta.** Exploration does not need
  commit-and-stop; that stays only as a fallback. The exemplar is corrected.
- **The trigger-test affordance is Lightning "Test event" (subscriptions) or Play "Run"
  (schedules), not a flask.** The flask is for Evaluations. Corrected everywhere in this
  workspace; WP1 fixes the copy in the skill.
- **The skill body is effectively loaded every turn**, so it stays a short router; the match
  table and playbooks live in on-demand reference files.

## Next steps

1. Mahmoud reviews [open-questions.md](open-questions.md), especially #1, #3, and #5.
2. Start WP0 (the authoring skill) and WP1 (the body reframe plus the changelog-writer playbook)
   in parallel; neither is blocked by an open question.
3. Wire WP3 (frontend registry) once #1 and #5 are answered.
4. Roll WP2 (the remaining playbooks) and WP4 (verification) by category.

## Provenance

- 2026-07-10: workspace created (README, context, research with current code anchors, exemplar,
  playbook spec, template inventory, plan with five work packages, open questions, this file).
  Research verified against `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`,
  `web/oss/src/components/pages/agent-home/assets/templates.ts`, the runner skill engine, and the
  elicitation schema. Three factual corrections to the hand-written exemplar were made during
  synthesis (no request_input defaults, test_run delta exploration, the trigger-test button) and
  are recorded above and in [research.md](research.md).
