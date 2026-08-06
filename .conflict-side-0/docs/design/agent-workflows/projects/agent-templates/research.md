# Agent templates: research

This synthesizes three research passes done on 2026-07-10: skill plumbing, frontend surfaces,
and inventory-plus-prompting. The raw reports are superseded inputs; this file is the merged,
reconciled record with current code anchors. Where the reports disagreed, the resolution is
called out inline and the reconciled fact is what stands.

Read [context.md](context.md) first. This file assumes you know the broken-prompt problem and
what the project does.

---

## 1. Skill delivery and how content reaches the builder agent

### The one edit that changes delivered content

`BUILD_AN_AGENT_SKILL` is defined at
`sdks/python/agenta/sdk/agents/adapters/agenta_builtins.py:713`. It carries a body
(`_BUILD_AN_AGENT_BODY`, `:550`, about 160 lines) and two bundled files today:
`references/config-schema.md` (`_CONFIG_SCHEMA_REFERENCE`, `:110`) and
`references/trigger-inputs.md` (`_TRIGGER_INPUTS_REFERENCE`, `:414`). The new
`references/agent-templates/` files (an `index.md` plus one playbook per template) are simply
more `SkillFile` entries appended to that same `files=[...]` list. No new model, no new wire
field.

The SDK constant is the single source of truth. The static catalog imports it
(`static_catalog.py:21`) and registers `BUILD_AN_AGENT_SLUG` →
`_skill_revision(BUILD_AN_AGENT_SKILL)` (`static_catalog.py:235`). Editing the `files` list in
`agenta_builtins.py` is the entire content-delivery change.

### How it reaches a run

The build-an-agent skill is **not** a forced skill. `AGENTA_FORCED_SKILLS` holds only
getting-started (`agenta_builtins.py:732`). Build-an-agent reaches the run through the
build-kit overlay: `build_agent_template_overlay()` (`api/oss/src/core/workflows/build_kit.py:75`)
puts one `@ag.embed` in `skills` pointing at `BUILD_AN_AGENT_SLUG`, served as the static
workflow `__ag__build_kit` and layered onto the agent being built. The embed resolves
server-side to the SkillTemplate.

### Wire to disk: progressive disclosure is confirmed

The runner writes each skill to a fresh per-run temp directory
(`services/runner/src/engines/skills.ts:115`, `resolveSkillDirs`). It composes `SKILL.md` from
the YAML frontmatter (name, description) plus the body, and writes each bundled file at its
relative path, creating subdirectories (`skills.ts:158`). So `references/agent-templates/foo.md`
lands as a real nested file on disk. Pi auto-discovers the skill directory. The bundled files
are read lazily with the `read` tool; they are **not** inlined into context. Only the composed
SKILL.md (frontmatter plus body) loads when the skill triggers.

### The load-bearing read grant

`AGENTA_FORCED_TOOLS = ["read", "bash"]` (`agenta_builtins.py:63`). Once any custom tool ships,
Pi flips to granted-only builtins. If `read` were not granted, SKILL.md and the new reference
files would be announced but unloadable. The overlay grants both (`build_kit.py:78-79`). No
change needed, but the plan depends on `read` staying granted.

---

## 2. Size limits and what costs context

Hard limits, enforced on the Pydantic models on every construction path:

- `SkillFile.content` ≤ 200,000 chars each (`sdks/python/agenta/sdk/agents/skills/models.py:61`).
- `SkillTemplate.body` ≤ 50,000 chars (`models.py:93`).
- `SkillTemplate.description` ≤ 1,024 chars (`models.py:90`); `name` ≤ 64.
- `SkillFile.path` ≤ 255 chars, relative POSIX, no `..`, no backslash, not `SKILL.md`
  (`_validate_safe_skill_file_path`, `models.py:21`; re-validated in the runner,
  `skills.ts:68`). Nested directories are fine.
- No total-skill or total-wire size cap exists. The runner server enforces a concurrency limit
  only (`services/runner/src/server.ts:948`), not a body-size limit.

