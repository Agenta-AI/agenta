import type {SessionListRequestPolicy} from "@agenta/sessions/state"

export const sessionListPolicies = {
    homeHuman: {origin: "exclude-trigger", expansions: ["last_message"]},
    homeAutomation: {origin: "trigger-only", expansions: ["last_message", "trigger"]},
    sessionsDefault: {origin: "exclude-trigger", expansions: ["last_message"]},
    sessionsAutomation: {origin: "trigger-only", expansions: ["last_message", "trigger"]},
    agentOverviewHuman: {origin: "exclude-trigger", expansions: []},
    // Trigger names resolve automation rows to their schedule/subscription name (falling back to
    // the historical name once deleted) — without it every row reads "Missing schedule". No
    // `last_message`: this surface intentionally never requests message previews.
    agentOverviewAutomation: {origin: "trigger-only", expansions: ["trigger"]},
    sidebar: {origin: "exclude-trigger", expansions: []},
    // A pin is an explicit user request and overrides the sidebar's origin filter — a pinned
    // automation session must still show (P2-8).
    sidebarPinned: {origin: "all", expansions: []},
    internal: {origin: "all", expansions: []},
    agentActivity: {origin: "all", expansions: []},
} as const satisfies Record<string, SessionListRequestPolicy>
