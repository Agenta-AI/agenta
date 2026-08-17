# v0.112 post-audit scope: what landed after the drift audit

Scope inventory for reconciling `lane/mobile-extracted-packages` (PR #6065) with the v0.112 release
line. **Enumeration only — nothing analysed in depth yet.** The per-PR analysis is the next step.

## Refs

| Ref | SHA | Note |
| --- | --- | --- |
| Fork point | `613368b81b94e4e5f8bcb1447857e61105b62ef1` | lane's merge-base with every release branch |
| Audit-time `REL` | `4af155162be0dd25ba00792c20b3d296a3a9b21e` | tip of `release/v0.112.0` when the drift audit ran (2026-08-11) |
| `release/v0.112.0` now | `ab084b5335ea476eaf1b24a4e8d6d8038c4b8054` | +118 commits since the audit |
| `release/v0.112.1` | `19b9ab236796263cc281115a2e572eefb1bb9d7d` | +103 commits on 0.112.0 |
| `release/v0.112.2` | `247caebc7cb9afea3f48fbe64114c513b0f4b317` | +2 commits on 0.112.1 |
| tag `v0.112.1` | `ce42dd37f2190cd0e465c24cfa8527b3f1c44996` | points inside the 0.112.1 range, not at its tip |
| lane tip | `7d2cd2ce89cb7d6f687569caa131054742788e76` | PR #6065, base `release/v0.112.0` |

**The chain is strictly linear:** `0.112.0` ⊂ `0.112.1` ⊂ `0.112.2`. Nothing forked sideways.

**`0.112.2` carries no code.** Its entire delta over `0.112.1` is 13 version-bump files
(`pyproject.toml`, `uv.lock`, `package.json`, `Chart.yaml`). **Reconcile against `0.112.1`;**
`0.112.2` follows for free.

The lane is **311 commits** behind `0.112.2`.

---

## The reconciliation is much smaller than the commit count suggests

| Measure | Files |
| --- | --- |
| Release-side `web/` changes since the fork | 558 |
| Lane-side `web/` changes since the fork | 1290 |
| **Colliding — both lines changed the same file** | **153** |
| Release-only — nothing on the lane touches them | 405 |

So ~73% of the release-side work lands on files the lane never touched and should absorb cleanly.
The 153 collisions are the actual work, and they concentrate hard:

| Area | Colliding files |
| --- | --- |
| `web/oss/src` | 95 |
| `web/packages/agenta-entities` | 11 |
| `web/packages/agenta-chat` | 9 |
| `web/packages/agenta-ui` | 7 |
| `web/packages/agenta-entity-ui` | 7 |
| `web/packages/agenta-sessions` | 5 |
| `web/packages/agenta-shared` | 3 |
| `web/packages/agenta-sessions-ui` | 3 |
| `web/mobile/src` | 3 |
| `web/packages/agenta-playground` | 2 |
| build/config (`pnpm-lock`, `pnpm-workspace`, tailwind tokens) | 3 |

**Expect the same Class B hazard as the audit found:** where a release-side PR fixed a
`web/oss/src` file the lane has moved into a package, a clean merge will silently keep the lane's
pre-fix package copy. The 95 `oss/src` collisions are where to look first.

---

## Segment A — after the audit tip, still on `release/v0.112.0` (25 PRs)

Frontend-relevant unless marked. `pkg` = `web/packages`, `oss` = `web/oss/src`, `mob` = `web/mobile`.

| PR | Merge | Files | Areas | Branch |
| --- | --- | --- | --- | --- |
| #5974 | `ab084b5335` | 26 | pkg oss | `fix/session-ux-followups` |
| #5973 | `74b89c28b8` | 51 | pkg oss | `chore/palette-cleanup` |
| #5946 | `91c83794f1` | 28 | oss | `feat/build-mode-files-pane` |
| #5945 | `54aa0e1d1f` | 12 | pkg oss | `feat/agent-flat-navigation` |
| #5944 | `f0a873bbe9` | 14 | pkg oss test | `fix/empty-sessions-and-drive-views` |
| #5943 | `253e83ea2e` | 84 | pkg oss mob test | `feat/warm-recolor-and-playground-ux` |
| #5941 | `f06a1c7d5f` | 1 | oss | `feat/agent-playground-no-deploy` |
| #5817 | `dad1982e55` | 29 | pkg oss test | `code/agenta-chat-slash-commands` |
| #5942 | `dc680cac05` | 3 | oss | `fix/adoption-guard-waiting-card` |
| #5939 | `a9c18acbd1` | 7 | pkg oss test | `fix/pinned-automation-trigger-name` |
| #5923 | `5643b1317a` | 4 | oss | `fix/observability-utc-range` |
| #5938 | `51a7f916ea` | 1 | pkg | `fix/mobile-typecheck-agentaapi-import` |
| #5927 | `1a280fd7c0` | 81 | pkg oss mob test | `frontend/session-ux` |
| #5932 | `fefbb8b4eb` | 27 | pkg oss test api sdk svc | `fix/transcript-parity` |
| #5919 | `fd60ace2a3` | 56 | pkg oss test api svc | `feat/interaction-card-lifecycle` |
| #5522 | `181f82310a` | 3 | pkg test | community (`mannietech15`) |
| #5830 | `afccaab2eb` | 7 | oss docs | community — `fix/5543-deleted-session-resurrects` |
| #5928 | `13858a6151` | 47 | pkg api sdk svc | `clients/session-ux-contract` |
| #5929 | `606d64a602` | 58 | api | `api/session-ux-contract` |
| #5930 | `499aaf2811` | 4 | api | `fix/subscription-reference-422` |
| #5931 | `79e378a3fb` | 2 | api | `fix/schedule-cron-row-isolation` |
| #5966 | `50da580a45` | 1 | other | `fix/mobile-image-unused-patch` |
| #5926 | `7e1342d772` | 8 | docs | `docs/session-ux-handoff` |
| #5916 | `e2b5d1b9ad` | 7 | docs | `docs/client-tool-interaction-lifecycle` |
| #5599 | `3db504c638` | 5 | docs | `code/docs-responsiveness-audit` |

**Note:** #5919, #5927, #5932 are the PRs the parked card-lifecycle port was waiting on
(see the `project_card_lifecycle_port_blocked` memory) — they are now merged and in scope.

## Segment B — `release/v0.112.0` → `release/v0.112.1` (26 real PRs)

| PR | Merge | Files | Areas | Branch |
| --- | --- | --- | --- | --- |
| #5995 | `3bc76b209d` | 172 | pkg oss test api sdk svc docs | `feat/provider-connections-api` |
| #5994 | `4da9581b90` | 158 | pkg oss test api sdk svc docs | `feat/runner-subscription-status` |
| #6001 | `9b88ddeae7` | 148 | pkg oss test api sdk svc | `feat/ai-providers-settings` |
| #5975 | `792fbcd927` | 71 | pkg oss test | `code/schedule-trigger-drawer-arch` |
| #5993 | `698d2c1b67` | 20 | pkg oss test docs | `fix/web-session-openability` |
| #6024 | `53a9d82890` | 15 | pkg oss test | `fix/rel112-harness-command-and-phantom-subscriptions` |
| #6005 | `de4e3eaca0` | 15 | pkg oss | `feat/age-4109-session-keyboard-shortcuts` |
| #6016 | `5826af7422` | 5 | oss | `fix/drive-files-pane-chrome` |
| #6018 | `c4c8f0e94b` | 4 | oss | `fix/sidebar-rail-alignment` |
| #6019 | `af8fb0abd3` | 2 | oss | community — `fix/5967-usage-failure-rate` |
| #6008 | `a5d3ef9146` | 2 | oss | `fix/age-4116-chat-file-link-wrong-file` |
| #6002 | `c0956c90c2` | 2 | pkg | `fix/age-4108-elicitation-textarea-resize` |
| #6009 | `a3e118e5df` | 5 | oss svc | `agent/fix-absolute-chat-file-links` |
| #5991 | `7b2a2af44b` | 27 | api | `fix/sessions-headless-title-and-references` |
| #5992 | `3e73ed3ded` | 7 | svc | `fix/runner-typed-session-references` |
| #6006 | `7d94ed72ec` | 4 | sdk svc | `agent/human-readable-agent-trace-output` |
| #6014 | `f299752475` | 6 | svc docs | `agent/increase-tool-timeout` |
| #6017 | `212c3a8164` | 1 | svc | `fix/rel112-platform-guidance-tests` |
| #5985 / #5987 | — | 7 / 9 | docs | plan docs for the provider work |
| #6030 / #5978 / #5924 | — | 56 / 32 / 3 | docs | automated API-doc regeneration |
| #6036 / #6023 / #5937 / #5936 | — | small | chore | patch + all-contributors |

**`fix/sidebar-rail-alignment` (#6018) overlaps drift findings D-15/D-16/D-17 directly** — check
whether it supersedes or conflicts with them before doing that work twice.

## Segment C — `release/v0.112.1` → `release/v0.112.2`

One merge, #5988, promoting `release/v0.112.1`. Version bumps only. **No analysis needed.**

## Excluded as no-new-work

- **#5827** (`728f39f9df`, 846 files) — promotes `release/v0.112.0` into `0.112.1`. `0.112.0` is an
  ancestor of `0.112.1`, so it introduced nothing.
- **#5988** (`0af145e4c0`, 380 files) — same, `0.112.1` into `0.112.2`.
- Integration merges (`Merge branch 'main' into …`) — 10 of them across the range.

Counting a promotion merge's diff as work is the easy mistake here: those two alone would inflate
the scope by 1226 file-changes that are already counted elsewhere.

---

## The set a conflict-based merge will NOT protect you from

The 153-collision figure above only counts files **both** lines changed. It misses release-side fixes
to app files whose behaviour now lives in a package on the lane. Of the **239** app-layer
(`web/oss/src`, `web/ee/src`) files the release changed since the fork:

| Bucket | Files | What a merge does | Risk |
| --- | --- | --- | --- |
| **A1** — existed at fork, lane **moved it into a package** | 47 (45 non-test) | modify/delete **conflict** | Flagged, but the natural resolution ("we deleted it — keep deleted") silently discards the fix |
| **A2** — **created by the release** after the fork | 63 (25 non-test) | adds the file to the app layer | Lands in the app layer with no package home; a placement decision, not a loss |
| **B** — lane turned it into a **re-export shim** | 2 | clean merge | **Silent.** The fix lands in dead code |
| **C-dual** — still a real app file, but a **package twin exists** | 7 | clean merge | **Silent.** The fix lands in whichever copy the app no longer renders |
| C-rest | ~120 | clean merge | Normal |

**Nine files (B + C-dual) merge cleanly and put the fix in the wrong copy.** Those are the ones no
process catches:

- `AgentChatSlice/hooks/useSessionActions.tsx` → `agenta-sessions-ui/src/useSessionActions.tsx`
- `AgentChatSlice/state/liveness.ts` → `agenta-entities/src/session/core/liveness.ts`
- `Sidebar/dynamic/useSidebarDynamicChildren.ts` → `agenta-navigation/src/dynamic/useSidebarDynamicChildren.ts`
- `pages/sessions/components/SessionListCard.tsx` → `agenta-sessions-ui/src/SessionListCard.tsx`
- `agent-home/.../YourAgentsTable/useAgentActivity.ts` → `agenta-home-ui/src/useAgentActivity.ts`
- `DrillInView/DrillInFieldHeader.tsx` → `agenta-ui/src/drill-in/core/DrillInFieldHeader.tsx`
- `Layout/assets/styles.ts` → `agenta-ui/src/utils/styles.ts`
- shims: `Sidebar/components/SidebarSkeletonLoader.tsx`, `state/observability/dashboard.ts`

*(Detected by basename match against the lane's package tree; `constants.ts` / `helpers.ts` hits were
discarded as noise. The list is therefore a floor — a package copy that was **renamed** during
extraction, as several were, will not appear. Confirm against the move map in the drift inventory.)*

### A1 — the 45 fixes that need re-homing, by destination package

| App path (release fixed it) | Lane destination |
| --- | --- |
| `AgentChatSlice/assets/{loadSession,transcriptToMessages,messageParts,sessionOpenTarget}.ts` | `@agenta/chat`, `@agenta/sessions` |
| `AgentChatSlice/state/{panelLayout,pendingSessionOpen}.ts`, `hooks/useAgentModelKeyStatus.ts` | `@agenta/chat` |
| `Drives/*` (18 files) | `@agenta/entity-ui/drive`, `@agenta/entities/drive` |
| `Sidebar/dynamic/{registry,sessionsSource,types}.ts`, `engine/{SidebarMenu,SidebarShell,types}` | `@agenta/navigation`, `@agenta/navigation-ui` |
| `pages/agent-home/{assets/templates.ts,components/Home*Section.tsx,TemplatesSection/TemplateCard.tsx}` | `@agenta/home-ui`, `@agenta/entities/workflow` |
| `pages/overview/agent/AgentFilesCard.tsx` | `@agenta/entity-ui/agent` |
| `pages/settings/{Triggers/*,assets/navigation.ts}` | `@agenta/settings{,-ui}` |
| `lib/atoms/sidebar.ts`, `lib/helpers/dateTimeHelper/index.ts` | `@agenta/navigation`, `@agenta/shared` |
| `styles/{theme-variables,code-editor-styles}.css` | `@agenta/ui/styles` |
| `state/newObservability/atoms/controls.ts`, `components/Filters/Sort.tsx` | `@agenta/observability` |

`styles/theme-variables.css` is worth singling out: **#5973 `chore/palette-cleanup`** (51 files)
touched the palette, and the lane's copy of that file lives in `@agenta/ui`. That is the same shape
as drift finding D-01 — a token-layer change that goes silently missing and then degrades every
surface at once.

### Recommended detection method for the per-PR pass

For each release PR, do not ask "does it merge cleanly". Ask, per changed app file:

1. Does the path exist on the lane? → no: it is A1 or A2, decide which by checking the fork.
2. If yes, is it a shim, or does a package twin exist? → then the fix belongs in the package.
3. Only if neither: a normal merge is correct.

This is the same question the drift audit's Step 3 asked, run forward against new work instead of
backward against old.

## Suggested next steps

1. **Triage the 153 collisions first**, starting with the 95 in `web/oss/src` — that is where the
   Class B "clean merge keeps the stale package copy" hazard lives.
2. **Check #6018 against D-15/D-16/D-17** before executing those work packages.
3. **Fold #5919 / #5927 / #5932** into the plan — the card-lifecycle port was explicitly blocked on
   them and is now unblocked.
4. Decide whether the three large provider PRs (#5995, #5994, #6001 — 478 files together) are in
   scope for this lane or belong in a follow-up; they are mostly API/SDK with a frontend surface.
5. Re-run the Class A method against `4af155162b..origin/release/v0.112.1` once the collisions are
   triaged; the drift inventory's Class A section only covers up to the audit tip.
