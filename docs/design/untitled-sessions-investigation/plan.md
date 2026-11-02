# Fix plan: headless sessions get titles, references, and working links

Scope: fix options 1 to 4 from [findings.md](findings.md). No backfill (option 5 is out
of scope). Option 6 (session id in the URL plus a share-link menu entry) is tracked as a
GitHub issue instead of code here.

## Decisions

**D1. The server fills the session name, once (option 1).**
The only point where the session id and the first user message coexist for every
execution path is the runner. The runner's session heartbeat gains an optional
`name` proposal (first user text, trimmed, sliced to 60 code points, matching the
frontend's `AUTO_TITLE_MAX_CHARS`). The sessions service writes it **only when the
stored `name` IS NULL**, both on row creation and on later beats. Renames and the
browser auto-title always win because they overwrite; the fill never does.
`_start_turn` (the browser send path) applies the same fill from its inputs so even a
browser session gets a durable name if the client effect never runs. The
"heartbeats don't churn headers" invariant holds: a beat can fill a NULL name once,
never change an existing one.

**D2. Resolved references are written back (option 2).**
`_ensure_request_revision` currently embeds the resolved revision into
`request.data.revision` and leaves `request.references` as the caller sent it, which
suppresses SDK hydration and strands turns with a bare variant reference. It now also
writes the resolved `workflow` and `workflow_revision` references (ids plus slugs where
known) back onto `request.references`. `test_run` needs no change of its own; it
inherits the full family.

**D3. References persist on the stream row (option 3).**
Migration adds a nullable `references` JSONB column to `session_streams`. The runner
heartbeat carries the run's references; the service fills the column only when NULL.
The session list prefers stream references and falls back to the latest turn's
references, so a failed turn append no longer produces an unopenable session.

**D4. References carry their family (option 2b).**
Stored reference elements gain an optional discriminator `key` with values
`workflow` | `workflow_variant` | `workflow_revision`. The runner stops discarding the
family keys (`Object.values`) and emits `key` per element. Additive and backward
compatible: old rows keep untyped elements. Naming decision: we first drafted `kind`,
then found the established convention: the evaluation-runs references list flattens the
family onto each element as `key` (api/oss/src/dbs/postgres/evaluations/utils.py:20-43)
and tracing reference attributes carry the family as `key` too. Session turns copied
the eval-runs shape "minus the key", so this completes the existing pattern instead of
introducing a third spelling. The collision with the unrelated `Selector.key` is
accepted. Producers inside the API use a typed Enum (`ReferenceKey`) for the three known
families, but the persisted and read field stays an open string: a turn append is
fire-and-forget, so rejecting an unrecognized family would drop the whole turn, which is
the failure this field exists to prevent. Unknown keys are stored verbatim and returned
as they came; readers treat anything they do not recognize as untyped.

**D5. Browsing surfaces only show rows they can open (option 4).**
`sessionOpenTarget` prefers the element with `key === "workflow"` and falls back to
the current first-UUID heuristic for legacy rows. Filtering is per group
(`sessionGroupRows`): the MAIN list drops rows that are unstarted or resolve no open
target, exactly like the sidebar already does, while PINNED and WAITING keep theirs. Both
of those groups hold rows a person asked for by name, where a missing row reads as a fault
rather than as tidiness, so an inert row is the lesser harm. Automation rows keep their
existing carve-out in every group. We chose filtering over a disabled-row treatment
because the disabled treatment needs new user-facing copy.

## Lanes (stacked, workspace target is release/v0.112.0)

1. `fix/sessions-headless-title-and-references` — `api/**` (+ this design folder):
   D1, D2, D3 service/API side, D4 acceptance, migration, tests.
2. `fix/runner-typed-session-references` — `services/runner/**`: D1 name proposal,
   D3 references in heartbeat, D4 `key` emission, runner tests.
3. `fix/web-session-openability` — `web/**`: D4 consumption, D5 filters, unit tests.

## Test plan

- API: pytest for fill-once semantics (NULL fill, no overwrite, rename wins),
  reference write-back (test_run shape gains the full family), stream-reference
  preference in the list query, migration up.
- Runner: existing TS test suite plus coverage for reference/key emission if the
  harness supports it.
- Web: package unit tests for `sessionOpenTarget` key preference and list filtering.
- Live: headless invoke against the local OSS stack; verify the new session row has a
  name, stream references with kinds, and a clickable row in the UI.
