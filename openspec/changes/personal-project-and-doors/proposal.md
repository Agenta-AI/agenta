# Personal project, service accounts, agent moves and doors (M6)

## Why

Every project is a team project, so a user has no private place for their own agent. API keys and channel installations act as a human. A run reaches only its own project, so a personal agent cannot use the team agents and files that its user can already use. Sharing an agent means moving it into a team project, and no move exists.

## What Changes

Four ordered deliveries, each testable alone. Shared rules: CONTRACT.md sections 1, 3 and 10.

- **D1. Service identity** (`service-accounts`). A `service_account` principal: a non-human member of one team project with one role. Keys become personal keys (act as their user) or service keys (act as a service account). Installations belong to a service account. Existing keys and installations migrate once. Afterwards `PrincipalKind` is `human | service_account`.
- **D2. Personal projects** (`personal-projects`). One per (organization, user), created on first use. In `/m`, a new agent starts in its creator's personal project.
- **D3. Agent moves** (`agent-moves`). Sharing an agent moves it from the owner's personal project into a team project. Rows only, no file copy.
- **D4. Doors** (`project-doors`). Server-side find agents, run an agent and read files, from a web run in the user's personal project into a team project of the same organization.

## Non-goals

- Write doors, doors across organizations, a project switch, a target-project credential in the sandbox.
- Team-to-team moves and moves back into a personal project. So no move refusal for M8 use grants, which do not exist on personal agents.
- Use grants (M8), user-owned credentials (M7), session trace filtering (M9).
- Service-account groups, multi-project service accounts, API key scopes.
- Deleting the personal project data of an owner who left.
