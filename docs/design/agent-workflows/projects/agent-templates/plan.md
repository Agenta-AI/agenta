# Agent templates: plan

Read [context.md](context.md) and [research.md](research.md) first. This plan assumes their
facts and cites the code anchors from research.md without repeating the reasoning. Several open
questions gate the frontend and authoring work; read [open-questions.md](open-questions.md)
before starting.

## The shape of the change, in one paragraph

The per-use-case intelligence moves from the card prompt into the build-an-agent skill as
reference playbooks. A new repo skill teaches how to write a playbook (WP0). The build-an-agent
skill body is reframed into a short router and gains an `index.md` plus one playbook per template
as bundled files, starting with the hand-written changelog-writer (WP1). The remaining playbooks
are written with the WP0 skill (WP2). The card registry grows to 28 short-seed templates with a
display-versus-required integration split and an extended PROVIDERS map (WP3). A Sonnet builder
agent then verifies the playbooks end to end and a smoke matrix checks every card (WP4).

## Work packages

### WP0: playbook format and the writing skill

Add a repo skill that encodes the playbook file format and the prompting checklist, so every
later playbook is written the same way and reviewed against one bar.

- **Scope.** A new skill at `.agents/skills/write-template-playbooks/`, following the existing
  skill layout (see `.agents/skills/build-agent/`: a `SKILL.md` plus `references/`). The SKILL.md
  body is short: the playbook skeleton, the size target, and a "read this reference when" index.
  The references hold the condensed prompting checklist ([research.md](research.md) Section 6),
  the request_input reality (no defaults), and the exemplar as a worked example.
- **Files touched.** New: `.agents/skills/write-template-playbooks/SKILL.md`,
  `.agents/skills/write-template-playbooks/references/*.md`. The symlink into `.claude/skills/`
  follows the repo's skill convention.
- **Acceptance.** A Sonnet-class author, given only this skill and one inventory row, produces a
  playbook that matches [playbook-spec.md](playbook-spec.md) without further instruction. The
  skill states the no-defaults rule, the enum-first "figure it out" pattern, and the corrected
  trigger-test copy. It does not duplicate the generic build loop or the config schema.

### WP1: skill restructure

Reframe the build-an-agent skill body into a router and attach the index plus the first
playbook.

- **Scope.**
  - Reframe the opening of `_BUILD_AN_AGENT_BODY` (`agenta_builtins.py:550`) to route by use
    case: "You build agents. Read `references/agent-templates/index.md` when the ask matches a
    template, then follow that playbook. If nothing matches, use the generic loop below." Keep
    the body a short router; the body is effectively loaded every turn
    ([research.md](research.md) Section 2), so its length is a context tax.
  - Add `references/agent-templates/index.md` (the match table, [playbook-spec.md](playbook-spec.md))
    and `references/agent-templates/changelog-writer.md` (the hand-written exemplar,
    [exemplar.md](exemplar.md)) to `BUILD_AN_AGENT_SKILL.files` (`agenta_builtins.py:713`).
  - Fix the trigger-test copy anywhere the skill or its references say "flask" or "lab icon":
    it is Lightning "Test event" for a subscription, Play "Run" for a schedule.
- **Files touched.** `sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py`. Possibly the
  reference-file drift test (`test_agenta_builtins_reference_files.py`) if an index/playbook
  coverage assertion is added (see WP2 acceptance and [research.md](research.md) constraint 9).
- **Acceptance.** With the flag paths unchanged, a run seeded with the changelog-writer card
  reads the index, opens the changelog-writer playbook, and follows it (verified in WP4). The
  body stays short. No wire or model change; editing the `files` list is the whole delivery
  ([research.md](research.md) Section 1). `read` and `bash` stay granted.

### WP2: playbook authoring

Write the remaining 27 playbooks with the WP0 skill.

- **Scope.** One playbook per inventory row under `references/agent-templates/<key>.md`, batched
  by category so a batch shares priors and integrations. Each is reviewed against the
  [playbook-spec.md](playbook-spec.md) skeleton and the WP0 checklist. Update the index match
  table as each batch lands.
- **Files touched.** `agenta_builtins.py` (`BUILD_AN_AGENT_SKILL.files` grows;
  `references/agent-templates/*.md` and the index).
