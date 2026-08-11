# QA handoff

Date: 2026-08-11

## Release state

Implementation and automated verification are complete. Schedule acceptance and authenticated API
wire checks passed. Browser QA, live subscription acceptance, and the representative performance
benchmark remain open for the reasons below.

The active EE development deployment is:

- URL: `http://144.76.237.122:8280`
- Compose project: `agenta-ee-dev-wp-b2-rendering`
- API health: `GET /api/health` returns `200`
- Web root: redirects to `/w`
- Postgres host port: `5434`

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

Run these checks against the deployment above:

1. Open project Sessions in default mode. Automation-created sessions do not appear.
2. Switch to automation mode. Only automation-created sessions appear.
3. Open a schedule row. The primary click opens the session.
4. Use `Open automation`. The matching schedule or subscription drawer opens.
5. Use `View delivery`. The drawer shows only the exact delivery and linked session.
6. Rename an automation. Existing session rows show the current name.
7. Delete an automation. It disappears from normal lists, but its historical configuration and
   delivery remain readable from the session row.
8. Confirm Home and Sessions show previews. Sidebar, agent overview, and mobile must not issue
   preview expansions.
9. Test a user without trigger-view permission. The session remains openable while unavailable
   automation actions remain hidden or disabled.
10. Repeat the flow in light and dark themes and at desktop and mobile widths.

## Open verification

### Browser QA

Automated Chromium QA did not run because the host disables the Chromium sandbox. The test did not
bypass that protection with `--no-sandbox`. Run the manual checklist from a browser environment
with working sandbox support.

### Subscription acceptance

Live subscription acceptance requires `COMPOSIO_TEST_CONNECTED_ACCOUNT`. It was not available in
the test environment. Run one real provider event and verify that it creates a distinct session and
delivery with `kind: subscription`.

### Performance benchmark

The planned 10,000-session and 200,000-record benchmark did not run. No index was added, and no
representative latency claim is made.

Seed the volume described in [`plan.md`](plan.md#phase-10-deferred-performance-benchmark), then
capture `EXPLAIN (ANALYZE, BUFFERS)` for origin filtering, message expansion, and current-trigger
joins. Measure complete Home and Sessions group behavior, not one isolated query.

## Deferred risk

Normal automation deletion retains history. Hard deletion of a gateway connection can still
cascade through subscriptions and deliveries. Do not treat gateway connection deletion as covered
by the retained-history acceptance checks.

## Deployment note

The web container previously restarted because bind-mounted dependency and generated-client output
was owned by host UID `1000`, while the container runs as UID `10001`. The local ignored
`node_modules` and `dist` trees were made writable to match the existing development deployment.
No source change was required.
