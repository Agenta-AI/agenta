# Handoff brief: lane s7e (credential epoch, credential delivery, Daytona identity split)

Written by the runner-spike agent that completed lanes s5 through s7d, at the end of a long
session, for a successor taking the credential work fresh. The coordinator offered the handoff
rather than push the most security-sensitive remaining work through a degraded agent. That was
the right call and this brief exists to make the swap cheap.

## What is already true

Read these first. They are the contract, not background:

- `contracts/adapter-matrix.md` — the reconciliation contract. Section 1.4 (exempt classes),
  section 2.4 (the canonical generation payload and what is EXCLUDED from it), section 4.3
  (untrusted acknowledgement), section 6.2 + 6.2.1 (reopen and the replayability condition).
- `contracts/execution-authorization.md` §2.3.3 — `strictCanonicalJson`, the exact serializer.
- `research/runner-lifecycle-codex.md` steps 8 and 9 — the work this lane implements.
- `src/lifecycle/reconciliation-router.ts` — the KNOWN DISAGREEMENTS block near the bottom is the
  single most relevant paragraph in the codebase for this lane. Read it before anything else.

Landed lanes: s5 (applied state, teardown reasons), s6 (coordinator extraction, shadow routing),
s7a/s7b (environment split into five units), s7c (two live routes authoritative), s7d (reopen +
the inventory refutation).

## The three pieces, and why they are not one piece

The lane is described as "item 2 + item 3" but it is really three jobs:

### 2a. Feed the credential epoch into the desired/applied comparison

CONTAINED. The router currently cannot see a credential rotation at all, because credential
VALUES are deliberately excluded from every facet digest — digests are logged, and a digest over
a small field space is guessable. Rotation is tracked separately by `CredentialEpoch`
(`session-identity.ts`), a timing-safe comparison the router never consults.

Consequence today: `mismatch:credentials-rotated` is the LAST counted disagreement in the shadow
counters, and there is a test in `lifecycle-live-routes.test.ts` named "KNOWN GAP, still counted"
that asserts it stays visible. That test is deliberate. When you close the gap, that test must be
rewritten, not deleted — it is the record.

The shape question: the epoch is not a digest and must not become one. It belongs in the plan as
its own input producing a `restart-runtime` action, not as a ninth facet whose digest gets logged.

### 2b. Credential refresh DELIVERY

THIS IS THE HARD ONE, AND IT DOES NOT EXIST TODAY. Mahmoud's Q5 requirement is that a rotated
Daytona model key restarts at most the daemon, never the sandbox. Today Daytona secrets are a
CREATE-TIME concept: `provider.ts` hashes the full create request plus the secret plan into a
create fingerprint, and `daytona-secret-provider.ts` DESTROYS the sandbox when it differs.

So this needs a new provider-port operation for injecting credentials into an already-created
sandbox. The coordinator asked for the PORT SHAPE first, sent for review before any code moves,
because it carries live secrets. Do that. The `AcquireContext` precedent (lane s7b) is the model:
publish the type alone, get it reviewed, then move code. That review caught five real defects.

Things I would put in that design and would want a reviewer to check:

- Where the secret is in memory, for how long, and what clears it. `AcquireContext` deliberately
  has no raw-secret accessor; do not add one.
- Whether delivery is push (runner writes into the sandbox) or pull (daemon fetches with a
  short-lived grant). Push means the secret crosses the daemon API; pull means a grant that is
  itself a credential.
- What happens to the OLD credential. A refresh that installs the new one without invalidating
  the old leaves both live, which is worse than a rebuild.
- Failure semantics. A half-delivered credential must fail closed to a rebuild, never leave the
  daemon with a partially updated environment. The `applyReconcilePlan` contract already says
  applied state advances only on full success; keep that.
- Logging. No secret, no digest of a secret, no length. The shadow logger's rule (facet names and
  action kinds only) applies here too.

### 3. The Daytona creation-identity split

Depends on 2b, because it is what lets a mutable credential change reconcile instead of rebuild.
`research/runner-lifecycle-codex.md` step 9 has the target shape: a `SandboxGenerationId` covering
provider/image/target/immutable topology that rebuilds, versus mutable state that reconciles on
reconnect and FAILS CLOSED when reconciliation fails.

## Traps I hit, so you do not

1. **Facet granularity is a safety property.** In s7c I nearly shipped two silent security
   downgrades because one facet mixed harness files with instructions and another mixed
   permissions with the model. `adapter-matrix.md` §4.3.2 rule 3 and §1.4 forbid both by name.
   When in doubt, split: an over-fine facet costs a rebuild, an over-coarse one downgrades a
   security-relevant change silently. There is a counting scope-guard test that stops a new live
   route appearing by accident — keep it honest rather than widening it.

2. **The shadow must describe the plan it ACTED ON.** I logged after the apply committed, so the
   counter recorded `no-op` and could never name the route. `ShadowLogInput.plan` exists for this.

3. **Do not invent a verification that verifies nothing.** The reopen work nearly grew a native-
   history check against an ACP surface that exposes no such primitive. The replayability
   condition (§6.2.1) is the honest substitute. The same instinct applies to credential delivery:
   if you cannot confirm the daemon actually took the new secret, say so and rebuild.

4. **`environment.ts` is a composer now.** The five units live in `src/environment/`. New
   lifecycle behavior goes in a unit, not back into the composer. Seam tests in
   `environment-units.test.ts` assert the composer delegates and does not inline.

5. **Applied state advances ONLY on success.** This is the invariant s5 made structurally
   impossible to violate for request-derived fingerprints. `apply-plan.ts` keeps `commitApplied`
   as the last statement, unreachable from any failure path. Credentials must not reintroduce it.

## The test that tells you when 2a is done

`lifecycle-live-routes.test.ts` → "KNOWN GAP, still counted: a rotated credential remains a
disagreement". When the epoch reaches the router, that test flips: a rotation should produce an
AGREEMENT on `restart-runtime`, and the total disagreement count across the suite should be zero.
That is the completion signal for the whole shadow-routing arc.

## State of the tree at handoff

108 test files / 1729 tests green, `tsc --noEmit` clean, on top of the landed s7d lane. Nothing in
progress, nothing half-migrated. The only uncommitted change is the `adapter-matrix.md` §6.2.1 doc
edit recording the replayability rule.
