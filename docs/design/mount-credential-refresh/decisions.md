# Decisions: what was chosen, why, and how to back each choice out

Every decision this design embeds, with its trade-off and the cheapest reversal.
Ordered from the ones that shape the design down to mechanical details. "Backtrack"
states what changing the decision costs later.

## 1. credential_process in push form, not the container-credentials endpoint

The predecessor deferred in-place refresh and named the container-credentials
endpoint (mechanism 4 in its table) as the intended follow-up. Reading the pinned
SDK fork revised that: `AWS_CONTAINER_CREDENTIALS_FULL_URI` accepts ONLY loopback
hosts in geesefs v0.43.0, with no HTTPS exception (research.md section 2), so the
endpoint would have to be served from INSIDE each sandbox, which needs an
in-sandbox daemon that itself needs a credential source. credential_process with
`cat <lease file>` needs no daemon, no port, and no logic inside the sandbox; the
refresh trigger (the SDK re-running the process at the reported expiration) is
identical in kind.

- Trade-off: the refresh moment is controlled by the `Expiration` written into the
  file rather than by the endpoint provider's built-in 5-minute early window; the
  design re-creates that window explicitly (decision 3).
- Backtrack: for the LOCAL sandbox only, a loopback endpoint served by the runner
  would also work; switch by swapping the config file for the env var. There is no
  remote backtrack onto the endpoint within this geesefs pin.

## 2. The runner pushes leases; nothing inside the sandbox ever fetches them

The sign endpoints are called only by the runner, with the per-run credential it
already holds, and the result travels into the sandbox as file content over the
provider's authenticated channel. The sandbox's credential inventory is unchanged
from today: one prefix-scoped short-lived lease (research.md section 4). This is
the resolution of the security concern that caused the original deferral, not a
relaxation of it.

- Trade-off: refresh requires the runner to be alive and holding a valid run
  credential, which confines refresh to turn time (decision 4).
- Backtrack: none sensible; any pull design moves credential-fetching authority
  into the sandbox, which the trust boundary forbids.

## 3. The lease file reports an early expiration (real minus a margin)

The vendored processcreds has a zero expiry window, so the SDK rotates exactly at
the reported expiration. Reporting `real - margin` (120 s at the default TTL, with
a 30 s floor for tiny QA TTLs) makes the SDK rotate while the old lease is still
valid. The margin is a bound, not a proof: it holds while request-admission delay
plus total clock skew stays under it, which is the stated assumption
(research.md section 5); the margin is also the ONLY skew absorber on the refresh
path, since `MOUNT_LEASE_SKEW_MS` feeds only the (gated) coordinator horizon
check.

- Trade-off: each lease's usable life shortens by the margin; at TTL 3600 that is
  3.3 percent.
- Backtrack: one constant in `mount-lease.ts`.

## 4. The refresher runs only while a turn is in flight, armed with a live accessor, plus a preflight at arm

Turn time is when a lease can die under I/O, and it is also when the runner holds a
valid signing credential. That credential is held as a live ACCESSOR
(`() => string`), never a snapshot: the run secret's own TTL is ~15 minutes and the
alive watchdog re-mints it (`alive.ts:196`), so a snapshot would go stale before
the first refresh at any sane TTL. Parked windows are bounded far below any TTL
(idle 60 s / 120 s, approval 10 min), and a Daytona parked-to-stopped sandbox has
no running daemons and remounts fresh on reattach (research.md section 6). The
awaited PREFLIGHT refresh at arm time closes the gap where a turn checks out near
a boundary, and its failure is load-bearing: when the remaining lease cannot cover
the horizon, a failed preflight fails the acquisition over to a cold rebuild
instead of starting the turn on a bet. This is what makes gating the coordinator's
horizon check (decision 5) honest.

- Trade-off: a pathological configuration (approval TTL raised above the lease
  TTL) could still park a lease to death. The unchanged `credentials-expired`
  eviction catches exactly that, at the cost of a rebuild.
- Backtrack: a standing runner-held service credential would allow refresh while
  parked; that is a new credential surface and needs its own review. Nothing in
  this design blocks adding it.

## 5. The evict-before-expiry machinery stays, demoted to a backstop — with its limit stated

`installedMountExpiries`, the parked epoch, `credentials-expired`, the mount-lost
probe, and the ENOTCONN remounts all remain. Every successful refresh advances the
installed lease, so in healthy operation the expiry checks simply never trip; when
refresh fails, the bookkeeping stops advancing and today's dispatch-time behavior
returns without any mode switch. Two checks are gated rather than removed:
`credentials-expiring` (the worst-case-turn horizon) and the `lease-short` warning
are skipped for refresh-managed environments, because both encode the assumption
that a turn runs on the credentials it starts with, and a refresh-managed turn
does not.

