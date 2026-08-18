# Context

## Current user experience

Agenta currently presents a static marketing title in the browser tab. The title does not tell users which product page, agent, or chat session they are viewing. This makes multiple open Agenta tabs difficult to distinguish.

## Required behavior

The browser title follows these rules:

| Context | Title |
| --- | --- |
| Home | `Home | Agenta` |
| Empty agent chat | `<Agent name> | Agenta` |
| Agent chat after the session starts | `<Session title, at most 60 characters> | Agenta` |
| Project observability | `Observability | Agenta` |
| Agent observability | `Observability | <Agent name>` |
| Settings | `Settings | Agenta` |

For example, an empty chat uses `Marketing Coworker | Agenta`. After the first message creates a session title, the same tab uses that persisted title and truncates it to 60 characters when needed.

## Reviewed follow-up inventory

The route inventory also found secondary page families that should eventually receive semantic titles:

- Archive and detail pages: use the visible page concept, such as `Archived Agents | Agenta` or `Evaluation results | Agenta`.
- Authentication and workspace pages: use the visible action or page, such as `Sign in | Agenta`, `Workspaces | Agenta`, or `Accept invitation | Agenta`.

Those secondary routes are not part of this minor slice. They retain the safe global fallback and should be handled in a follow-up that can define and test their route-specific semantics. This slice covers the requested states plus primary navigation:

- Project pages: `Home`, `Prompts`, `Agents`, `Test sets`, `Evaluators`, `Evaluation runs`, `Annotation Queues`, `Observability`, and `Settings`, each followed by `| Agenta`.
- Agent pages: `Overview`, `Registry`, `Evaluations`, and `Observability`, each followed by `| <Agent name>`.
- Agent chat and non-agent workflow playground titles.

Drawers, inspectors, filters, settings tabs, and other query-parameter-only states keep the title of their containing page.

## Goals

- Make open browser tabs distinguishable without adding data requests or new state.
- Keep semantic title ownership with the page or feature that owns the displayed state.
- Update the agent chat title when the active session changes, receives its first message, or is renamed.
- Preserve a safe `Agenta` fallback during loading and on unknown routes.

## Non-goals

- Changing route structure, navigation labels, agent naming, or session naming.
- Adding titles for drawers or temporary overlays.
- Adding titles for authentication, workspace selection, archives, or deep detail pages.
- Changing backend APIs, stored data, or analytics.

