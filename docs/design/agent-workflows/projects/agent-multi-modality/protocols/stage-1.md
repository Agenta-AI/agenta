# Stage 1 protocol: the attachment resource, delivery, and transport

This protocol records how the Stage 1 implementation plan was produced and every decision taken
along the way, so the review can judge the decisions, not reconstruct them. It grows as the four
work packages land; each package's implementation notes are appended under its own heading.

## How the plan was produced

1. A first implementation plan was drafted from [../plan.md](../plan.md) Stage 1 and the settled
   design (D1-D14, the limits matrix).
2. A parallel fact-check verified the plan's assumptions in code. Two load-bearing corrections came
   out of it: the pinned AI SDK's file part does carry `providerMetadata` (so the opaque attachment
   id has a clean carrier), and the EE deployments run no nginx at all, so the API cannot rely on
   any gateway body cap.
3. An independent critical review (a second model, maximum reasoning effort, reading the repo) was
   run against the draft. Verdict: do not implement as written. Four release-blocking defects, all
   verified in code, none reopening a product decision.
4. Every review finding was adjudicated: accepted, accepted with modification, or overruled with a
   reason. The revised plan folds the rulings in.

The result is [../plans/stage-1-implementation.md](../plans/stage-1-implementation.md). Its
"Adjudicated decisions" section is the itemized decision log (22 entries), each citing the finding
and the ruling. The headline items:

- **The four defects.** (a) The generic mount routes could still enumerate, download, export, and
  archive the attachments mount, bypassing the session-binding check; one protected-mount policy in
  the service layer now makes those routes treat the mount as nonexistent. (b) The runner has no
  concept of "the current user turn", only "the most recent non-empty user text", in four separate
  code sites; an attachment-only turn could resend an earlier prompt or vanish from records; a
  first-class `currentUserTurn` helper is now the runner package's first commit. (c) The planned
  backward-compatibility read watched a `data` field the front end never sends; today's real shape
  is a data URL in `uri`; the dual read now matches reality. (d) The upload buffered unbounded
  bodies in memory and could orphan an object on a half-failure; it is now a bounded chunked read
  with a pending-to-ready state machine, an idempotency key, and a reaper.
- **Three overturned recommendations.** Marking a file referenced moved from a download side effect
  to an explicit claim call the runner makes when it accepts a turn (a GET must not mutate
  lifecycle, and the browser render path uses the same GET). Model modality facts come from the
  resolved-connection boundary, and an unknown modality means workspace-only with a notice, never
  "assume vision". The PR order flipped to reader-first (API, runner, SDK/agent service, front end,
  then the flag) so no producer ever deploys before its reader.
- **One addition neither plan had.** Per-session quotas (count, bytes, pending), without which a
  hostile session makes cold replay an unbounded resource-amplification endpoint.

## Standing implementation rules for this stage

- Decisions D1-D14 and the limits matrix are settled; implementation forks get decided against
  them, recorded here, and flagged in the PR, never re-litigated.
- Every work-package PR carries the two sections "Implicit decisions and their tradeoffs" and
  "Forced routes to double-check".
- The design-doc sync list in the implementation plan (11 edits) lands on the docs lane during
  WP1, so the design text never drifts from what ships.

## WP1: the API attachment resource

The package was implemented against the plan, then adversarially reviewed, and the review's
findings were adjudicated and fixed before the PR opened. The trail:

### Implementation decisions worth knowing (beyond the plan)

- **Quota enforcement lives in the DAO, under the advisory lock.** The pending-to-ready
  transition takes a per-project-and-session Postgres advisory lock and re-checks the stored
  quota inside that transaction, so concurrent uploads cannot exceed the quota. This is an
  accepted layering deviation (policy normally lives in the service): the enforcement sits where
  the lock lives, and the once-duplicated service-side pre-check was deleted so there is exactly
  one authority.
- **A quota rejection at the ready transition returns 429 and compensates immediately** (the
  object and the pending row are best-effort deleted), so the idempotency key frees right away
  instead of being wedged for the pending time-to-live. The same compensation applies when the
  object write fails. Only a process crash leaves a wedged key, and the reaper clears that.
- **Stale-pending takeover reuses the original attachment id and path.** A retry that takes over
  a stale pending row overwrites the same object key, which is safe because takeover requires the
  same filename, verified media type, size, and content digest (the digest was added during the
  fix pass so equal-shaped but different bytes conflict instead of silently overwriting). Two
  concurrent takeovers serialize on the advisory lock plus the row lock; the loser sees a fresh
  row and gets 409.
