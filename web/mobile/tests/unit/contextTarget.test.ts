import {describe, expect, it} from "vitest"

import {
    selectContextTarget,
    type ContextTargetInput,
} from "../../src/features/context/contextTarget"
import type {WorkspaceGroup} from "../../src/features/context/workspaceGroups"

const project = (projectId: string, workspaceId: string) =>
    ({
        project_id: projectId,
        project_name: projectId,
        workspace_id: workspaceId,
        workspace_name: workspaceId,
    }) as WorkspaceGroup["projects"][number]

const group = (workspaceId: string, projectIds: string[]): WorkspaceGroup => ({
    workspaceId,
    workspaceName: workspaceId,
    projects: projectIds.map((id) => project(id, workspaceId)),
})

const input = (overrides: Partial<ContextTargetInput> = {}): ContextTargetInput => ({
    ready: true,
    shortcut: null,
    groups: [],
    desktopLastUsed: {},
    ...overrides,
})

describe("selectContextTarget", () => {
    it("forwards to the remembered pair", () => {
        const shortcut = {workspaceId: "w1", projectId: "p1"}
        expect(selectContextTarget(input({shortcut}))).toEqual(shortcut)
    })

    it("decides nothing until the router is ready", () => {
        expect(
            selectContextTarget(
                input({ready: false, shortcut: {workspaceId: "w1", projectId: "p1"}}),
            ),
        ).toBeNull()
    })

    it("forwards to the only project", () => {
        expect(selectContextTarget(input({groups: [group("w1", ["p1"])]}))).toEqual({
            workspaceId: "w1",
            projectId: "p1",
        })
    })

    it("follows the desktop's last-used pair", () => {
        expect(
            selectContextTarget(
                input({groups: [group("w1", ["p1", "p2"])], desktopLastUsed: {w1: "p2"}}),
            ),
        ).toEqual({workspaceId: "w1", projectId: "p2"})
    })

    it("falls back to the first project when a desktop pair's project is gone", () => {
        // There is no picker page — switching lives in the drawer, so the resolver always lands
        // somewhere and the drawer corrects it.
        expect(
            selectContextTarget(
                input({groups: [group("w1", ["p1", "p2"])], desktopLastUsed: {w1: "deleted"}}),
            ),
        ).toEqual({workspaceId: "w1", projectId: "p1"})
    })

    it("defaults to the first workspace's first project", () => {
        expect(
            selectContextTarget(input({groups: [group("w1", ["p1"]), group("w2", ["p2"])]})),
        ).toEqual({workspaceId: "w1", projectId: "p1"})
    })

    it("resolves nothing for an account with no projects", () => {
        expect(selectContextTarget(input())).toBeNull()
    })
})
