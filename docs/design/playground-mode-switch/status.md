# Status

**Stage: PR1 in review (#4609). PR2 built and verified on
`feat/playground-completion-mode-for-chat` (stacked on PR1), ready to push.**
Last updated: 2026-06-10.

New session? Read [context.md](context.md) for scope and invariants,
[research.md](research.md) for the codebase map, [plan.md](plan.md) for the
PR stack. All product decisions are made; nothing is blocked on input.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Capability vs behavior | Two atoms: `is_chat` stays the capability; a playground-level override picks the behavior, consulted inside `isChatModeAtom` / `appTypeAtom` | One flag was doing two jobs; those selectors are the single seam all playground consumers already read |
| Scope | Chat apps only | A chat app in completion mode still sends ordinary chat requests; no backend changes. Chat mode for completion apps needs backend support and is a separate feature |
| Frozen conversation storage | Reuse the existing `messages` column, no new `history` column | The bidirectional adapter already reads/writes it; the switch becomes a small transform (last reply ↔ result slot) |
| Completion → chat with N rows | Picker dialog, user chooses one row | Chat working copy is keyed per playground; re-keying per row is only needed for tabs and lives in PR4. Tabs stay the end state |
| Sync gate escape hatch | Keep it: quiet, left-aligned red "Switch without syncing" | Avoids dead ends when a test set is not wanted; per design default |
| Compare mode | Toggle disabled in comparison view, tooltip explains | Simpler; avoids inventing a "focused variant" concept |
| Rollout | Toggle behind a flag until the end of PR3 | Both directions plus the sync gate must work before anyone can switch |
| Persistence | `atomWithStorage`, per-app record, key `agenta:playground:mode` | Repo pattern; survives reloads; never versioned |
| Transforms | Pure functions in `@agenta/playground` helpers, both directions written in PR2, unit tests in `tests/unit/` | Round-trip identity tests must exist from day one |

## Deferred from PR2 to PR3

These are not blockers for PR2 (the switch is lossless and runs correctly
without them); they are surfacing/polish:

- **Editable messages-column card in completion rows.** The frozen
  conversation lives in the row's `messages` column and drives runs, but
  the prompt does not reference `messages` as a variable, so the column is
  hidden ("1 unused testcase column hidden"). It is preserved and restored
  on switch-back, just not yet shown as an editable card.
- **Post-switch info banner** ("Conversation moved to the `messages`
  column...").
- **Completion → chat reverse reshaping + picker** (already PR3 scope).

## Engineering verifications

- **Template system message round-trip: verified safe (2026-06-10).** The
  ghosted template system message renders read-only from the variant
  config in `ChatMode` (`ChatMessageList` fed by `extractPromptMessages`,
  `onChange={noop}`). Nothing seeds `role: "system"` into the chat
  working copy and `extractAndLoadChatMessages` has no system handling,
  so the write-back cannot put the template message into the row. A
  system message in `row.messages` can only come from test set data,
  which is legitimately kept.

## Worklog

- 2026-06-09: planning workspace created from the design handoff
  (`design_handoff_playground_mode_switch/`).
- 2026-06-10: research corrected (the chat ↔ row adapter is bidirectional
  and real-time, not one-way). Scope agreed with Mahmoud; plan restructured
  into four stacked PRs; all product questions decided.
- 2026-06-10 (later): PR1 pushed and opened as #4609 against main (no
  stacking needed; no applied branch touches the same files). PR2 branch
  created and stacked on PR1. System-message verification done (see
  above). Mode switch transforms written as pure helpers
  (`helpers/modeSwitchTransforms.ts`) with 15 unit tests covering the
  split/merge contract and round-trip identity.
- 2026-06-10 (PR2 complete, behind a flag): wired the full chat → completion
  path. Load keeps the `messages` column for chat-capable apps; the run
  path scopes per row and sources each row's history from its own `messages`
  column (chat-shaped request, reply to the result slot);
  `switchPlaygroundModeAtom` freezes each conversation on switch; the
  `Chat | Completion` segmented control + confirm dialog live in the header
  behind `playgroundModeSwitchEnabledAtom` (default off), disabled in
  compare view. 88 package unit tests pass; both packages build; lint clean.
  Verified end to end on the dev box with the flag forced on: switching a
  chat app froze the conversation into testcase 1 (last reply shown as the
  row output), and Run posted `data.inputs.messages` = the row's frozen
  history with the `context` variable and no system-message duplication.
  Deferred items recorded above.
- 2026-06-10: PR1 done. `playgroundModeOverrideAtom` +
  `playgroundCapabilityModeAtom` + `playgroundIsChatBehaviorAtom` in
  `web/packages/agenta-playground/src/state/atoms/modeOverride.ts`;
  `isChatModeAtom` delegates to the behavior atom. Consumer audit recorded
  in research.md section 2. 7 new unit tests
  (`tests/unit/modeOverride.test.ts`), full package suite 73/73, build and
  lint green. Verified on the dev deployment: chat and completion
  playgrounds unchanged by default; a `completion` localStorage override
  flips the Chat app to the completion playground and back; a `chat`
  override on the Completion app is correctly ignored.
