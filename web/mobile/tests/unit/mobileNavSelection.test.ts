import {describe, expect, it} from "vitest"

import {selectedKeyOverrideFor} from "@/features/nav/mobileNavScope"

const P = "/w/[workspace_id]/p/[project_id]"

describe("selectedKeyOverrideFor", () => {
    it("selects Prompts, not Home, on an app overview and playground", () => {
        expect(selectedKeyOverrideFor(`${P}/apps/[app_id]/overview`, null)).toBe(
            "developer-view-prompts",
        )
        expect(selectedKeyOverrideFor(`${P}/apps/[app_id]/playground`, null)).toBe(
            "developer-view-prompts",
        )
    })

    it("leaves other routes to the route match", () => {
        for (const path of [`${P}/apps`, `${P}/agents/[agent_id]`, `${P}/variants`]) {
            expect(selectedKeyOverrideFor(path, null)).toBeUndefined()
        }
    })

    it("pins an open session first", () => {
        expect(selectedKeyOverrideFor(`${P}/sessions/[session_id]`, "s1")).toMatch(/s1$/)
    })
})
