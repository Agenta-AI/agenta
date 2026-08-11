import {describe, expect, it} from "vitest"

import {
    selectedSessionListPolicy,
    sessionListIdGroupLimit,
    sessionListRequestFilters,
} from "../../src/state/sessionListPolicy"

describe("sessionListRequestFilters", () => {
    it("maps each explicit origin policy into canonical entity filters", () => {
        expect(sessionListRequestFilters({origin: "all", expansions: []})).toEqual({
            origins: undefined,
            excludeOrigins: undefined,
            expand: [],
        })
        expect(
            sessionListRequestFilters({origin: "exclude-trigger", expansions: ["last_message"]}),
        ).toEqual({
            origins: undefined,
            excludeOrigins: ["trigger"],
            expand: ["last_message"],
        })
        expect(
            sessionListRequestFilters({
                origin: "trigger-only",
                expansions: ["last_message", "trigger"],
            }),
        ).toEqual({
            origins: ["trigger"],
            excludeOrigins: undefined,
            expand: ["last_message", "trigger"],
        })
        // Agent overview's automation section: needs the trigger name to resolve, but never
        // requests message previews (unlike Home/Sessions automation mode above).
        expect(
            sessionListRequestFilters({
                origin: "trigger-only",
                expansions: ["trigger"],
            }),
        ).toEqual({
            origins: ["trigger"],
            excludeOrigins: undefined,
            expand: ["trigger"],
        })
    })

    it("selects one policy for both pinned and recent Sessions groups", () => {
        const defaultPolicy = {origin: "exclude-trigger", expansions: ["last_message"]} as const
        const automationPolicy = {
            origin: "trigger-only",
            expansions: ["last_message", "trigger"],
        } as const

        expect(selectedSessionListPolicy(false, defaultPolicy, automationPolicy)).toBe(
            defaultPolicy,
        )
        expect(selectedSessionListPolicy(true, defaultPolicy, automationPolicy)).toBe(
            automationPolicy,
        )
    })

    it("requests all 100 normalized pinned session ids", () => {
        const ids = Array.from({length: 100}, (_, index) => `pin-${index}`)
        expect(sessionListIdGroupLimit([...ids, ...ids], undefined)).toBe(100)
    })

    it("requests all 100 waiting session ids instead of the default page", () => {
        const ids = Array.from({length: 100}, (_, index) => `waiting-${index}`)
        expect(sessionListIdGroupLimit(ids, 30)).toBe(100)
    })
})
