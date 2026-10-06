# Implicit decisions and requirements register

What Mahmoud asked for: new users send their first playground messages on our
key; cap after some number of requests; a cheap model; $3,000 covering ~10,000
signups; reuse the entitlements architecture; credits as abstract units, simple
first, extensible later; competitor names out of the repo; take the Daytona
secrets PR (#5277) into account; prefer a lightweight gateway if one is needed.

Everything else in this folder entered the design some other way. This file
lists each such decision, its origin, and what striking it would cost, so the
reviewer can cut scope deliberately. Origin codes:

- **[inference]** I introduced it from research or product judgment.
- **[review]** the external review loop (five adversarial passes) forced it.
- **[codebase]** the existing code leaves no real choice.

## Load-bearing (striking these changes safety or correctness)

1. **The platform key never enters the sandbox; a gateway fronts funded calls.**
   [review, then verified] The sandbox is user-controlled and today's delivery
   puts resolved keys in its environment; a platform key there is stealable and
   its theft bypasses every cap. Striking this means accepting that any user
   can extract our key. The Daytona-secrets path alone hides the key but does
   not bound its use (research.md §7), so it cannot substitute.
2. **A new lifetime counter instead of reusing `credits_consumed`.** [codebase]
   The existing counter is monthly; reusing it refills every trial monthly.
   No design freedom here beyond the counter's name.
3. **Eligibility via a grant record, not a plan-catalog quota.** [review]
   A plan-level lifetime quota grants the full allowance to every existing org
   on the plan at ship time; there is no per-org override mechanism. Striking
   the grant record means either gifting all existing orgs or building some
   other new-orgs-only mechanism, which is the same thing under another name.
4. **Atomic spend: counter and authorization commit together.** [review]
   Without it, a crash window can charge twice, spend uncounted, or refund
   twice. The blast radius of striking it is small in dollars (a trial run
   costs fractions of a cent) but it corrupts the balance users see; I would
   keep it because the cost is one transaction boundary, not a system.
5. **Funding decided server-side, never from client-sent metadata.** [review]
   Anything the client sends is forgeable, and evaluations converge onto the
   same invoke path. Striking this means a crafted request can fund
   non-playground workloads.

## Defensible but negotiable (engineering conservatism; strippable with eyes open)

6. **The signed invocation-purpose claim.** [review] The hardened form of #5.
   A simpler form exists: an ordinary server-side check at the invoke route
   that creates the reservation there, with a plain idempotency key. The claim
   adds unforgeability across service hops; the MVP has few hops. Strippable
   to the simple form for MVP.
7. **Per-call replay protection (call identity + canonical request hash).**
   [review] Guards against a duplicated provider call inside one token's
   budget. The per-run budget already bounds the damage to the run's own
   budget. Strippable; keep the per-run budget.
8. **Holds retained on ambiguous timeout + late settlement + reconciler.**
   [review] Prevents a duplicate retry being funded twice mid-run. Worst case
   if stripped: a run occasionally gets one extra funded call. Strippable to
   "expire holds after N minutes" for MVP.
9. **Reservation lifecycle with refunds.** [review] The refund path (run died
   before first model call) protects users from losing a run to our own
   crashes. Strippable to "no refunds, runs are cheap" at the cost of
   occasional support tickets and a worse-feeling countdown.
10. **Explicit API-dialect field on the platform connection.** [review +
    codebase] Needed because the runner's custom-provider path speaks only
    chat-completions today and the gateway should speak the agent-native API.
    Strippable only by pinning the gateway to chat-completions and validating
    tool calling works there for the chosen model; that validation replaces
    the field.
11. **Fail-closed reservation checks.** [inference] House pattern is
    fail-open; I flipped it for money. Striking it means an infrastructure
    blip silently funds unmetered runs; keeping it means a blip blocks trial
    runs (users with keys unaffected). I would keep it; it is one branch.
12. **Kill switch as a backend flag rather than deleting the env key.**
    [review] Deleting the key mid-flight strands users who still see balance.
    Strippable if we accept ugly mid-run failures during an emergency stop.

## Product choices I made without being asked (review these as product, not engineering)

13. **Thirty runs, one-time, never recurring.** [inference] Thirty ≈ 3x the
    measured 10-turn session; one-time because our credits end at BYOK,
    unlike competitors who sell credits forever. The grant record makes the
    amount a per-cohort parameter, so this is a starting value, not a design
    commitment.
14. **Unit = one message/run, shown as "free messages", not tokens or money.**
    [inference] Matches "credits as abstract units" and the competitor
    legibility findings. Token-denominated units are meaningless to new users.
15. **Org-scoped, signup-only grants.** [inference + review] Follows the grain
    of subscriptions; signup-only closes org-farming. Consequence: invited
    teammates can meet an exhausted balance.
16. **gpt-5.4-nano as primary candidate, decided by a tool-using quality
    test.** [inference; review added the tool-test condition] Price and brand
    argue for it; vendor positioning argues for testing before committing.
17. **Countdown appears after the first response; picker stays open with
    connect-affordances on non-trial models; exhausted state preserves the
    draft and auto-sends on key connect.** [inference] UX judgment calls,
    reviewable from the design.md frontend section.
18. **Build the gateway (600-900 lines) rather than adopt LiteLLM/other.**
    [inference, answering Mahmoud's direct question] Grounded in the survey:
    nothing implements reservation hold-and-settle, so adoption still means
    writing the hard part. research.md §8 has the evidence.
19. **Daily per-org throttle on trial runs; per-call token caps.** [inference]
    Abuse hygiene sized from the pricing research.
20. **Rollout by cohort with kill criteria (3x spend envelope, key-connection
    collapse).** [inference] The specific thresholds are guesses to be tuned.

## What the review loop cost

For honesty: passes 1-2 corrected real errors (wrong enforcement path; key
leak into the sandbox) and those corrections are the load-bearing section
above. Passes 3-5 mostly added items 6-12: correct engineering, but each is a
requirement Mahmoud never asked for, and together they roughly doubled the
specified surface. rfc.md's "smallest safe version" shows the design with
items 6-9 and 12 stripped; the delta between that and the full design is the
price of the review loop's conservatism, and it is the reviewer's call whether
to pay it now, later, or never.
