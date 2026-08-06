# Status

**Stage: PR1 implemented and verified; ready to push. Next: PR2.**
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

## Engineering verifications pending

- **Template system message round-trip** (PR2, before relying on round-trip
  identity): confirm the chat working copy and
  `syncChatMessagesToEntity.ts` never write the variant's system message
  into the row's `messages` column.

## Worklog

- 2026-06-09: planning workspace created from the design handoff
  (`design_handoff_playground_mode_switch/`).
- 2026-06-10: research corrected (the chat ↔ row adapter is bidirectional
  and real-time, not one-way). Scope agreed with Mahmoud; plan restructured
  into four stacked PRs; all product questions decided.
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