28 playbooks at one to two kilobytes each is about 30 to 60 kilobytes total, spread across
separate files each far under 200 kilobytes. Safe.

What actually costs context matters more than the totals:

- **Always in context:** the skill name and description (the trigger). Keep the description
  tight.
- **Loaded every turn in practice:** the SKILL.md body. The build-an-agent description tells
  the agent to read the skill at the start of the conversation (`agenta_builtins.py:716`), so
  the body is effectively loaded at conversation start each turn. The body must stay a short
  router. A big match table inline would tax every turn. Keep the full match table in
  `references/agent-templates/index.md` (read on demand) and put only a compact pointer, or a
  small compact table, in the body.
- **Read on demand only:** every file under `references/`. These never enter context until the
  agent reads them. 30 to 60 kilobytes of playbooks is cheap; the only cost is when the agent
  opens one.

---

## 3. Read-first mechanics

Three overlapping nudges make the agent read build-an-agent first:

1. **The skill description** (always in context): "ALWAYS read this skill at the start of the
   conversation, before your first reply" (`agenta_builtins.py:716`). Primary surfacing.
   `disable_model_invocation` is false, so the model can auto-invoke it.
2. **The AGENTS.md preamble** (`AGENTA_PREAMBLE`, `agenta_builtins.py:38`): "When a skill
   matches the task, read its SKILL.md fully before acting." Prepended to the author's
   instructions via `compose_instructions()` (`:743`).
3. **The forced persona** (`AGENTA_FORCED_APPEND_SYSTEM`, `:53`) plus the forced
   getting-started skill.

