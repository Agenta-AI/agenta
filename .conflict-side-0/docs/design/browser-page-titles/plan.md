# Implementation plan

## Shippable slice: semantic browser titles

Implement the complete frontend title policy as one reviewable slice. This is one coherent behavior and does not change an API or stored contract.

### Implementation

1. Add a shared `PageTitle` component and pure formatter that use `next/head`, normalize title parts, truncate session titles to 60 characters, and fall back to `Agenta`.
2. Keep one synchronous global title as the loading and unknown-route fallback; asynchronous cloud scripts must not write a competing title.
3. Add page-owned titles for Home, Settings, and the primary project navigation pages.
4. Add primary agent-feature titles that use the current workflow artifact display name.
5. In the agent playground, use the artifact name for an empty session and the active persisted session title after chat starts.
6. In observability, render `Observability | Agenta` for project scope and `Observability | <Agent name>` for agent scope.
7. Do not attach title changes to drawers, inspectors, filters, or settings tab query parameters.
8. Leave authentication, workspace, archive, and deep-detail routes on the safe fallback for a separately reviewed follow-up.

### Automated acceptance checks

- Unit tests cover formatting, missing values, whitespace, the separator, exact 60-character input, and truncation beyond 60 characters.
- Unit tests cover agent-chat title precedence for an empty session, durable session title, first-user-message fallback, active-session input changes, and long titles.
- A targeted live browser check covers Home, Settings, project observability, an empty agent chat, the first user message, and agent observability.
- Existing frontend tests, type checks, and lint pass.

### Live acceptance checks

Against the local EE development deployment, confirm:

1. Home shows `Home | Agenta`, including first-run onboarding.
2. A new empty agent chat shows `<Agent name> | Agenta`.
3. Sending the first message changes the title to the persisted session title followed by `| Agenta` and limits the session part to 60 characters.
4. Switching or renaming a session updates the title without a reload.
5. Project observability shows `Observability | Agenta`.
6. Agent observability shows `Observability | <Agent name>`.
7. Settings shows `Settings | Agenta`, and changing its tab does not change the title.
8. Opening and closing an observability inspector or drawer does not change the containing page title.

### Loop limit

Run at most three implementation, test, or live-debug rounds. Each round must make measurable progress. If the same blocker remains after three rounds, record the exact reproduction in `status.md` and ask for direction.

