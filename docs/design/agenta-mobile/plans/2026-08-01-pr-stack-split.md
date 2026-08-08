# Splitting `feat/agenta-mobile-wave-1` into a reviewable PR stack

**Status:** built locally 2026-08-03, unpushed
**Branch:** `feat/agenta-mobile-wave-1` — 127 commits on `main` (`ac6b1548d9`, = `v0.107.0`)

One PR of this size is not reviewable. This plan cuts it into **12 stacked PRs**, each a
single reviewable concern, ordered so every PR's base is the branch directly below it.

## Why path-partitioning was rejected

The first version of this plan proposed partitioning by **path** and replaying
chronologically, on the belief that only 3 files were touched by two lanes. That estimate was
made against a coarse lane sketch and did not survive the real assignment. A pre-flight check
over the actual commit×file matrix found **42 files touched by more than one lane, 22 of them
with an edit order no lane ordering can respect**:

- `web/turbo.json`, `web/pnpm-lock.yaml` and the dev compose files ping-pong between the
  mobile-scaffold and device-gate lanes (commits 2 → 42 → 48 → 50 → 53).
- `api/oss/src/apis/fastapi/sessions/router.py` is touched by the list lane, then the respond
  lane, then the watch lane — an order those lanes cannot stack in.
- `web/packages/agenta-shared/src/utils/mobileGate/index.ts` is gate → auth → gate.

In each case a **lower** lane would replay a **newer** version of the file underneath a higher
lane, and the higher lane's older content would win — silently dropping edits. The failure is
invisible in a per-lane diff and only shows up as a wrong final tree.

## The mechanic: contiguous ranges of the existing history

Lanes are contiguous spans of the branch's linear history. Every file's edits then appear in
lane order automatically, so the class of bug above cannot occur.

It also needs **no replay**: each lane is a branch ref at a boundary commit of the history that
was already reviewed and tested, so the stack is bit-identical to the branch rather than a
reconstruction of it. `git branch -f <lane> <sha>` per boundary; nothing is rewritten.

The cost is that lanes follow *when* work happened rather than *which tier* it touched, so a
few mix tiers (the approvals lane carries the runner's warm-park change alongside mobile UI).
The history is already grouped by theme, so in practice each span is coherent.

Verification is the chain, not a golden diff (which contiguity satisfies trivially): each
lane's `git merge-base --is-ancestor <below> <lane>` holds, the per-lane commit counts sum to
the branch total, and the top lane is the same commit as the branch tip.

## The stack (bottom → top)

Built 2026-08-03. Each lane's base is the branch directly below it; the bottom lane's base is
`main`. Commit counts sum to the branch's 127.

| # | Branch | Commits | Files | Contents |
|---|---|---|---|---|
| 1 | `feat/mobile-app-scaffold` | 8 | 37 | The `/m` skeleton: Pages Router at `basePath: "/m"`, shadcn + palette token bridge, motion presets, eslint bans (no antd, no app-layer imports), dev compose service behind Traefik. |
| 2 | `feat/api-sessions-list-ordering` | 9 | 18 | `/sessions/query` ordered by last activity (`coalesce(updated_at, created_at)`, direction-matched id tiebreak), free-text title search, latest-turn references — plus the `@agenta/entities` wire schema and fixture. |
| 3 | `feat/agenta-chat-package` | 17 | 77 | The headless `@agenta/chat` extraction. Biggest lane; see "Making the chat-package lane reviewable". |
| 4 | `feat/mobile-image-and-ci` | 5 | 12 | Production gh Dockerfile, typecheck/build workflow, gh compose wiring. |
| 5 | `feat/mobile-device-gate` | 13 | 28 | Gate decision core in `@agenta/shared`, flag-gated OSS/EE middleware (**default off**), mobile reverse gate, compose flag, UA-emulation smoke. |
| 6 | `feat/mobile-sessions-and-transcript` | 8 | 34 | `@agenta/*` wired into the app, providers + route-scoped project state, sessions list with search and paging, read-only transcript replay. |
| 7 | `feat/mobile-auth` | 4 | 10 | Session refresh before the signed-out verdict, raw email sign-in, refresh interceptor at provider scope. |
| 8 | `feat/mobile-approvals` | 19 | 40 | Approve/deny/stop from the phone, the runner's 30-minute warm park, and the chat UX mechanics (pinned headers, scroll containment, safe-area). |
| 9 | `feat/sessions-watch-and-liveness` | 16 | 37 | `GET /sessions/streams/watch` SSE relay and its mobile consumer; liveness mirror on every heartbeat, orphan sweep thresholds, handover-vs-takeover, supersession tombstones. |
| 10 | `feat/effective-turn-config` | 9 | 39 | The three-tier contract: SDK stamps `effectiveParameters` on the `/run` wire, runner echoes it onto the interaction row, API replays it on respond — plus the detached respond dispatcher. |
| 11 | `fix/desktop-session-convergence` | 7 | 34 | Desktop settles a resumed gate on replay, converges an open session through the watch relay, refreshes before reopening a dead relay; displaced-turn lock closure. |
| 12 | `feat/mobile-parity-and-consolidation` | 12 | 56 | Steer-lite behind its flag, sign-in parity (OTP/social/SSO) and the OAuth handback, consolidation Wave 0, the approval-envelope `toolName` fix, `@agenta/chat` re-sync. |

Lanes 2, 9, 10 and 11 carry backend work that does not depend on the mobile app. They sit where
the history put them, but their PRs can be read without reference to the `/m` UI.

## Making the chat-package lane reviewable

Lane 3 is the biggest by far, but almost none of it is new logic — `@agenta/chat` was
**copy-extracted** from `web/oss/src/components/AgentChatSlice`. The PR body should carry a
per-file drift table (package copy vs its OSS original) so the reviewer reads only the drifted
lines. Generate it mechanically with `git diff --no-index` per file pair.

`transcriptToMessages.ts` was re-synced to full parity on 2026-08-03 (approval-resume handling
and attachment parts); its copy header records what that covered.

Note for the PR body: `grep "@agenta/chat" web/oss/src` returns **0 hits** — OSS has not adopted
the package it was extracted from. That re-plumb is deliberately out of scope (it collides with
the open frontend queue and the antd→shadcn branch) and is tracked as Wave 2 of
`docs/design/agenta-sessions-consolidation/plan.md`.

## Risks

- **Every lane boundary falls between original commits**, so each lane's tip is a state that was
  built and tested as part of the branch. No lane is a synthesized tree.
- **GitButler stacks are linear** (root `AGENTS.md`), which is exactly what this is. Set each
  PR's `--base` to the branch below it; GitHub then shows only that lane's own delta.
- **Do not rebase a single lane in isolation.** They share history; rebase the top branch and
  re-point the boundaries with `git branch -f`, or the chain breaks.

## Sequencing suggestion

Open the stack bottom-up and let it merge in order. Contiguous lanes cannot be reordered — lane
N's commits are literally beneath lane N+1 — so the merge order is fixed by construction rather
than chosen.

That is the trade against the path-partitioned version, which could have let the independent
backend lanes merge first: here a slow review on lane 1 blocks everything above it. If a lane
stalls, the escape is to merge it as-is and open a follow-up, not to re-cut the stack.
