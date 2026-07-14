# Status

Last updated: 2026-07-07

## Where things stand

- Design workspace created (this folder). Research done against the design handoff
  (`design_handoff_template_strip/`) and the live tree, including the uncommitted
  in-flight work (connect-gate, agentCreationPrefs, home-ux lane).
- IMPLEMENTED (uncommitted; plan LGTM'd on PR #5098): S1-S6 landed in the working tree
  on the recorded recommendations for D1-D9. S1 flag + `templateStrip` palette family +
  generated `--ag-strip-*` vars (note: the generator's FEATURES list needed manual
  entries — palette families are not auto-emitted). S2/S3 the
  `web/oss/src/components/TemplateStrip/` module (strip, chip, toast, provenance hook,
  pager math + clipboard builder with 11 vitest tests). S4 home via a new
  `StripHome.tsx` (index.tsx switches on the flag; `AgentComposer` / `UsageSummary` /
  `useAgentHomeActions` got additive optional props). S5/S6 in `AgentChatPanel.tsx` +
  `AgentChatEmptyState.tsx` + `OnboardingConfigPanel.tsx`, all behind
  `TEMPLATE_STRIP_MODE`.
- Verified: prettier + eslint clean on every touched file; `tsc` shows the same 596
  pre-existing errors as before the change (zero new); unit tests 11/11. NOT yet done
  from S7: live dev-stack QA, pixel pass, and dark-mode visual check (orchestrator owns
  the flag flip and browser work).
- Implementation deviations to review:
  - Chat panel: the strip-era composer border/radius applies only while a chip is
    docked; unchipped chats keep today's composer look (a full strip-era restyle of the
    shared chat composer felt too invasive). Home always uses the strip-era border.
  - The chat-mode (maximized) empty state also shows the strip above the composer, not
    only build mode ("every agent's empty chat" read literally).

## Open decisions for the owner

**D1. Which template field fills the composer?** The card click needs "the text that
describes the agent to build". Candidates in `AGENT_TEMPLATES`:
- `seedMessage`: a first TASK ("Triage the newest #support thread..."), not a
  description of the agent. Wrong shape for the composer.
- `templateBuilderMessage(t)` = `builderMessage` when set, else
  `"I want to build a \"<name>\" agent. <overview>"`. This is the field both existing
  builder-flow surfaces already send, and it is the build instruction by definition.
- **Recommendation: `templateBuilderMessage(t)`.** Caveat: the derived phrasing reads
  meta ("I want to build a...") next to the prototype's plain behavioral prompts
  ("Review every new pull request: summarize the diff..."). If that bothers us, the
  fix is content, not code: set per-template `builderMessage` strings in the registry
  to the prototype's style. Flagged as an optional copy task.

**D2. Agent empty-chat actions row.** The design's composer actions (Use my coding
agent + Create agent) do not fit an existing agent's chat. Proposal: on that surface
the strip only fills + chips; the composer keeps its normal send button and no extra
actions. Alternative considered and not recommended: keeping "Use my coding agent"
there (it is a build handoff, not a chat action).

**D3. Component placement.** App layer `web/oss/src/components/TemplateStrip/`, not
`@agenta/ui`. Both consumers are OSS app-layer modules and the strip depends on the
app-layer template registry + analytics helper. Package extraction deferred until a
package consumer exists (per the agenta-package-practices heuristic, this is the
"could be" case; we choose the cheaper reversible option).

**D4. Toast implementation.** Custom ~30-line `CopiedToast` (bottom-center dark pill
per the design) instead of `App.useApp().message` (top-center; restyling it globally
would leak into every message call). Failure path still uses `message.error`.

**D5. Column width on playground surfaces.** Design says max-w 780; the chat panel's
shared column (`CHAT_COLUMN`) is 880. Keep 880 on playground surfaces so the strip
aligns with the transcript, banners, and composer. Home flag-on uses the design's 780.

**D6. localStorage key.** `agenta-tpl-strip-hidden` exactly as specified (prototype
key), even though the repo convention prefixes keys with `agenta:`.

**D7. Dark-mode choices** (design is light-only): active/selected states map to
`--ag-colorPrimary` (YELLOW `#f2f25c` in dark, the app-wide convention), badge tiles
stay white in dark so brand logos stay legible, and two new palette entries
(`templateStrip.inputBorder`, `templateStrip.selectedBg`) cover hexes with no existing
role. Full table in `design.md` section 7.

**D8. Hide scope.** One shared hidden flag across BOTH playground surfaces (onboarding
and every agent's empty chat), matching the single localStorage key in the design.
Hiding in one hides in all; home is never hidden.

**D9. Copy-action analytics.** The old Continue-in-IDE modal fired no event. Proposal:
"Use my coding agent" fires `first_agent_intent` with `source: "composer"` and
`action: "coding_agent_copy"` so the handoff path stops being invisible.

## Blockers

None. All decisions above have recommendations; implementation can start on them and
adjust if the owner overrides.

## Next steps

1. Orchestrator: flip `NEXT_PUBLIC_AGENT_TEMPLATE_STRIP=true` on the dev stack and run
   the S7 live matrix (plan.md "Verification plan"), including dark mode and the
   flag-off regression cells.
2. Owner review of the deviations noted above alongside the D1-D9 recommendations.
3. Commit/lane/PR handling (orchestrator; nothing is committed yet).