- **Acceptance.** Every playbook is one to two kilobytes, maps its sections to the build loop,
  encodes required-versus-researchable context with the enum-first pattern, has a priors table
  and an instructions template that ends on the terminal side effect, and never repeats the
  generic loop. The index has a row per playbook and an explicit "no match, fall back to the
  loop" instruction. Decide here whether to add a drift test asserting the index keys match the
  playbook files present.

### WP3: frontend registry

Grow the card registry to the inventory, with short seeds and the integration split.

- **Scope.**
  - Expand `AGENT_TEMPLATES` (`web/oss/src/components/pages/agent-home/assets/templates.ts`) to
    the 28 rows, each with the short "Build a <X> that ..." `builderMessage`
    ([template-inventory.md](template-inventory.md)).
  - Split display-logo slugs from required-to-run integrations. Add a display-only field (for
    example `logoSlugs: string[]`) so the flag-off drawer's connect gate and `ToolsPreview`
    read only the genuinely required integrations, not every brand mark
    ([research.md](research.md) Section 5, [open-questions.md](open-questions.md) #5).
  - Set the category set per [open-questions.md](open-questions.md) #1 and update
    `TEMPLATE_CATEGORY_ORDER`. If six categories win, add the strip tab overflow treatment.
  - Extend `PROVIDERS` with every new slug, using the exact verified Composio keys (no
    hyphens; the CDN never 404s).
  - Add a registry-invariant unit test: unique keys, every category in the order constant,
    every logo slug in `PROVIDERS`, `builderMessage` present and short. Optionally a CDN-slug
    smoke test flagging the fallback SVG.
  - Decide the `OnboardingConfigPanel` (flag-off) handling: it lists all templates vertically
    and 28 entries scroll unusably ([open-questions.md](open-questions.md) #4).
- **Files touched.** `templates.ts`; the new registry-invariant test; possibly
  `TemplateStrip/index.tsx` (tab overflow) and `OnboardingConfigPanel.tsx` (cap or removal),
  depending on the decisions. Run `pnpm lint-fix` in `web/`.
- **Acceptance.** The strip renders 28 cards with correct logos and no silent placeholders. The
  category tabs fit the chat column. The registry-invariant test passes. The flag-off drawer, if
  kept, does not demand a connection for a display-only logo. Provenance attribution still works
  for the short seeds.

### WP4: verification

Verify the playbooks drive a real build, then smoke-test every card.

- **Scope.**
  - Sonnet builder-agent testing of the playbooks, at minimum the changelog-writer exemplar and
    one per category, end to end via `test_run`. Reuse the agent-replay-test and
    agent-workflows-qa patterns: capture a real run, pin it as a replay regression.
  - A template-by-template smoke matrix: each card opens the builder, the builder reads the
    right playbook, and the run reaches a proposed setup without stalling.
  - Set an acceptance bar for shipping a template: the builder reads the correct playbook,
    gathers the required context with one form, proposes a setup from the priors table, and
    reaches a passing `test_run` verdict on the committed agent.
- **Files touched.** Replay-test fixtures under the runner/SDK test suites; status notes in
  [status.md](status.md).
- **Acceptance.** The exemplar and one template per category pass the shipping bar. CHECK-row
  templates either pass or are held per [open-questions.md](open-questions.md) #3. The smoke
  matrix is green or its reds are documented.

## Sequencing and dependencies

- WP0 blocks WP2 (the authoring skill is how the playbooks get written) and informs WP1 (the
  exemplar and the spec).
- WP1 can start in parallel with WP0: the body reframe and the changelog-writer playbook do not
  need the authoring skill (the exemplar is already written).
- WP2 depends on WP0 and lands incrementally by category; each batch updates the index.
- WP3 is independent of the skill work and can proceed in parallel, but its category-set and
  integration-split decisions ([open-questions.md](open-questions.md) #1 and #5) gate it. Wire
  it after those are answered.
- WP4 depends on WP1 (for the exemplar) and on each WP2 batch (for the rest). Run it rolling: as
  each category's playbooks land, verify that category.

## Docs-sync note

The build-an-agent skill body change is a behavior change to a shipped contract, so the
keep-docs-in-sync rule applies in the same change. When WP1 reframes the body and WP2 adds
playbooks, update any doc that describes what the builder agent does or how templates work
(the agent-workflows documentation pages, the interface inventory if it lists the skill's
reference files, and this workspace's [status.md](status.md)). The corrected trigger-test copy
(Lightning "Test event" or Play "Run", not a flask) must land everywhere the old copy appears,
including the external `build-agent` skill if it carries the same error.
