# Cold/warm lifecycle audit — 2026-08-29

A fresh-context audit of the session lifecycle code, commissioned after the harnessKind
wire-spelling bug (#6364) to find more of its class. Method: read
`reconciliation-router.ts`, `desired-state.ts`, `session-coordinator.ts`,
`session-identity.ts`, `session-pool.ts`, `engine.ts`, `run-plan.ts` and their tests;
cross-check every wire literal against `protocol.ts` and the Python SDK; confirm each
behavioral claim with a throwaway probe built on the `lifecycle-live-routes.test.ts`
harness.

## Findings, most severe first

1. **FIXED (#6372). The live route cleared every mismatch reason.** The coordinator's
   else-if chain found only the FIRST reason, and a successful live model apply set
   `mismatch = undefined` wholesale. A model switch riding an edited transcript, a rotated
   credential, an expiring mount lease, or a stale tail continued warm past the skipped
   checks (all four proven warm with the probe). Fixed by re-asking the ordered checks
   after each repair; four pinned tests.

2. **`modelCapabilities` defeats the live model route across modality changes.** It is
   per-turn data (read only by the attachment-delivery chain) but sits in the fingerprint
   and the `harnessSession` facet, and it CHANGES WITH THE MODEL (resolved input
   modalities). Switching between a vision model and a text-only model moves two facets,
   the mixed plan rebuilds, and the one live route works only when the two models agree on
   modalities. Fix: move it to the per-turn-volatile list (the `workflowRevision` /
   `isDraft` precedent), pinned in `lifecycle-desired-state.test.ts`.

3. **`harnessMode` is normalized in the fingerprint but raw in the facet.** The two views
   can disagree (measured: fingerprint equal while `harnessSession` moves), which poisons
   later plans into rebuilding. Reachable today only through a direct runner caller.
   Fix: normalize in one place; add the reverse-direction "no input drift" assertion (a
   change that moves a facet must move the fingerprint).

4. **The agent-mount artifact id is in no fingerprint and no facet (under-eviction).**
   `runContext.workflow.artifact.id` signs the agent mount, sets its env var, and appends
   its guidance — all baked at acquire — yet a changed or newly present id reuses the warm
   sandbox (measured). Fix: add the id alone to the `sandbox` facet + fingerprint, with an
   eviction test.

5. **`toolCallback.endpoint` is fingerprinted but consumed per-turn (over-eviction).** Low
   reachability (stable per-deployment URL); same fix class as 2.

6. **`configFingerprint` matches `codex` on a bare wire literal inline.** Correct today,
   but the exact shape of the #6364 bug (a literal plus a silent fall-through). Fix:
   one exported harness normalizer used by `configFingerprint`, `run-plan.ts`, and
   `reconciliation-router.ts`, with a round-trip test over the SDK enum.

7. **`applyReconcilePlan` treats every `apply-live` action as a model change** (ignores
   `action.facet`). Unreachable today; becomes real the moment the credential plan routes
   through the applier. Fix: switch on the facet, refuse the rest, one test.

8. **`connection` `{mode, slug}` evicts on every harness but only Pi consumes it.** Very
   low reachability; listed for completeness.

Verified clean: the harness wire spellings after #6364 (both normalizers agree, with a
plan-build assertion), and the shadow-router's decision scoping.

## Standing checks born from this

- Gate: L1's model case is blocking on claude AND pi_core (#6371).
- New Relic: alert policy "Runner lifecycle audit" (policy 1731651) pages the operator
  Slack webhook on any `DISAGREE` or `harness=unknown` runner log line.
- Unit: the repair-scoping pinned tests in `lifecycle-live-routes.test.ts` (#6372).

Findings 2-8 are queued work; each names its cheapest check above so the fix and the pin
land together.
