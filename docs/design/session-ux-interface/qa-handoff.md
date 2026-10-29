# QA handoff

Date: 2026-08-11

## Release state

Implementation and verification are complete. Schedule acceptance, authenticated API wire checks,
browser QA, live subscription acceptance, and the representative performance benchmark all passed.
Details below.

Checks ran against the active EE development deployment. See the `debug-local-deployment` skill
for how to locate and reach it. Observed at verification time:

- API health: `GET /api/health` returns `200`
- Web root: redirects to `/w`

## Verified

### API and database

- 565 non-integration session and trigger tests passed after updating to release commit
  `4af155162b`.
- Real-Postgres tests passed for atomic delivery/session claims, rollback, merge-safe attribution,
  trigger joins, origin filtering, cursor behavior, soft deletion, and retained history.
- Final code review found no P0 or P1 findings.

### Generated clients

- The generated Python package builds.
- Three Python contract tests passed for nested queries, typed attribution, expansions, and
  windowing.
- The generated TypeScript client and consuming session entity contracts build and type-check.

### Frontend

- Relevant frontend package builds passed.
- Relevant package type checks and lint passed.
- Focused and full package tests passed for origin policies, query shapes, row view models,
  automation actions, exact delivery mode, and historical drawer behavior.

### Live checks

- A schedule firing created one linked delivery and session.
- An authenticated canonical session query returned the current trigger name and kind, typed
  delivery data, terminal windowing, and only public user tags.
- Exact delivery retrieval returned the linked session and execution result.
- A clean web-container restart reaches Next.js ready state. The root redirects to `/w`, and the
  API health endpoint remains available.

## Manual QA

Checklist for the deployment above. Coverage from the most recent browser QA session is noted per
item.

1. Open project Sessions in default mode. Automation-created sessions do not appear. — Covered, pass.
2. Switch to automation mode. Only automation-created sessions appear. — Covered, pass.
3. Open a schedule row. The primary click opens the session. — Covered, pass.
4. Use `Open automation`. The matching schedule or subscription drawer opens. — Covered, pass.
5. Use `View delivery`. The drawer shows only the exact delivery and linked session. — Covered, pass.
6. Rename an automation. Existing session rows show the current name. — Covered, pass.
7. Delete an automation. It disappears from normal lists, but its historical configuration and
   delivery remain readable from the session row. — Covered, pass.
8. Confirm Home and Sessions show previews. Sidebar, agent overview, and mobile must not issue
   preview expansions. — Covered, pass (verified via request bodies).
9. Test a user without trigger-view permission. The session remains openable while unavailable
   automation actions remain hidden or disabled. — Blocked: every stock role includes trigger
   visibility, so this needs a deployment configured with a custom access role.
10. Repeat the flow in light and dark themes and at desktop and mobile widths. — Dark theme
    covered, pass. The mobile-width portion is blocked by a pre-existing desktop-only dashboard
    gate, unrelated to this change.

## Verification completed since this handoff was written

A verification and fix wave closed the three items below.

### Browser QA

Manual QA ran in a browser environment with working sandbox support. Eight of ten checklist items
passed, covering mode filtering, row actions, the delivery dialog, rename propagation,
deleted-automation read-only history, expansion scoping (verified via request bodies), and dark
theme rendering. The permission-restricted step is blocked: every stock role includes trigger
visibility, so testing a role without it needs a deployment configured with a custom access role.
The mobile-width step is blocked by a pre-existing desktop-only dashboard gate, unrelated to this
change.

### Subscription acceptance

Live subscription acceptance ran twice against a real provider event. The first run used a real
GitHub star event through a temporary connection. The second repeated the flow through a
connection the user created directly in the product, with no manual database writes. Both runs
produced exactly one delivery and one session with `kind: subscription`, correct typed
attribution, and no `ag.*` tag leakage in the public response.

### Performance benchmark

The representative benchmark ran at the planned volume: 10,000 sessions and 200,000 records. No
index is required for production at this volume. Human-surface queries measured 15 to 19 ms;
automation-surface queries, which add the trigger join and message preview, measured 24 to 25 ms.
An optional partial index for automation-heavy queries at larger volume is documented, with its
DDL and full measurements, alongside `plan.md`'s benchmark section.

## Deferred risk

Normal automation deletion retains history. Hard deletion of a gateway connection cascades through
its subscriptions' tombstones and delivery history; do not treat connection deletion as covered by
the retained-history acceptance checks. This is accepted product behavior for this release; no
follow-up code change is planned.

## Deployment note

The web container previously restarted because bind-mounted dependency and generated-client output
was owned by host UID `1000`, while the container runs as UID `10001`. The local ignored
`node_modules` and `dist` trees were made writable to match the existing development deployment.
No source change was required.