- **The media classifier adds container canonicalization on top of puremagic** (Ogg/WebM codec
  markers in the first 1 MB, M4A brand parsing) because puremagic alone reports these too
  generically to apply the audio-versus-other cap distinction, and voice recordings arrive in
  exactly these containers. It is heuristic at the margins and deliberately so.
- **`purpose` is enforced server-side on mount creation** and the public create model does not
  expose it, so the generated client never offers a permanently-rejected field.
- **The sweep tombstones rows before touching objects.** Phase one flips eligible rows to a
  `deleting` state under the row lock and commits; claims and downloads resolve only `ready`
  rows, so a claim arriving mid-sweep fails closed and can never reference a deleted object.
  Phase two deletes objects outside any transaction; phase three removes the rows whose objects
  are gone. A failed object delete leaves a retryable tombstone the next pass picks up, so a
  storage outage delays cleanup instead of orphaning objects. (This improved on the orchestrator's
  own ruling, which would have traded the retry away; the deviation was argued and accepted.)

### The review, and what it changed

An adversarial review (independent model, maximum effort) confirmed the protected-mount policy
is closed over every generic route, the advisory-lock scoping, the takeover serialization, the
sweep lease, header-injection safety, and the absence of storage-coordinate leaks. It found
three release blockers, all fixed:

1. **The "bounded read" bounded Python memory, not the request.** Declaring the multipart file
   as a FastAPI parameter makes the framework spool the entire body to disk before the handler
   runs, and EE deployments have no gateway cap in front of the API. The route now verifies
   `Content-Length` before parsing the form (absent: 411; over the cap plus multipart overhead:
   413), with the chunked read kept as the second line of defense.
2. **The sweep awaited object-store deletes inside a transaction holding row locks**, so a claim
   or upload could block behind a hundred sequential storage round trips. The sweep now runs in
   phases: take the rows in a short transaction, then delete objects outside any transaction.
3. **A failed create wedged its idempotency key for the full pending time-to-live** (the retry
   with the same key, the whole point of the key, got 409 for fifteen minutes). Fixed by the
   immediate compensation described above, plus a `Retry-After` header on the in-flight 409.

Smaller fixes from the same pass: a dedicated `AttachmentConflict` (409) for key-reuse with
different bytes instead of overloading the invalid-file exception; the protected-mount filter
moved into the database query predicate so listing pages are not silently shortened; a filename
length bound (object-store keys have a 1024-byte limit); the sweep's lease derived from its
configured interval and store errors leaving the row for a retry instead of orphaning objects;
a size bound on the claim route's id list; and test reworks so the concurrency invariants are
exercised against real database SQL rather than fakes that reimplement the logic under test.

### Deployment QA (dev stack, 2026-07-31)

The API was rebuilt on the shared dev stack (the new puremagic dependency requires an image
rebuild) and the migration applied cleanly on the real database (`oss000000019` to
`oss000000020`: the `mounts.purpose` column, the `session_attachments` table, both partial
indexes, the idempotency unique constraint, and the cascade to mounts).

QA caught one boot blocker the code review missed: importing starlette's `UploadFile` for the
new create route's `isinstance` check also re-typed the pre-existing mount upload route's
parameter, and FastAPI rejects starlette's class as a route annotation, so the whole sessions
router failed to import and every API request returned 502. The fix keeps starlette's class for
the form-part check and aliases FastAPI's for the route annotation. The lesson is recorded here
because it is the class of failure only a real boot catches: both test suites passed while the
app could not start.

With the fix deployed, everything ran against the live stack: the full curl-level wire matrix
(upload shape with no storage coordinates; idempotent replay returns the same id; same key with
different bytes 409s; download is byte-identical with the verified content type, `nosniff`, and
no side effects; the claim sets `referenced_at` and 404s for a foreign session; a missing
Content-Length gets 411, an 11 MB image 413; the attachments mount is indistinguishable from a
missing mount on every generic route and absent from listings), all nine acceptance tests
(9 passed, zero skips, with storage verification forced on), and both real-database concurrency
tests (the sweep-versus-claim race and the locked quota recheck). The 15 MB audio upload through
the `with-nginx` profile remains to be checked on an OSS gh stack, since the EE dev stack runs
no nginx.

### Forced routes to double-check

- **Content-Length as the request bound.** Clients that send chunked uploads without a
  Content-Length get 411. Every client we ship (browser FormData, the SDK) sends it, but a
  hand-rolled chunked client would need to add it. The alternative, a streaming multipart
  parser, was judged not worth the machinery for a capped-at-15 MB route.