The reframed opening ("you build agents; read `references/agent-templates/index.md` when the
ask matches a template") goes at the very top of `_BUILD_AN_AGENT_BODY` (`:550`), and
optionally in a sharpened description. Note: the preamble and persona are still `TODO(product)`
placeholders (`:37`, `:52`); the mechanism is live but the copy is owed.

---

## 4. Builder-op reality check

The builder agent already has these ops wired, from `DEFAULT_BUILD_KIT_OPS`
(`build_kit.py:27`), all real `PlatformOp`s in `op_catalog.py:1054`: `discover_tools`,
`commit_revision`, `annotate_trace`, `query_spans`, `test_run`, `discover_triggers`,
`create_schedule`, `create_subscription`, `list_schedules`, `list_deliveries`,
`test_subscription`, `remove_schedule`, `remove_subscription`. Plus two reserved static client
tools embedded in every kit (`build_kit.py:44`): `request_connection`
(`__ag__request_connection`) and `request_input` (`__ag__request_input`). Plus the forced
builtins `read` and `bash`. Note `query_workflows` exists in the catalog but is not in the
default kit.

A playbook layers use-case specifics onto this loop. It never re-teaches the loop.

### request_input: no defaults, this is the load-bearing correction

`request_input` renders an inline form (`static_catalog.py:141`, `render: elicitation`). Its
`requestedSchema` must be a flat JSON object schema, primitive top-level properties only
(`static_catalog.py:165-174`). Supported:

- Field types: `string`, `number`, `integer`, `boolean` only. Nested objects and arrays are
  rejected (`web/packages/agenta-shared/src/utils/elicitation.ts:51`, `:120`).
- Select options via `enum` (string arrays only, `elicitation.ts:54`, validated `:122`). This
  is how a playbook offers a "figure it out" choice: as an enum value.
- `format`: `date`, `date-time`, `email`, `uri`, `multiline` (`elicitation.ts:28`).
- `title`, `description`, `minimum`/`maximum`, `minLength`/`maxLength`, `pattern` supported
  (`elicitation.ts:52-61`).
- Secrets are refused (`elicitation.ts:127`); credentials go through `request_connection`.

**Defaults are not supported.** `ElicitationFieldSchema` declares `default?: never`
(`elicitation.ts:56`). The parser ignores unknown keys and the renderer reads no `default`, so
a `default` in `requestedSchema` is silently dropped and the field renders empty.

This contradicts the exemplar's and the prompting checklist's "pre-fill every field with a
smart default." Resolution: prefilling is impossible today. A playbook instead:

- puts the recommended value in the field `description` or `title` (for example, "press Enter
  to accept: owner/repo-guess"), and
- offers an `enum` whose first option is the recommended or "figure it out" choice.

Whether to add a real `default` field to the protocol is [open-questions.md](open-questions.md)
#2. There is no multi-select.

### test_run can exercise uncommitted tools: the second correction

`test_run` accepts an optional in-memory `delta` (`op_catalog.py:1011`). The handler
(`api/oss/src/core/tools/platform_handlers.py`) resolves the committed revision, then applies
the delta in memory (`_resolve_revision_delta`, `:218-230`) and runs against the merged
revision. The delta may only touch the `parameters` subtree
(`_DELTA_ALLOWED_ROOT`, `_validate_delta_scope`, `:74`, `:177`); tools live at
`parameters.agent.tools`, so a full uncommitted tools list can be passed. Lists replace
wholesale, so the delta must carry the entire tools list (existing plus the new one).

This corrects the exemplar's suggestion that exploration needs "commit, stop the turn, ask the
user to continue." The explore-via-test_run path is real: pass the uncommitted gateway tools in
`test_run`'s `delta.set.parameters.agent.tools` and run without committing. Caveat: a gateway
tool still needs a ready connection slug to resolve at run time, exactly as a committed one
does. The commit-and-stop path stays only as a noted fallback for when the flow cannot carry
the delta, not because test_run cannot see uncommitted tools.

### The trigger-test button is Lightning "Test event" or Play "Run", not a flask

The trigger UI lives in `web/packages/agenta-entity-ui/src/gatewayTrigger/drawers/`.

- **Subscriptions (event triggers):** a Lightning icon labeled "Test event"
  (`TriggerSubscriptionDrawer.tsx:1753`, `:1810`), which opens an `EventSourcePicker` to
  sample or wait for a real provider event. There is also a "Run in playground" button, also
  Lightning (`:1970`).
- **Schedules:** a Play button labeled "Run" (`TriggerScheduleDrawer.tsx:959`, `handleRun`).
- **Deliveries drawer:** a Play "Run" action (`TriggerDeliveriesDrawer.tsx:187`).

The Flask icon is used for Evaluations only (`PlaygroundRouter/index.tsx:28`,
`RunEvaluationButton.tsx:48`), not for triggers. This corrects the exemplar's and the
checklist's "click the lab/flask icon, then test trigger." Correct copy: for an event
subscription, "click the Lightning Test event button (or Run in playground)"; for a schedule,
"click the Play Run button."

### The first message the builder agent sees

For a template card (gated by `NEXT_PUBLIC_AGENT_TEMPLATE_BUILDER`),
`useTemplateSelect.ts:41` calls `createAgent({name, seedMessage: templateBuilderMessage(template)})`.
`templateBuilderMessage` (`assets/templates.ts:85`) returns the template's explicit
`builderMessage` if set, else a derived "Create an agent that <overview lowercased>". The seed
is stashed on the new revision (`useCreateAgent.ts:102`) and sent as the first user message on
the new playground (`firstRunSeed.ts:9-21`). So the builder agent sees, verbatim, the card's
short seed prompt. The reframed skill opening must classify that natural-language request
against the index, including free-text asks that match no card.

---

## 5. Frontend surfaces and their constraints

The registry is `web/oss/src/components/pages/agent-home/assets/templates.ts`. It defines the
`AgentTemplate` interface (`:24-57`), `RequiredIntegration` (`:15-22`), the `PROVIDERS` slug
map (`:62-69`, 6 slugs today), the `composioLogo(slug)` CDN helper (`:60`),
`templateBuilderMessage` (`:85-87`), and `TEMPLATE_CATEGORY_ORDER` (`:90`). There are no EE
overrides; the EE gallery re-exports OSS.

### Live surfaces versus flag-off surfaces

Per the "no runtime flag injection" rule, the two mode flags are not synced into the entrypoint
env, so production runs the defaults: strip mode and builder mode are on. The **live** surfaces
are strip-era:

- `StripHome` (`web/oss/src/components/pages/agent-home/StripHome.tsx`) and the two
  `AgentChatPanel` strips (onboarding hero and fresh-agent empty chat).
- `TemplateStrip`, `StripCard`, `IntegrationBadges`, `TemplateChip`, `useTemplateProvenance`,
  `useStripPager`.

The **flag-off** surfaces (reachable only with a flag set to `false`): `ClassicAgentHome` grid,
`TemplatesSection`, the `TemplatesGallery` page (still routable at `/apps/agent-templates`, but
nothing links to it in strip mode, and its Create is a stub), `TemplateSetupDrawer`,
`ContinueInIdeModal`, and the `OnboardingConfigPanel` quick-pick. `TemplateCategoryChips` is
dead code with no importers.

### Category tab ceiling: about 5 plus All

The strip category tabs render in a non-wrapping flex header with no overflow, wrap, or scroll
handling (`TemplateStrip/index.tsx:120-149`). The agent-chat strip lives inside the playground
chat column (about 880 pixels minus padding). Budget: the "Templates" label plus the right
cluster (counter, arrows, menu) leaves roughly 600 pixels; each tab is about 70 to 110 pixels.
The practical ceiling is about six tabs including All, so about five categories plus All. This
collides with the inventory's proposed six categories (see the conflict resolution below and
[open-questions.md](open-questions.md) #1).

### Pager constants

`TemplateStrip/assets/pagerMath.ts` hardcodes `CARD_WIDTH = 238`, `CARD_GAP = 14`,
`PAGE_SIZE = 3` (`:3-5`), which must match `StripCard`'s `w-[238px]` and the scroller's
`gap-[14px]`. 28 cards work (horizontal scroll plus pager); the counter window still reads
correctly ("1-3 of 28"). `pagerMath.test.ts` is pure math and parameterizes card count, so more
templates do not break it.

### Logos, PROVIDERS, and the silent CDN fallback

Logos come from one CDN pattern, `https://logos.composio.dev/api/${slug}` (`templates.ts:60`),
rendered by `IntegrationBadges`, `ProviderMarks`, `IntegrationRow`, and `ToolsPreview`. A slug
not in `PROVIDERS` is silently dropped from strip and classic cards
(`IntegrationBadges.tsx:17`, `ProviderMarks.tsx:13`), so every new template slug must be added
to `PROVIDERS`. The CDN **never returns 404**: an unknown or misspelled slug (tested
`new-relic`, `google-sheets`) returns a 200 grey placeholder SVG. Use exact Composio keys
(`newrelic`, `googlesheets`, no hyphens). A byte-size or content check on the fallback SVG
(`composio-fallback-grid`) is a viable smoke test.

### The drawer connect-gate problem

In the flag-off `TemplateSetupDrawer`, `requiredIntegrations` does double duty: it is the logo
lookup key **and** a hard Create gate that requires every listed integration to be connected
(`TemplateSetupDrawer/index.tsx:64-71`). `IntegrationRow` hits the live Composio catalog
(`useToolIntegrationDetail(slug)`, provider "composio"), so a slug must be a real Composio key
or the detail fetch 404s. Templates that show four or five integration logos would demand four
or five live connections before Create, making the flag-off drawer path nearly unusable. This
is why display logos should split from required-to-run integrations (a new display-only field);
see [open-questions.md](open-questions.md) #5. Empty `tools[]` also renders a "0 tools" empty
group in `ToolsPreview` (drawer only); `templateToolCount` has no other consumer.

### Provenance verbatim match

`useTemplateProvenance.resolveTemplateName` compares the composer text to the seeded builder
message verbatim (`:91-98`) to attribute the template name. Shortening `builderMessage` to a
one-liner is safe (the comparison is against whatever was seeded), but shorter seeds make user
edits more likely, which drops attribution more often. Acceptable, but know it. The registry can
never be empty: `AGENT_TEMPLATES[0]` is used as a chip sizing placeholder (`:112`).

### Analytics

Every pick site captures `template` (name), `templateId` (key), `templateCategory` (category),
`mode`, `surface`, and `intentValue = category || name` into PostHog
(`captureFirstAgentIntent`, `assets/onboardingAnalytics.ts:38-54`). Nothing in code parses
these back; renames only break dashboard continuity. Renaming a category (for example "Ops" to
"Operations") splits the `first_agent_intent_v1` person-property funnel. Renaming keys changes
`templateId`. See [open-questions.md](open-questions.md) #6.

### Tests

Only two tests touch this area: `pagerMath.test.ts` (pure math, count-agnostic) and
`codingAgentClipboard.test.ts` (install command text). Nothing imports `templates.ts`, the
gallery, the drawer, or the provenance hook. The revamp should add a registry-invariant unit
test: unique keys, every category in the order constant, every logo slug in `PROVIDERS`,
`builderMessage` present and short. Optionally a CDN-slug smoke test that flags the fallback
SVG.

---

## 6. Prompting checklist, condensed to the load-bearing rules

The full 27-rule checklist from the inventory-and-prompting report distilled to the rules a
playbook author must not skip. These become the WP0 authoring skill; the full list lives there.

**Write a procedure a weaker model executes.**

- Write per-run behavior as an explicit numbered procedure, not prose. A Sonnet-class model
  follows a chronological step list far more reliably than a paragraph.
- Name the exact tool at each step (`LIST_PULL_REQUESTS`, `SEND_MESSAGE`), not the capability.
- Make the last step the terminal side effect and say "finish by doing step N." Multi-tool runs
  do the reads then wander and stop short before the write. This is the core reliability
  finding.
- Pin concrete ids (channel id, repo, owner) once; do not tell the agent to re-resolve them
  each fire.
- Prefer the narrowest filtered tool (`FIND_*`, `GET_A_*`) over `LIST_ALL_*` dumps. A big
  payload pushes the agent toward a shell tool, which trips a separate approval gate and
  derails the run.

**Design the use case, not the loop.**

- Use decision tables for branching (release process to trigger type), not prose conditionals.
- Give one default with a brief escape hatch, never a menu of equals. Too many options with no
  clear default is a top cause of the agent pursuing unproductive paths.
- Provide a concrete output-format template (the shape of a release note, a digest). Agents
  pattern-match a template better than a described format.
- Keep a short "Gotchas" list of environment facts that defy assumption (for example, triggers
  do not follow a new revision, so re-point them after commit).
- Encode the problem decomposition and the access the use case needs, so a Sonnet-class model
  does not re-derive it. This is the exemplar's core intent.
- Add what the model lacks, omit what it knows. A playbook carries the use-case procedure,
  defaults, and tools, not a definition of what a PR or a cron is.

**Elicit with forms, corrected for our runtime.**

- Minimize required fields; completion drops sharply as field count rises.
- Separate required context (must ask) from researchable context (offer "figure it out" as the
  first enum option) explicitly in the playbook. Do not leave the ask/research boundary to the
  model.
- Put the recommended value in the field description or title. Prefilled defaults are not
  available (Section 4).
- Never request secrets via `request_input`; route credentials to `request_connection`.
- Echo the plan in plain language before executing (before commit, before creating a trigger)
  so the user can veto.

**Verify against our runtime.**

- Explore before proposing: wire read tools, run a `test_run` (with a delta for uncommitted
  tools), then show the user a concrete example before committing the full setup.
- After every commit, run `test_run` and read the `verdict` and the tools line, not a 200. An
  `incomplete` verdict means rewrite the instructions blunter and re-test.
- Trigger verification is two-phase: first fire an artificial test message as if the trigger
  fired; only if that passes, hand the user off to the real trigger test (the Lightning "Test
  event" button for a subscription, the Play "Run" button for a schedule; Section 4).
- For an external write, confirm the side effect by reading it back. A returned tool result
  alone is not proof.

---

## Constraints (hard limits)

1. **request_input has no default or prefill** (`elicitation.ts:56`). Use an `enum` first
   option and put guidance in the description. Field types string/number/integer/boolean only;
   no arrays, no nested objects, no multi-select; secrets refused.
2. **The SKILL.md body is effectively always in context** (the description forces a read at
   turn start). Keep it a short router; put the match table and per-template detail in on-demand
   `references/agent-templates/` files.
3. **Reference files are lazily read from disk**, not injected (`engines/skills.ts`), so 30 to
   60 kilobytes of playbooks is cheap. The only cost is opening one.
4. **`read` and `bash` must stay granted** (`agenta_builtins.py:57-63`) or SKILL.md and the
   reference files become unloadable. The overlay grants them.
5. **Build-an-agent is delivered only via the build-kit overlay embed.** Editing the `files`
   list in `agenta_builtins.py:713` is the entire content change.
6. **SkillFile path rules:** relative POSIX, ≤255 chars, no `..`, no backslash, not `SKILL.md`;
   nested directories are fine.
7. **test_run delta is scoped to `parameters`** and lists replace wholesale; pass the full
   tools list, not just the new tool.
8. **The trigger-test affordance is Lightning "Test event" (subscriptions) or Play "Run"
   (schedules), not a flask.**
9. **A drift test guards `config-schema.md`** (`test_agenta_builtins_reference_files.py`,
   referenced at `agenta_builtins.py:108`). New reference files do not break it unless they
   touch config-schema content, but an equivalent index/playbook drift test is worth deciding
   on ([open-questions.md](open-questions.md), and WP2 acceptance).
10. **The card registry can never be empty** (`useTemplateProvenance.tsx:112` uses
    `AGENT_TEMPLATES[0]` for chip sizing).
11. **Every logo slug must be in `PROVIDERS`** or it silently disappears; the Composio CDN never
    404s, so a typo ships a grey placeholder. Use exact Composio keys.
12. **The strip category tab row does not wrap or scroll**; the practical ceiling is about five
    categories plus All inside the 880-pixel chat column.
13. **The flag-off drawer's `requiredIntegrations` is a hard connect gate** hitting the live
    Composio catalog; logo-heavy cards make that path unusable unless display logos split from
    required integrations.

---

## Conflicts between the source reports and how they resolve

The three reports agreed on the mechanics but disagreed on three facts and one number. Each is
resolved above; collected here so a cold reader sees the corrections in one place.

1. **Prefilled defaults.** The exemplar and the prompting checklist (rules 20 and 21) say
   pre-fill every field with a smart default. The plumbing report proved `request_input` has no
   `default` field (`elicitation.ts:56`). Resolved: prefill is impossible today; use enum-first
   plus description guidance. Adding a real `default` field is an option, not an assumption
   ([open-questions.md](open-questions.md) #2). The exemplar and spec in this workspace are
   corrected accordingly.
2. **Exploring uncommitted tools.** The exemplar said exploration may need "commit, stop the
   turn, ask the user to continue." The plumbing report proved `test_run` exercises uncommitted
   tools via `delta` (`platform_handlers.py:218-230`). Resolved: the test_run delta path is the
   primary explore path; commit-and-stop is only a noted fallback.
3. **The trigger-test button.** The exemplar and rule 26 said "click the lab/flask icon." The
   plumbing report proved the flask is for Evaluations and the trigger test is Lightning "Test
   event" (subscriptions) or Play "Run" (schedules). Resolved: corrected copy everywhere in
   this workspace.
4. **Category count.** The inventory report proposed six categories (Engineering, Support,
   Sales, Monitoring, Knowledge, Ops). The frontend report measured a strip ceiling of about
   five categories plus All. Resolved as an open conflict: [open-questions.md](open-questions.md)
   #1 presents five categories, six with an overflow treatment, or measure-first as the options;
   the inventory table keeps the six-category grouping so a five-category collapse is a mechanical
   merge, not a re-sort.
