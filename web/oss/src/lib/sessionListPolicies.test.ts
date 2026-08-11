import {describe, expect, it} from "vitest"

import {sessionListPolicies} from "./sessionListPolicies"

describe("session list caller policies", () => {
    it("matches the approved desktop origin and expansion matrix", () => {
        expect(sessionListPolicies).toEqual({
            homeHuman: {origin: "exclude-trigger", expansions: ["last_message"]},
            homeAutomation: {
                origin: "trigger-only",
                expansions: ["last_message", "trigger"],
            },
            sessionsDefault: {origin: "exclude-trigger", expansions: ["last_message"]},
            sessionsAutomation: {
                origin: "trigger-only",
                expansions: ["last_message", "trigger"],
            },
            agentOverviewHuman: {origin: "exclude-trigger", expansions: []},
            agentOverviewAutomation: {origin: "trigger-only", expansions: ["trigger"]},
            sidebar: {origin: "exclude-trigger", expansions: []},
            sidebarPinned: {origin: "all", expansions: []},
            internal: {origin: "all", expansions: []},
            agentActivity: {origin: "all", expansions: []},
        })
    })
})
