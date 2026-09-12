import type {SessionListRequestPolicy} from "@agenta/sessions/state"

import type {SessionActivityWindow, SessionGrouping} from "../sessions/sessionListView"

/** The two lists the overview's tabs switch between. */
export type AgentActivityTab = "sessions" | "runs"

/** How the overview's rows are cut. No "agent": every row here is this agent's. */
export type AgentActivityGrouping = Exclude<SessionGrouping, "agent">

export interface AgentActivityView {
    tab: AgentActivityTab
    group: AgentActivityGrouping
    activity: SessionActivityWindow
}

/** Flat and unbounded: the page is one agent's whole history, not a project-wide search. */
export const DEFAULT_AGENT_ACTIVITY_VIEW: AgentActivityView = {
    tab: "sessions",
    group: "none",
    activity: "all",
}

/** The tab is the subject, not a filter — it never counts as "narrowed". */
export const isDefaultAgentActivityView = (view: AgentActivityView): boolean =>
    view.group === DEFAULT_AGENT_ACTIVITY_VIEW.group &&
    view.activity === DEFAULT_AGENT_ACTIVITY_VIEW.activity

/**
 * The origin policy a tab pins. Passed as BOTH policies to `useSessionsList` so the tab, not the
 * shared Type facet, decides what this list shows — the sessions page's mode must not leak here.
 */
export const agentActivityPolicy = (tab: AgentActivityTab): SessionListRequestPolicy =>
    tab === "runs"
        ? {origin: "trigger-only", expansions: ["trigger"]}
        : {origin: "exclude-trigger", expansions: []}
