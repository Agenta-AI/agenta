/**
 * The `defaultOpen` opt-in on AgentChangesSummary.
 *
 * The agent approval card exists to show a change, so its sections must be open on arrival: a
 * change behind a click is a change most people will approve without reading. The commit modal
 * does NOT pass it, because there the summary is a list you drill into and opening everything
 * buries the overview. One prop, two hosts, opposite defaults.
 *
 * This pins the resolution rule rather than the rendering: an explicit toggle must always beat the
 * policy, in BOTH directions, or a host that defaults open would trap a user who closed a section.
 */
import {describe, expect, it} from "vitest"

import {isSectionOpen} from "../../src/modals/commit/components/changes/sectionOpenState"

describe("isSectionOpen", () => {
    it("keeps the commit modal's behaviour when no policy is given", () => {
        expect(isSectionOpen({}, "instructions")).toBe(false)
    })

    it("opens sections for a host that asks for it", () => {
        expect(isSectionOpen({}, "instructions", true)).toBe(true)
    })

    it("lets an explicit toggle win over the policy, both ways", () => {
        // Closing a section on a default-open host has to stick.
        expect(isSectionOpen({instructions: false}, "instructions", true)).toBe(false)
        expect(isSectionOpen({instructions: true}, "instructions", false)).toBe(true)
    })

    it("applies the policy to sections it has never seen", () => {
        // The approval card classifies its delta once the committed configuration arrives, so
        // sections can appear after the first render. Seeding open state from the first `sections`
        // value would leave exactly those late sections shut, which is the bug this shape avoids.
        const overrides = {instructions: false}

        expect(isSectionOpen(overrides, "skills", true)).toBe(true)
        expect(isSectionOpen(overrides, "tools", true)).toBe(true)
    })
})
