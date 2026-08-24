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

    it("drops a project whose workspace is an empty string", () => {
        expect(groupByWorkspace([project("p1", "")])).toHaveLength(0)
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
        // Guards #6228: every org's workspace is "Default", so workspace rows were identical.
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
        expect(groups[0].key).toBe("workspace:w1")
        expect(groups[0].organizationId).toBeNull()
        expect(groups[0].organizationName).toBe("Default")
    })

    it("takes the org name from a later row when the first one has none", () => {
        const groups = groupByOrganization([
            orgProject("p1", "o1", null, "ws-a"),
            orgProject("p2", "o1", "Acme Robotics", "ws-b"),
        ])

        expect(groups[0].organizationName).toBe("Acme Robotics")
    })

    it("treats a blank name as missing, not as a name", () => {
        const groups = groupByOrganization([
            orgProject("p1", "o1", "   ", "ws-a"),
            orgProject("p2", "o1", "Acme Robotics", "ws-b"),
        ])

        expect(groups[0].organizationName).toBe("Acme Robotics")
    })

    it("carries the org id when the rows have one", () => {
        const [group] = groupByOrganization([orgProject("p1", "o1", "Acme", "ws-a")])
        expect(group.key).toBe("o1")
        expect(group.organizationId).toBe("o1")
    })
})
