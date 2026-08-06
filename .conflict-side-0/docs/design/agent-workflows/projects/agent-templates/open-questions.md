# Agent templates: open questions

Six decisions, all resolved on 2026-07-10 in the PR #5188 review: Mahmoud accepted every
recommendation. #2 carries a rider: file an issue for Arda to add a real `default` field to the
elicitation protocol, and note in the issue that the template playbooks must adopt it once it
ships. The sections below keep the original context, options, and trade-offs for the record;
each now opens with its decision.

## 1. The category set: six categories versus the strip's five-plus-All ceiling

**Decided: measure first.** Ship five categories (fold Monitoring into Engineering), keep the six-way grouping in the source, revisit with click data.

**Context.** The inventory groups the 28 templates into six categories (Engineering, Support,
Sales, Monitoring, Knowledge, Ops). The strip category tabs do not wrap or scroll, and the
practical ceiling inside the 880-pixel playground chat column is about five categories plus All,
which is six tabs ([research.md](research.md) Section 5). Six categories plus All is seven tabs,
over the ceiling.

**Options.**

- **Five categories.** Merge two groups (fold Monitoring into Engineering, or Sales into Ops).
  Fits the strip with no frontend work. Costs one axis of the persona story; the founder's
  monitoring and sales cases get buried under a broader label.
- **Six categories with an overflow treatment.** Keep all six and add scrollable tabs or a
  "More" menu to the strip header. Serves all three personas cleanly. Costs frontend work on a
  tab row that has no overflow handling today.
- **Measure first.** Ship with five categories, watch which tabs users click, split to six
  later. Lowest risk, slowest to the full grouping.

**Recommendation.** Measure first: ship five categories by folding Monitoring into Engineering
(the junior-engineer and founder both already live in Engineering), keep the inventory's
six-column grouping in the source so a later split is a one-line reorder, and revisit once there
is click data. This avoids frontend tab work now and keeps the option open.

## 2. request_input defaults: live with the workaround or extend the protocol

**Decided: live with the workaround.** Enum-first "figure it out" plus guidance in descriptions. A real `default` field goes to Arda as a separate issue; playbooks adopt it when it ships.

**Update (2026-07-11): shipped and adopted.** Issue #5190 landed in PR #5177 — real `default`, plus multi-select arrays and oneOf choice cards. The playbooks, the write-template-playbooks skill, and the playbook spec now use real defaults; the enum-first workaround is retired.

**Context.** The elicitation form has no `default` field; a `default` in the schema is silently
dropped ([research.md](research.md) Section 4, `elicitation.ts:56`). The playbooks want to
propose values the user can accept or edit. Today they do it with an enum-first "figure it out"
option and guidance in the field description.

**Options.**

- **Live with the enum-plus-description workaround.** No protocol or frontend change. The user
  reads the recommendation in the description and types or picks it. Costs a small amount of user
  effort per field and reads slightly less polished than a prefilled form.
- **Add a real `default` field to the elicitation protocol.** A separate lane touching the
  protocol schema (`elicitation.ts`, the wire contract) and the frontend form
  (`ElicitationWidget`, `SchemaForm`). Gives true prefilled forms, matching the exemplar's
  original intent and lifting form completion. Costs cross-surface work and coordination, and it
  is not on the critical path for fixing the broken-prompt problem.

**Recommendation.** Live with the workaround for this project and file the `default` field as a
separate, later lane. The workaround unblocks all 28 playbooks now; the protocol change is a
real improvement but should not gate the template fix. Revisit after the playbooks ship and there
is evidence the missing prefill actually hurts completion.

## 3. Ship the seven CHECK templates now or verify their toolkits first

**Decided: ship all 28 with CHECK rows degraded to their SOLID fallback.** The CHECK integration stays display-only until its toolkit verifies.

**Context.** Seven rows depend on a Composio toolkit this pass did not verify (datadog, newrelic,
pagerduty, intercom, confluence, gitlab, attio) or on a specific access (a CI-run event, a
calendar read). The Composio CDN never 404s, so a wrong slug ships a grey placeholder silently
([research.md](research.md) Section 5, [template-inventory.md](template-inventory.md)).

**Options.**

- **Ship all 28 now.** Full catalog immediately. Risk: a CHECK template whose toolkit does not
  exist shows a placeholder logo and its playbook wires a tool that will not resolve, so the
  builder run stalls on that template.
- **Verify the seven toolkits first, ship the verified subset, add the rest as they clear.**
  Ships 21 SOLID templates plus whichever CHECK rows verify. Slower to the full 28, but no broken
  card ships.
