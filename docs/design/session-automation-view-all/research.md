# Relevant Code Paths

`web/oss/src/components/pages/overview/agent/AgentOverview.tsx` owns the two Overview cards and
their View all targets.

`web/oss/src/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/sessions/index.tsx` owns the
agent-scoped Sessions route. It reads the application's normalized route query and applies any
recognized initial scope before rendering the list.

`web/packages/agenta-sessions/src/state/filters.ts` owns `applySessionScopeAtom`. A scope with
`origin: "trigger"` clears stale filters and enables `sessionShowTriggeredAtom`.

`web/packages/agenta-sessions/src/state/useSessionsList.ts` reads that atom and selects the
existing automation policy. The automation policy requests only trigger-origin sessions.
