# Tasks

All implementation is pending review. Backend and frontend groups can be separate pull requests. Complete the registered-client prerequisite before declaring integration acceptance.

## 1. Backend catalog

- [ ] 1.1 Add typed static MCP catalog entries and official-source metadata for GitHub and Slack. Verify unique keys, canonical HTTPS addresses, stable ordering, documentation links, and no credential values in serialization.
- [ ] 1.2 Add authenticated catalog list/detail reads and case-insensitive search. Verify authorization, empty search, no matches, and unknown-key responses in router tests.
- [ ] 1.3 Add the optional integration selector to probe/create and store the resolved route with optional typed catalog provenance. Verify old URL-only clients, key/URL conflicts, custom canonical matching, lookalike rejection, and existing endpoint round trips.
- [ ] 1.4 Test catalog updates and removal. Verify saved endpoint addresses, slugs, and grants remain unchanged.

## 2. Shared frontend selection

- [ ] 2.1 Add entity API types, fetching, and search state for catalog reads. Verify old-backend and failed-request fallbacks with entity tests.
- [ ] 2.2 Add the shared searchable catalog screen and custom URL action to `McpConnectJourney`. Verify GitHub/Slack selection, retained search on Back, loading/error/empty states, and cancellation without persistence.
- [ ] 2.3 Keep endpoint-targeted requests and reconnects on their existing route. Verify settings, agent configuration, and in-chat entry points with rendered integration tests.
- [ ] 2.4 Check keyboard operation, visible focus, labels, and narrow-screen layout. Record browser evidence from the deployed application, not only a component harness.

## 3. Delivery

- [ ] 3.1 Add provider guide links and manual setup guidance needed when managed clients are absent. Verify links against the published docs, not a planned URL.
- [ ] 3.2 Run backend catalog/probe/router and entity/journey tests, package builds/lints, and `git diff --check`. Record commands and exact tested commit.
- [ ] 3.3 Obtain catalog acceptance and archive only this change. Verify registered-client specs remain intact and managed-client requirements remain proposed until implemented separately.
