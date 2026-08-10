import {describe, expect, it} from "vitest"

import {groupByWorkspace} from "../../src/features/context/workspaceGroups"
import type {MobileProject} from "../../src/lib/context"

const project = (projectId: string, workspaceId: string | null, name = "Workspace") =>
    ({
        project_id: projectId,
        project_name: projectId,
        workspace_id: workspaceId,
        workspace_name: workspaceId ? name : null,
    }) as MobileProject

describe("groupByWorkspace", () => {
    it("groups projects under their workspace, keeping server order", () => {
        const groups = groupByWorkspace([
            project("p1", "w1"),
            project("p2", "w2"),
            project("p3", "w1"),
        ])

        expect(groups.map((g) => g.workspaceId)).toEqual(["w1", "w2"])
        expect(groups[0].projects.map((p) => p.project_id)).toEqual(["p1", "p3"])
    })

    it("drops a project with no workspace — it cannot be routed to", () => {
        // The session route is /w/:workspaceId/p/:projectId; without the first half the row
        // would render as a tap that goes nowhere.
        expect(groupByWorkspace([project("orphan", null), project("p1", "w1")])).toHaveLength(1)
    })

    it("falls back to a generic name when the workspace is unnamed", () => {
        const [group] = groupByWorkspace([
            {project_id: "p1", project_name: "p1", workspace_id: "w1"} as MobileProject,
        ])
        expect(group.workspaceName).toBe("Workspace")
    })
})