- **Ship all 28 but degrade CHECK rows to their SOLID fallback.** Each CHECK row's playbook and
  required-to-run integration point at the SOLID fallback in its group (for example, monitoring
  rows require Sentry, not Datadog); the CHECK integration is display-only until verified. Full
  catalog, no broken required path.

**Recommendation.** Ship all 28 with CHECK rows degraded to their SOLID fallback (the third
option). The catalog looks complete, no required path is broken, and promoting a CHECK
integration from display-only to required is a one-field change once its toolkit is verified in
WP4.

## 4. Flag-off legacy surfaces: freeze, adapt, or delete

**Decided: freeze, with two carve-outs.** Cap the OnboardingConfigPanel list and delete the dead TemplateCategoryChips. Full delete is a follow-up.

**Context.** The live surfaces are strip-era. The classic gallery, the setup drawer, the
onboarding quick-pick list, and the IDE-handoff modal are reachable only with a flag flipped off
([research.md](research.md) Section 5). The gallery's Create is already a stub. The drawer's
connect gate is incompatible with logo-heavy cards. The `OnboardingConfigPanel` lists all
templates vertically, so 28 entries scroll unusably.

**Options.**

- **Freeze.** Leave the flag-off surfaces as they are; accept that they degrade with 28
  templates (a long quick-pick list, a stub gallery Create). No work. Risk: if a flag is flipped
  on for a test, the surface looks broken.
- **Adapt.** Update the flag-off surfaces to handle 28 templates (cap the quick-pick, fix the
  drawer gate). Keeps the A/B option alive. Costs work on paths nothing links to in production.
- **Delete.** Remove the flag-off constellation (classic home grid, TemplatesSection, gallery
  page, setup drawer, onboarding quick-pick, IDE modal) and the dead `TemplateCategoryChips`.
  Simplifies the registry's consumer surface. Risk: loses the A/B fallback and the gallery route.

**Recommendation.** Freeze for this project, with two cheap carve-outs: cap the
`OnboardingConfigPanel` list (a one-line slice) so a flipped flag does not show a 28-item scroll,
and delete the dead `TemplateCategoryChips`. Full delete is a reasonable follow-up once the strip
path is confirmed as the permanent surface, but it should not ride this change.

## 5. Display logos versus required-to-run integrations

**Decided: separate fields.** Add display-only `logoSlugs`; narrow `requiredIntegrations` to what the agent needs.

**Context.** In `templates.ts` today, `requiredIntegrations` does double duty: it supplies the
card logos and it is a hard connect gate in the flag-off drawer, hitting the live Composio
catalog and requiring every listed integration connected before Create
([research.md](research.md) Section 5). Several new templates show four or five brand logos but
need only one live connection to work.

**Options.**

- **One field (status quo).** Every logo is a required integration. Simple registry. Makes the
  flag-off drawer demand four or five connections per card, which is unusable, and forces every
  logo slug to be a real Composio key.
- **Separate fields.** Add a display-only `logoSlugs` array for the brand marks and keep
  `requiredIntegrations` to the genuinely required connections. The card shows every relevant
  logo; the drawer gates only on what the agent needs.

**Recommendation.** Separate fields. Add `logoSlugs` for display and narrow `requiredIntegrations`
to the required-to-run set (one per template in most rows). This fixes the connect-gate problem,
lets a card advertise its ecosystem without demanding every connection, and is the split the
inventory table already assumes.

## 6. Analytics continuity on key and category renames

**Decided: rename freely.** Mark the cutover date in the dashboard.

**Context.** Every template pick writes `templateId` (key), `templateCategory` (category), and
`intentValue = category || name` to PostHog ([research.md](research.md) Section 5). Nothing parses
these back; renames only break dashboard continuity. Recategorizing Docs to Knowledge and adding
Sales and Monitoring changes the category vocabulary; the `first_agent_intent_v1` person property
buckets by category label.

**Options.**

- **Rename freely.** Use the new keys and categories; accept that existing PostHog funnels split
  at the rename boundary. Cleanest vocabulary going forward.
- **Preserve continuity.** Keep old category labels where dashboards already segment on them
  (keep "Docs" as an alias, or map new categories onto old buckets in the analytics call).
  Preserves funnels; muddies the vocabulary.

**Recommendation.** Rename freely and mark the rename date in the dashboard. This project changes
the catalog substantially enough that pre-change funnels are not comparable anyway, and carrying
alias labels to preserve a funnel that is about to change shape is not worth the confusion. Note
the cutover date so whoever reads the funnel knows where the vocabulary changed.
