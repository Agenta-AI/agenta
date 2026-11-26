import {describe, expect, it} from "vitest"

import {isProjectPath, projectSwitchUrl} from "../../src/lib/context"

const next = {workspaceId: "O2", projectId: "P2"}

describe("projectSwitchUrl", () => {
    it("keeps the open settings tab", () => {
        expect(projectSwitchUrl("/w/O1/p/P1/settings?tab=llms", next)).toBe(
            "/w/O2/p/P2/settings?tab=llms",
        )
    })

    it("drops every settings query param but the tab", () => {
        expect(
            projectSwitchUrl("/w/O1/p/P1/settings?tab=tools&workspace_id=O1&project_id=P1", next),
        ).toBe("/w/O2/p/P2/settings?tab=tools")
    })

    it("opens settings without a tab when none is set", () => {
        expect(projectSwitchUrl("/w/O1/p/P1/settings", next)).toBe("/w/O2/p/P2/settings")
    })

    it("keeps a list section", () => {
        expect(projectSwitchUrl("/w/O1/p/P1/observability", next)).toBe("/w/O2/p/P2/observability")
    })

    it("leaves an entity of the old project for its section's list", () => {
        expect(projectSwitchUrl("/w/O1/p/P1/sessions/S1?agent=A1", next)).toBe(
            "/w/O2/p/P2/sessions",
        )
        expect(projectSwitchUrl("/w/O1/p/P1/agents/A1", next)).toBe("/w/O2/p/P2/agents")
    })

    it("lands on the project home from onboarding or the project root", () => {
        expect(projectSwitchUrl("/w/O1/p/P1/onboarding/keys", next)).toBe("/w/O2/p/P2/apps")
        expect(projectSwitchUrl("/w/O1/p/P1", next)).toBe("/w/O2/p/P2/apps")
    })

    it("lands on the project home from a path outside a project", () => {
        expect(projectSwitchUrl("/w", next)).toBe("/w/O2/p/P2/apps")
    })

    it("returns the path unchanged when it is already in the target project", () => {
        expect(projectSwitchUrl("/w/O2/p/P2/sessions/S1?agent=A1", next)).toBe(
            "/w/O2/p/P2/sessions/S1?agent=A1",
        )
    })

    it("does not throw on a malformed escape in the old project id", () => {
        expect(projectSwitchUrl("/w/O1/p/P%zz/settings?tab=llms", next)).toBe(
            "/w/O2/p/P2/settings?tab=llms",
        )
    })
})

describe("isProjectPath", () => {
    it("tells project routes from the rest", () => {
        expect(isProjectPath("/w/O1/p/P1/observability")).toBe(true)
        expect(isProjectPath("/lab")).toBe(false)
        expect(isProjectPath("/w")).toBe(false)
    })
})
