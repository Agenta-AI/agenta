# Agent templates: status

Source of truth for progress. Keep this current.

## Current state (2026-07-10)

- Phase: implementation landed and verified end to end; PR
  [#5188](https://github.com/Agenta-AI/agenta/pull/5188) is ready for review. All six open
  questions decided on 2026-07-10 (see [open-questions.md](open-questions.md), each section opens
  with its decision). An issue for Arda ([#5190](https://github.com/Agenta-AI/agenta/issues/5190))
  covers the elicitation `default` field; playbooks adopt it when it ships.
- WP4 verdict: the changelog-writer builder smoke PASSED on the live stack. Turn 1 carries the
  full build kit; the agent reads SKILL.md, the agent-templates index, then the
  changelog-writer playbook, and replies with a request_input form whose enums lead with
  "Figure it out". Caveat: the test project's OpenAI and Anthropic keys are out of credit, so
  the passing run used the subscription credential path; the default card path needs a funded
  key in the vault.
- Review rounds folded in and committed (`4627d7bc74` plus an absorbed label fix,
  tip `a4c6dfd9ec`): codex xhigh (2 blockers fixed: static-version round-trip tolerance,
  requiredIntegrations aligned with each playbook's Connections), CodeRabbit rounds 1 and 2
  (all replied and fixed).

## Landed (2026-07-10, PR #5188)

- **WP0 — write-template-playbooks skill.** New repo skill at
  `.agents/skills/write-template-playbooks/` (SKILL.md + prompting-checklist + a worked example)
  teaches how to author one playbook file.
- **WP1 — skill body reframe + first playbook.** `BUILD_AN_AGENT_SKILL`
  (`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`) gained a three-line routing
  paragraph that checks `references/agent-templates/index.md` before the generic loop. The
  hand-written changelog-writer playbook landed as the first entry.
- **WP2 — remaining playbooks.** 28 playbooks total across six category modules in the new
  `agent_templates` package (engineering 6, support 4, sales 5, monitoring 4, knowledge 5, ops
  4). `TemplateEntry(key, name, match, category, body)`, one module per category, import-time
  validation, and a generated `index.md` so the router table can never drift from the files.
  Drift + FE-parity tests in
  `sdks/python/oss/tests/pytest/unit/agents/test_agenta_builtins_reference_files.py`.
- **WP3 — frontend registry.** `web/oss/src/components/pages/agent-home/assets/templates.ts`
  grew from 6 to 28 templates. `TEMPLATE_CATEGORY_ORDER` is now
  `[Engineering, Support, Sales, Knowledge, Ops]` (Monitoring folded into Engineering per
  decision #1). New display-only `logoSlugs` field (functional connect list stays
  `requiredIntegrations`); `PROVIDERS` grew 6 to 22; `seedMessage === builderMessage` short
  "Build a <X> that ..." seeds; `OnboardingConfigPanel` capped at 6; `TemplateCategoryChips`
  deleted; new registry-invariant test.

## Review rounds

- **WP0/WP1 review: approved.** Applied H1 (uniqueness guard on `TemplateEntry.key`), M3 (the
  `category` field), M2 (the FE-parity test), and L4 (the Markdown-table guard rejecting `|` or
  newline in `name`/`match`).
- **Playbook quality sweep:** two medium content fixes applied — the knowledge no-match
  fabrication clause (do not invent answers when the corpus has no match) and the crm-updater
  single-run approval reframe.
- This workspace was created from three research passes (skill plumbing, frontend surfaces,
  inventory and prompting) and Mahmoud's hand-written changelog-writer exemplar. The research is
  synthesized and reconciled in [research.md](research.md); the raw reports are superseded.
- The five work packages ([plan.md](plan.md)) are being implemented on the PR #5188 lane; this
  file tracks per-package progress below as slices land.

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

1. WP4: live-stack verification (running). Open agent home, walk the five tabs and 28 cards,
   drive a Sonnet builder through a matching playbook end to end.
2. Append the WP4 verification results to the PR body and request codex review.

## Deferred

- **web/oss unit tests are not wired into CI's `test:unit` mechanism.** Pre-existing gap found
  in WP3: the new `templates.test.ts` runs only via ad-hoc vitest, not the CI lane. Wiring
  web/oss into `test:unit` is out of scope for this PR.
- **Full flag-off surface delete is frozen** (decision #4). The old card-prompt gallery path
  stays behind the flag rather than being deleted in this PR.
- **Playbooks adopt the elicitation `default` field when #5190 ships.** Until then they use the
  enum-first "figure it out" pattern plus guidance in the field description.
- **The six-category split (Monitoring as its own tab) awaits click data** (decision #1).
  Monitoring stays a distinct SDK module but folds into Engineering in the visible tabs.
- **Requirement groups (allOf/oneOf) for alternative destinations are not modeled.** A card's
  `requiredIntegrations` now lists exactly the playbook's hard-required connections, keeping only
  the primary/SOLID one of an "X or Y" alternative group (the alternative stays a display-only
  `logoSlug`). Modeling a real pick-one group so the drawer could offer the alternatives as
  interchangeable connect options — and the `TemplateEntry` / `overlayReady` naming suggestions
  from the codex review — are follow-ups.

## Provenance

- 2026-07-10: workspace created (README, context, research with current code anchors, exemplar,
  playbook spec, template inventory, plan with five work packages, open questions, this file).
  Research verified against `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`,
  `web/oss/src/components/pages/agent-home/assets/templates.ts`, the runner skill engine, and the
  elicitation schema. Three factual corrections to the hand-written exemplar were made during
  synthesis (no request_input defaults, test_run delta exploration, the trigger-test button) and
  are recorded above and in [research.md](research.md).
