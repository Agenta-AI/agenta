# Open questions

## 1. TOP review question: accept the warm-path deferral?

This is the headline change since the owner's review. He LGTM'd the fuller plan (WP0
through WP5, with the hold-open implementation gated on the timeout measurement). A Codex
xhigh review on 2026-07-11 recommended not building the warm path yet: the plan measured
transport feasibility but not user-visible value, and the cold path is working code with
bounded failure behavior. The deferral was adopted while the owner slept, under his
standing simplify-aggressively instruction, and it is reversible by restoring the prior
plan revision from git history.

- Option A: keep the deferral. v1 = WP0 expanded (timeout plus cold-path baseline) and WP1
  (loopback hardening). WP2 through WP5 unlock only if the two gates in
  [plan.md](plan.md) pass.
- Option B: restore the previous scope and authorize the hold-open build after WP0's
  timeout measurement alone, as the pre-review plan had it.

Recommendation: Option A. If cold drift is rare, a second continuation mechanism is
complexity without users to serve.

## 2. Are the proposed value-gate thresholds right?

The plan proposes: build the warm path only if the first cold reissue mismatches in more
than 5 percent of client-tool turns, or argument drift repeats a browser interaction in
more than 2 percent, or the cold continuation adds user-visible latency or reported cost.
These numbers are proposals to make the gate concrete, not measurements.

Recommendation: confirm or adjust the thresholds when reviewing question 1.

## 3. Should the first warm release add cross-replica routing?

- Option A: route a browser result to the runner that owns the live operation.
- Option B: keep ownership process-local and use cold fallback on the wrong replica.
- Option C (adopted in the revised plan): stricter than B, enable warm mode only in
  owner-routed deployments (single replica, verified affinity, or an owner-routing token).
  Elsewhere warm continuation is unsupported and the runner goes cold immediately.

Recommendation: Option C. A wrong-replica cold start can race a live owner that still holds
the original prompt and parked session; a lower hit rate understates that concurrency risk.

## Settled

- **Loopback authentication is part of this project** and ships now as WP1, independent of
  the warm-path decision. The endpoint dispatches Agenta tools; authentication is a
  prerequisite, not unrelated cleanup.
- **Timeout bar** (old question 1): folded into the transport gate. The held request must
  survive the 60-second idle TTL or the warm path is cut, not deferred.
- **Multiple pending client tools and client-tool batches** (old question 4): deferred with
  the warm path; the batch rejection itself ships in WP1 as protocol hardening.
- **Delivery commit point** (old question 5): defined in the plan. Delivery `accepted` is
  the commit point: before it, the inbound result stays readable for cold fallback; after
  it, no cold continuation may start even if the original prompt later fails.
