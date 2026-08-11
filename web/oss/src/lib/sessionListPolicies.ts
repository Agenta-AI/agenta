import type {SessionListRequestPolicy} from "@agenta/sessions/state"

export const sessionListPolicies = {
    homeHuman: {origin: "exclude-trigger", expansions: ["last_message"]},
    homeAutomation: {origin: "trigger-only", expansions: ["last_message", "trigger"]},
    sessionsDefault: {origin: "exclude-trigger", expansions: ["last_message"]},
    sessionsAutomation: {origin: "trigger-only", expansions: ["last_message", "trigger"]},
    agentOverviewHuman: {origin: "exclude-trigger", expansions: []},
    agentOverviewAutomation: {origin: "trigger-only", expansions: []},
    sidebar: {origin: "exclude-trigger", expansions: []},
    internal: {origin: "all", expansions: []},
    agentActivity: {origin: "all", expansions: []},
} as const satisfies Record<string, SessionListRequestPolicy>