- **The `deleting` tombstone state.** It adds a third state to what was designed as a two-state
  machine (pending, ready). The alternative orderings both had a flaw: objects-first can delete
  a just-claimed attachment's bytes (data loss), and rows-first cannot retry a failed object
  delete (permanent orphans). The tombstone fixes both at the cost of one more state to reason
  about; it never appears on the wire.

## WP2: the runner as consumer

### The stack restructure, and what it means for PR #5598

WP2's current-turn work builds on the approval-resume changes (PR #5598) in the same seams
(`run-plan.ts`, `run-turn.ts`, and their tests): the empty-turn rejection and the prompt
resolution are exactly where the approval-resume fix also lives. The two lanes started as
parallel stacks, and the version-control tool correctly refused to commit dependent hunks into a
parallel line (it silently dropped three files, caught by diffing the tree against the lane tip).
The resolution was to linearize: `fix/approval-resume` moved into this train above WP1, and its
PR base moved accordingly. Consequence, deliberately accepted: PR #5598 now merges as part of
this train, after WP1, instead of independently. PR #5597 (the Pi built-ins fix below it) stays
independently mergeable.

### Implementation decisions worth knowing (beyond the plan)

- One landed commit pair instead of the planned refactor/delivery split: the two parts share
  hunks in seven files, and hunk-splitting across commits is the tool's most failure-prone
  operation (it dropped hunks twice tonight). The refactor was still verified independently
  before any delivery work (155 tests green on its own). The PR diff is identical either way.
- `native_supported` was added as the success reason code (the plan enumerated only degradation
  codes; a success event with no reason would be worse).
- A mixed turn resolves every reference and emits every delivery event before surfacing the
  first failure, so the record log always tells the whole story.
- Restoration is injected into history reconstruction as a callback from the turn runner,
  because the reconstruction module owns neither the sandbox nor the working directory.
- Daytona symlink checks shell out to `test -L` per path component (its filesystem API cannot
  identify links); argv-direct, so no shell injection surface.
- Attachment ids joined the history fingerprint and model capabilities joined the config
  fingerprint. A runner deploy already cold-starts every parked session (the pool is
  process-local), so the hash change adds no second disruption; the consequence is stated in a
  code comment at the fingerprint.

### The review, and what it changed

The adversarial review ran the new code against real request shapes and found two release
blockers plus one bad degradation, all inside the refactor's predicted blast radius:

1. **The rewritten empty-turn rejection discarded human approvals.** The tail-only reading
   rejected any request whose tail was not a text-bearing user message, which includes an
   in-band approval reply carrying the full transcript: a person approves a gated tool, the
   parked session is gone (any redeploy), and the approval dies with "No user message to send".
   Probed with three real shapes, all previously passing. Fixed by restoring the backward-scan
   fallback inside the rejection while keeping the tail-only attachment clause, with the three
   shapes pinned as tests.
2. **One unrestorable historical attachment bricked its conversation forever.** The cold-start
   restore threw on a single failed fetch, every retry is also cold, and the failure is
   deterministic once the sweep has taken an unclaimed file. The chain starts at the deliberately
   non-fatal claim, a tradeoff WP1 recorded in the reverse direction. Fixed: historical restore
   degrades per file (the mention renders as no longer available), and never throws.
3. **Legacy inline images hard-failed turns in five reachable configurations** (capability probe
   unavailable, SVG and HEIC pastes, unknown harness, oversized image) where the runner
   previously degraded silently. A pasted data-URL image is not an explicit native request; it
   now degrades exactly as before when native delivery is not possible, and only a true contract
   violation fails a turn.

Smaller fixes from the same pass: cold restore checks existence before downloading (it
re-fetched every referenced file on every cold start); current-turn fetch and write failures
degrade that one attachment with honest reason codes (`fetch_failed`, `materialize_failed`)
instead of failing the turn under a mislabeled `contract_violation`; an over-cap turn no longer
persists a durable record for a run that is then rejected; the Daytona symlink check runs before
directory creation and is time-bounded; mention lines moved into the latest-user-message position
of the cold frame instead of before the replayed transcript; and the per-image provider cap keys
on the resolved provider rather than the harness name.

### Forced routes to double-check

- **The linearization of PR #5598** (above): the alternative was re-expressing three files
  against a base without the approval changes and accepting textual merge conflicts later; the
  linear train was judged cleaner, and it is reversible by reverting the move before anything
  merges.
- **Legacy images degrade with no delivery event.** A degraded pasted image logs but emits no
  `attachment_delivery` record, because the legacy path has no attachment id to key the event.
  Honest visibility for pasted images arrives with WP4, when the front end switches them to real
  attachments.
