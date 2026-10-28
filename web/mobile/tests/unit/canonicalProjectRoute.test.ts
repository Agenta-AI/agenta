import {describe, expect, it} from "vitest"

import {groupByOrganization, groupByWorkspace} from "../../src/features/context/workspaceGroups"
import {canonicalProjectPath, projectRouteSegment, type MobileProject} from "../../src/lib/context"

const row = (projectId: string, workspaceId: string, organizationId: string) =>
    ({
        project_id: projectId,
        project_name: projectId,
        workspace_id: workspaceId,
        workspace_name: "W",
        organization_id: organizationId,
        organization_name: "Org",
    }) as MobileProject

describe("canonicalProjectPath", () => {
    const projects = [row("P", "O", "O")]

    it("keeps a URL whose segment is the project's organization id", () => {
        expect(canonicalProjectPath("/w/O/p/P/sessions/S", projects)).toBeNull()
    })

    it("rewrites a legacy workspace id to the organization id", () => {
        expect(canonicalProjectPath("/w/W/p/P/sessions/S?agent=x", projects)).toBe(
            "/w/O/p/P/sessions/S?agent=x",
        )
    })

    it("rewrites even when the API answers the legacy workspace id", () => {
        // A step-1 pod answers workspace_id = W for the same legacy project.
        expect(canonicalProjectPath("/w/W/p/P/apps", [row("P", "W", "O")])).toBe("/w/O/p/P/apps")
    })

    it("does nothing while projects load or for a project the user cannot see", () => {
        expect(canonicalProjectPath("/w/W/p/P/apps", undefined)).toBeNull()
        expect(canonicalProjectPath("/w/W/p/OTHER/apps", projects)).toBeNull()
        expect(canonicalProjectPath("/w/W", projects)).toBeNull()
    })

    it("keeps an encoded segment that already names the organization", () => {
        expect(canonicalProjectPath(`/w/${encodeURIComponent("O")}/p/P`, projects)).toBeNull()
    })
})

describe("routing segment", () => {
    it("is the organization id, else the legacy workspace id", () => {
        expect(projectRouteSegment(row("P", "W", "O"))).toBe("O")
        expect(projectRouteSegment({workspace_id: "W", organization_id: null})).toBe("W")
    })

    it("groups projects by organization id", () => {
        // Two rows with different workspace ids (a step-1 and a step-2 answer), one org.
        const groups = groupByWorkspace([row("P1", "W", "O"), row("P2", "O", "O")])
        expect(groups.map((g) => g.workspaceId)).toEqual(["O"])
        expect(groups[0].projects.map((p) => p.project_id)).toEqual(["P1", "P2"])
        expect(groupByOrganization([row("P1", "W", "O"), row("P2", "O", "O")])[0].workspaceId).toBe(
            "O",
        )
    })
})