Stated honestly, because the first draft overclaimed here: the coordinator backstop
protects the POOL (no environment is reused or parked on a dead lease), not the
ACTIVE turn; it can only evict at the next dispatch. What protects the active turn
is decision 4's preflight (no turn starts inside the horizon without a proven
renewal) plus retry-and-self-heal during the turn. Once the TTL drops below the
turn budget, a signer outage that outlasts the remaining real lease breaks the
active turn's mount until recovery; no backstop can prevent that, only the TTL
choice can (plan.md open question 3).

- Trade-off: dual-path complexity in the coordinator until slice 3 cleans up.
- Backtrack: the gate is one boolean per branch; deleting the boolean (and the
  preflight failover) restores the predecessor's behavior exactly.

## 6. Local sandbox first, Daytona second

Slice 1 is local-only: it exercises the whole mechanism (config file, lease file,
refresher, coordinator gating) with a same-filesystem write path and no provider
API in the loop, and it is independently shippable because Daytona stays protected
by the patch-release numbers. Slice 2 adds only the remote write path and the
extra mounts.

- Trade-off: Daytona keeps paying credential-driven sandbox deletes until slice 2.
- Backtrack: none; this is ordering, not architecture.

## 7. Refresh ships default-on with a kill switch

`AGENTA_RUNNER_MOUNT_REFRESH=off` restores the static-env spawn path byte for
byte. Default-on is proposed (open question 2) because a default-off mechanism is
an untested claim: the gate would exercise the old path while the new one rots.
The kill switch is per-acquisition, so flipping it never leaves one environment
half-managed.

- Trade-off: the first release with slice 1 changes every local mount's spawn
  shape at once.
- Backtrack: set the env var; one deploy, no code.

## 8. Timing is specified as invariants; the derived constants are defaults, not knobs

The load-bearing spec is three invariants (plan.md): the reported expiration
precedes the real one by more than worst-case admission delay plus skew; a fresh
file lands before the SDK looks, with room for retries; and below a minimum TTL
refresh refuses to arm. The `clamp(ttl/k, floor, cap)` formulas are one concrete
satisfaction of those invariants, chosen so QA TTLs scale automatically and
operators get zero new numbers to mis-set (repeating the predecessor's reasoning
for the skew constant). Codex's review called the bare fractions "magic"; the
review was right that the invariants needed stating and floors, jitter, and
timeouts were missing (all added), and we kept the no-knobs position it did not
contest.

- Trade-off: unusual deployments cannot tune the rotation window without a code
  change.
- Backtrack: promote any constant to an env knob later; each is one line in
  `mount-lease.ts`.

## 9. The dispatch's up-front sign is not reused as a refresh vehicle

Every dispatch already signs fresh cwd credentials for the pool key; pushing that
sign into live environments on warm hits was considered and rejected: it covers
only one of the mounts, only at boundaries, and adds lease-writing to the dispatch
hot path. The refresher owns all renewals through one code path (research.md
section 6). The known waste of the dispatch sign stays out of scope, as the
predecessor already recorded.

- Backtrack: none needed; a future lazy-sign restructure of the dispatch is
  orthogonal.

## 10. Harness transcript mounts join the lease epoch (REVERSED from the first draft)

The first draft kept them out of `installedMountExpiries`, extending the
predecessor's argument (signed seconds apart at the same TTL, so never the
minimum). Codex's review broke that argument for the refresh world: the exclusion
was only sound while all mounts aged in lockstep, and independent per-mount
refresh failures end the lockstep — cwd can advance while a transcript mount
quietly dies, and the pool would park a false healthy epoch. So slice 2 replaces
the fixed `{cwd, agent}` shape (`session-identity.ts:633`) with a map over every
installed daemon, gives `mountHarnessSessionDirs` a real result contract instead
of `Promise<void>` (`mount.ts:727`), and the epoch stays the minimum over all of
them. This also closes what was open question 3.

- Trade-off: a failing transcript mount now costs a backstop eviction where before
  it silently degraded; that is the point.
- Backtrack: drop the extra map entries; `installedMountLease` reduces over
  whatever exists.

## 11. geesefs stays pinned at v0.43.0

The chosen mechanism exists and was verified in the pinned source. A geesefs
upgrade (newer releases rebase the vendored SDK) is a separate change with its own
regression surface and buys nothing this design needs.

