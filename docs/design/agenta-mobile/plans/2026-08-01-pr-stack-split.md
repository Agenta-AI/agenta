# Splitting `feat/agenta-mobile-wave-1` into a reviewable PR stack

**Status:** proposed
**Branch:** `feat/agenta-mobile-wave-1` — 123 commits, 293 files, +28 989 / −391 on `main` (`7c395dbecf`)

One PR of this size is not reviewable. This plan cuts it into **12 stacked PRs**, each a
single reviewable concern, ordered so every PR's base is the branch directly below it.

## Why the branch splits cleanly

The work is already close to path-partitioned. Measuring every commit's files against
candidate lanes:

- **Only 3 files are touched by two different lanes**: `api/oss/src/apis/fastapi/sessions/models.py`,
  `.../sessions/router.py` (session-list lane, then watch lane) and
  `services/runner/src/engines/sandbox_agent/run-turn.ts` (liveness lane, then config lane).
  In all three cases the lanes are **chronologically ordered the same way they stack**, so a
  chronological replay puts the earlier hunks in the lower lane and the later hunks in the
  upper one. No file needs a hunk-level split.
- Every other file belongs to exactly one lane.
- Roughly a dozen commits touch two areas (e.g. an `api` change plus its `web/mobile`
  consumer). Splitting a *commit* by path is trivial; it is splitting a *file* that hurts,
  and that case does not arise.

## The stack (bottom → top)

Sizes are added lines, measured per lane.

| # | Branch | Lines | Contents |
|---|---|---|---|
| 1 | `feat/api-sessions-list-ordering` | 853 | `/sessions/query` ordered by last activity (`coalesce(updated_at, created_at)`, direction-matched id tiebreak), free-text title search, latest-turn references on rows. Includes the `@agenta/entities` wire schema + fixture, and deletes desktop's now-redundant client-side sort. |
| 2 | `fix/sessions-liveness-and-locks` | 2 390 | Heartbeat writes the liveness mirror on every beat; stale `alive` lock = handover, not turn takeover; **supersession tombstones** (`displaced ⇒ dead`); orphan sweep's two thresholds (300 s running / 1800 s idle); runner's 30-minute approval park; orphaned-gate settle. Subtle concurrency work — the lane that most deserves its own review. |
| 3 | `feat/api-sessions-watch-sse` | 1 285 | Per-session watch events on the durable Redis plane + `GET /sessions/streams/watch` (metadata-only SSE, 15 s heartbeats, pinned client reconnect delay). |
| 4 | `feat/api-interactions-respond-answer` | 562 | Compose the approval answer for the detached `POST /sessions/interactions/{id}/respond` path. |
| 5 | `feat/effective-turn-config` | 1 059 | Three-tier contract, must stay one PR: SDK stamps `effectiveParameters` on the `/run` wire (session runs only, credential-stripped, 64 KB cap) + hydrates references when the caller sent no config; runner echoes it onto the interaction row; API replays it on respond. |
| 6 | `feat/agenta-chat-package` | 6 297 | The headless `@agenta/chat` extraction. Biggest lane by far, but ~verbatim copies out of `web/oss` — see "Making lane 6 reviewable". |
| 7 | `feat/entities-session-wire` | ~307 | `@agenta/entities/session` additions the mobile app and desktop share. |
| 8 | `fix/desktop-session-convergence` | ~250 | Desktop settles a resumed turn's approval gate on replay, converges an open session through the watch relay, and refreshes before reopening a dead relay. Touches `AgentChatSlice` — small, isolated, high-scrutiny. |
| 9 | `feat/mobile-device-gate` | ~700 | `@agenta/shared` gate decision core + flag-gated OSS/EE middleware (**default off**) + compose flag + UA-emulation smoke. |
| 10 | `feat/mobile-app-scaffold` | ~1 400 | The `/m` app skeleton: Next.js Pages Router at `basePath: "/m"`, shadcn + palette token bridge, motion presets, eslint bans, workspace wiring, Dockerfile, compose service, CI typecheck/build, entrypoint. |
| 11 | `feat/mobile-auth` | ~600 | Session-refresh interceptor at provider scope, sign-in parity (email OTP, social providers, org SSO), mobile-initiated OAuth callback handback. |
| 12 | `feat/mobile-sessions-and-chat` | ~1 900 | Sessions list + transcript replay, approval dock, stop, steer-lite, markdown rendering, live-relay consumption, and the Wave-0 consolidation commits. Split into 12a (list/transcript) and 12b (chat/approvals) if it reads too large. |

**Lanes 1–5 do not depend on any mobile code.** They are ordinary backend improvements and
can merge to `main` as soon as they are reviewed, which shrinks the stack from underneath
and de-risks the rest.

## Making lane 6 reviewable

6 297 lines is too many to read, but almost none of it is new logic — `@agenta/chat` was
**copy-extracted** from `web/oss/src/components/AgentChatSlice`. The PR body should carry a
per-file drift table (package copy vs its OSS original) so the reviewer reads only the
drifted lines. Generate it mechanically with `git diff --no-index` per file pair.

Known drift to classify before opening it: ~57 lines in `transcriptToMessages.ts`, and the
`sessionMessages.ts` divergences already fixed in Wave 0.

Note for the PR body: `grep "@agenta/chat" web/oss/src` returns **0 hits** — OSS has not
adopted the package it was extracted from. That re-plumb is deliberately out of scope here
(it collides with the open frontend queue and the antd→shadcn branch) and is tracked as
Wave 2 of `docs/design/agenta-sessions-consolidation/plan.md`.

## Mechanic: chronological path-partitioned replay

Not `but absorb`, and not hand-assignment against a live working tree — the root
`AGENTS.md` documents how both mis-route on a pile this size.

For each lane, in stack order:

1. Branch from the previous lane's tip.
2. Walk the original 123 commits **in chronological order**. For each commit that touches
   this lane's paths, `git checkout <commit> -- <that commit's files in this lane>` and
   commit it with the original message (subject unchanged, so the narrative survives).
3. A commit spanning two lanes contributes one commit to each — no hunk surgery.

Because the replay is chronological and lanes stack in the same order, the 3 shared files
accumulate their hunks in the right sequence automatically.

### The golden check

After the top lane is built:

```sh
git diff <top-lane> feat/agenta-mobile-wave-1   # MUST be empty
```

An empty diff proves the split preserved the exact final tree — no hunk lost, none
duplicated. Per-lane, verify the **tree** (`git show <lane>:<file>`), not the diff.

Then per lane, bottom-up, confirm the base diff is exactly that lane's files:

```sh
git diff --name-only <lane-below>..<lane>
```

## Risks

- **Intermediate lanes must build.** Every original commit compiled, and the replay
  preserves their order, so any cut point between them is safe. Cut points must fall
  *between* original commits, never inside one.
- **Lane 12's mobile app needs lanes 6, 7, 9, 10 beneath it** to typecheck. That ordering is
  already the stack order.
- **GitButler stacks are linear** (root `AGENTS.md`). The dependency graph here fans out —
  e.g. lane 8 (desktop) and lane 12 (mobile) both depend on lane 3 but not on each other —
  and that cannot be drawn in the git graph. It does not need to be: put every lane in one
  linear stack and set each PR's `--base` to the branch below it. GitHub then shows only
  each lane's own delta.
- **Take a `but oplog snapshot` first.** Recovery is `but oplog restore`.

## Sequencing suggestion

Open lanes 1–5 first and let them merge on their own cadence; they are self-contained
backend work with no mobile coupling. Open 6–12 once the shape of 1–5 is settled, so the
frontend lanes rebase onto a shrinking stack rather than a growing one.
