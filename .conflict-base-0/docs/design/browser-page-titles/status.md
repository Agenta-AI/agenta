# Status

## Current state

- Date: 2026-08-03
- State: validated and ready for PR
- Shippable slice: requested browser titles plus primary navigation
- Blockers: none

## Completed

- Added a shared formatter and declarative `PageTitle` component with a synchronous global fallback.
- Added page-owned titles for Home, Settings, primary project navigation, primary agent navigation, playground, and both observability scopes.
- Added reactive agent-chat titles for empty sessions, first messages, active-session switches, and renames.
- Kept agent names on the current workflow artifact and added no new backend request.
- Completed an independent review and resolved its title-precedence, scope, slug-fallback, Unicode, and reactivity-test findings.
- Passed 12 focused unit tests, OSS and EE TypeScript checks, repository lint-fix, and `git diff --check`.
- Verified six requested states against the live EE development deployment: Home, project Observability, Settings, empty agent chat, first-message transition, and agent Observability.

## Next action

Create the isolated GitButler lane, commit the reviewed files, push, and open the PR.

## Decisions

- Use 60 Unicode code points as the session-title limit and reserve the last position for an ellipsis.
- Use the workflow artifact name, then slug, and never expose an ID in the title.
- Add no new fetches or backend changes.
- Keep drawers and query-parameter-only UI under the containing page title.
- Leave authentication, workspace, archive, and deep-detail titles for a separately reviewed follow-up.