- Backtrack: if an upgrade ever lands, re-verify three facts against the new
  vendored SDK: profile-beats-env resolution order, processcreds re-run semantics,
  and the FULL_URI loopback rule. They are the load-bearing assumptions
  (research.md section 2).

## 12. Retuning the deadline and TTL defaults is deferred to slice 3, with Mahmoud

The patch-release numbers (11 h deadline, 12 h TTL) stay in place through slices 1
and 2 so the mitigation and the fix overlap rather than hand off. Refresh makes
the coupling unnecessary, not the numbers wrong; the deadline is a product
decision about maximum run length, and the TTL is a security decision about leak
windows. Recommendation recorded in plan.md open question 1: deadline stays, TTL
back to 3600 s.

- Backtrack: env knobs on both sides; no code.

## 13. Slice 0: the mechanism is proven against the pinned binary before any manager code

The source citations support the narrow conclusion (profile selects
credential_process, `Expiration` makes it refreshing, re-run at reported expiry)
but not the operational claims (no negative caching, late self-heal, per-part
multipart signing, profile precedence under the real env-merging spawn). One
scripted probe against the v0.43.0 binary and SeaweedFS at TTL 120 settles all of
them in a day (plan.md slice 0). If any leg fails, the mechanism table gets
re-litigated before slice 1.

- Trade-off: one day of spike work before feature code.
- Backtrack: none; the probe script is reused as the low-TTL gate variant.

## 14. Lease files are hardened, per-acquisition, and cleaned up

Acquisition-unique roots (a deterministic session path collides across
acquisitions sharing an artifact mount), 0700 directories, 0600 files, exclusive
randomly-named temps with `O_NOFOLLOW`, same-directory rename, `/usr/bin/cat --`
with a quoted absolute path, and deletion at unmount/destroy. Same-user sandbox
tampering is treated as an expected attack, not a curiosity, and still-valid
leases must not accumulate under `/tmp`.

- Trade-off: slightly more file plumbing than "write a JSON file".
- Backtrack: none sensible; each measure is a line or two.

## 15. The renewable-stream property is accepted, eyes open

Refresh gives a live malicious sandbox a renewable stream of prefix-scoped leases
for the duration of the turn: exfiltrating each replacement extends external
access to turn-end plus one TTL (research.md section 4). Accepted because the
stream is turn-bounded, adds no scope, every leaked token stays TTL-bounded, and
the alternative delivering the same run length (a TTL above the maximum turn,
today 12 h) leaks strictly more per token. Countermeasures that would matter
(revocation on turn end, per-refresh RoleSessionName for audit) stay on the
signing-hygiene backlog, out of scope here.

## 16. E2B is out of scope, explicitly

The provider registry rejects `e2b` as planned-but-unsupported
(`provider.ts:230`), so no code path inherits the mechanism today. The first
draft's open question offered "untested inheritance"; that was wrong on the
facts. When an E2B provider lands, it must register its mounts with the
refresher like Daytona's or state why not.

## Codex review, 2026-08-20: what it changed and where we pushed back

An xhigh-effort Codex review of this workspace requested changes; the mechanism
choice survived, the lifecycle around it did not. Accepted and folded in: the
preflight-or-rebuild redesign of the backstop claim (decisions 4, 5 — the first
draft's "degrades exactly to today's behavior" was false for the active turn);
the live credential accessor (decision 4); transcript mounts into the epoch
(decision 10, reversed); refresher cancellation/draining/generation semantics,
timeouts, backoff floors, redactor seeding, and observability (plan.md); lease
file hardening and cleanup (decision 14); the slice-0 spike (decision 13); the
honest goal statement and skew accounting (context.md, research.md sections 5
and 7); E2B scoped out on the facts (decision 16); keeping the horizon check out
of the slice-3 deletion list.

Pushed back or nuanced, recorded rather than silently dropped:

- **Derived timing fractions**: Codex called `ttl/6`-style fractions magic and
  wanted invariants. Invariants are now stated and floors/jitter added, but the
  derived-defaults-no-knobs decision stands (decision 8); Codex did not argue for
  knobs, so this is a framing fix, not a reversal.
- **"Local daemons die with the runner"**: Codex noted the detached, unref'd
  spawn (`mount.ts:335`) does not by itself prove this. Our claim rests on the
  container pid-namespace dying with the runner process (node is the container's
  main process), which holds for container restarts; a process-only restart
  inside a still-living container is not a deployment mode we run. Kept, with
  the assumption now written down here.
- **Renewable capability stream**: accepted as a real sharpening, but weighed and
  accepted rather than treated as a blocker (decision 15); the reviewer's own
  framing agreed each token stays TTL-bounded.
