# Context: why in-place mount credential refresh, and why now

## What happens today

A geesefs mount reads its store credentials exactly once, at daemon start, from
static environment variables. Nothing can renew them while the daemon runs. Two
consequences follow:

1. **A turn that outlives its lease loses its files mid-run.** Once the lease
   expires, the store answers 403, geesefs maps it to EACCES, and every file
   operation in the working directory and the durable agent folder fails with
   "Permission denied" until the environment is rebuilt.
2. **Warm sessions are rebuilt for credential reasons alone.** The session pool
   tracks the installed lease and evicts a parked environment to a cold rebuild
   before a worst-case turn could cross expiry. On the local sandbox a rebuild costs
   seconds. On Daytona a credential eviction maps to `runtime-incompatible`, which
   deletes the remote sandbox; the next turn pays a full create.

The v0.112.3 release surfaced the first consequence in the field: a long run hit its
lease boundary mid-turn. The patch-release mitigation (shipped separately) balances
the numbers, run deadline 11 hours against lease TTL 12 hours, so that no turn can
start on a lease it could outlive. That mitigation works, but it couples two knobs
that have no business being coupled, forces a 12-hour credential lifetime (every
extra hour of lease lifetime is an hour a leaked prefix-scoped credential stays
usable), and still pays a cold rebuild whenever an active conversation crosses a
lease boundary.

## What this project changes

Teach the mount to pick up fresh credentials while running. The runner re-signs each
mount's lease before it expires and places the fresh lease where the running daemon's
SDK re-reads it. Then:

- A run of any length keeps live files: the lease under a running turn is renewed,
  not outlived.
- Warm sessions never rebuild for credential reasons: the installed lease advances
  instead of running out.
- The run deadline and the lease TTL decouple: the deadline becomes a product
  decision, the TTL a security decision, and neither constrains the other.
- The TTL can come back down (shorter leases, smaller leak window), because renewal
  is continuous and free.

## The security constraint that shapes everything

The sandbox runs untrusted agent code. Nothing inside the sandbox may hold API
authentication or long-lived keys. This is why the predecessor project deferred
in-place refresh: the obvious designs put a credential-fetching helper, and therefore
API auth, inside the sandbox. The design here inverts the flow: the runner, which
already holds per-run API auth outside the sandbox, signs fresh leases and pushes
them in. The sandbox only ever contains what it already contains today, a
prefix-scoped short-lived lease. See research.md section 4 for the full argument.

## Goals

- A turn keeps live files for its whole length, on the local sandbox and on
  Daytona, against SeaweedFS and against real AWS. Stated precisely: a turn never
  starts on a lease it cannot cover without a successful refresh first, and an
  active turn never sees EACCES unless signing stays broken past the remaining
  real lease lifetime (and then self-heals on the first successful retry). The
  unconditional "any length, never EACCES" holds only while the TTL exceeds the
  turn budget; below that, the signer is a runtime dependency
  (research.md section 7).
- No credential-driven evictions: `credentials-expiring` and `credentials-expired`
  stop occurring in a healthy deployment, and the Daytona delete-and-recreate they
  cause disappears with them.
- The sandbox trust boundary is unchanged: no API auth and no long-lived keys inside
  the sandbox, ever.
- The existing machinery stays as a backstop: if refresh fails, behavior degrades to
  exactly today's evict-before-expiry, never to silent EACCES.
- First slice shippable alone.

## Non-goals

- Upgrading geesefs. The pinned v0.43.0 already supports the chosen mechanism
  (research.md section 2); an upgrade is a separate risk with no payoff here.
- Retuning the run deadline and TTL defaults inside the first two slices. Slice 3
  proposes the retune; Mahmoud decides the numbers (they trade run length against
  leak window).
- Mid-turn EACCES detection in the agent event stream. Still false-positive-prone,
  and unnecessary once leases never expire under a turn (the predecessor's analysis
  stands).
- Per-mount RoleSessionName and other signing hygiene. Orthogonal, still deferred.
- The E2B provider beyond what the shared remote-mount code path gives for free.
