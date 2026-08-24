import {describe, expect, it} from "vitest"

import {groupByOrganization, groupByWorkspace} from "../../src/features/context/workspaceGroups"
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

const orgProject = (
    projectId: string,
    organizationId: string | null,
    organizationName: string | null,
    workspaceId: string | null = `ws-${organizationId}`,
) =>
    ({
        project_id: projectId,
        project_name: projectId,
        workspace_id: workspaceId,
        workspace_name: "Default",
        organization_id: organizationId,
        organization_name: organizationName,
    }) as MobileProject

describe("groupByOrganization", () => {
    it("names each group after its ORGANIZATION, not its workspace", () => {
        // The bug this guards: every org's default workspace is called "Default", so grouping by
        // workspace rendered N indistinguishable rows and switching orgs became a coin flip.
        const groups = groupByOrganization([
            orgProject("p1", "o1", "Acme Robotics"),
            orgProject("p2", "o2", "Contoso"),
        ])

        expect(groups.map((g) => g.organizationName)).toEqual(["Acme Robotics", "Contoso"])
    })

    it("collects every workspace's projects under one org, keeping server order", () => {
        const groups = groupByOrganization([
            orgProject("p1", "o1", "Acme", "ws-a"),
            orgProject("p2", "o2", "Contoso", "ws-c"),
            orgProject("p3", "o1", "Acme", "ws-b"),
        ])

        expect(groups).toHaveLength(2)
        expect(groups[0].projects.map((p) => p.project_id)).toEqual(["p1", "p3"])
        // The org row enters its FIRST workspace; each project row carries its own.
        expect(groups[0].workspaceId).toBe("ws-a")
    })

    it("drops a project with no workspace — it cannot be routed to", () => {
        expect(groupByOrganization([orgProject("orphan", "o1", "Acme", null)])).toHaveLength(0)
    })

    it("keeps an org-less project, keyed by its workspace", () => {
        const groups = groupByOrganization([orgProject("p1", null, null, "w1")])
        expect(groups).toHaveLength(1)
        expect(groups[0].organizationName).toBe("Default")
    })
})
