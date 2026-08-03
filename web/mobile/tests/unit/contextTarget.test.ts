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
    switching: false,
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
        // The guard that keeps `?switch=1` reachable: a forward decided on the first render,
        // before the query string parses, would skip the switch intent entirely.
        expect(
            selectContextTarget(
                input({ready: false, shortcut: {workspaceId: "w1", projectId: "p1"}}),
            ),
        ).toBeNull()
    })

    it("suppresses the remembered pair while switching", () => {
        expect(
            selectContextTarget(
                input({switching: true, shortcut: {workspaceId: "w1", projectId: "p1"}}),
            ),
        ).toBeNull()
    })

    it("suppresses every other shortcut while switching", () => {
        expect(
            selectContextTarget(
                input({
                    switching: true,
                    groups: [group("w1", ["p1"])],
                    desktopLastUsed: {w1: "p1"},
                }),
            ),
        ).toBeNull()
    })

    it("forwards when there is exactly one project to choose", () => {
        expect(selectContextTarget(input({groups: [group("w1", ["p1"])]}))).toEqual({
            workspaceId: "w1",
            projectId: "p1",
        })
    })

    it("shows the picker when a workspace holds several projects", () => {
        expect(selectContextTarget(input({groups: [group("w1", ["p1", "p2"])]}))).toBeNull()
    })

    it("follows the desktop's last-used pair", () => {
        expect(
            selectContextTarget(
                input({groups: [group("w1", ["p1", "p2"])], desktopLastUsed: {w1: "p2"}}),
            ),
        ).toEqual({workspaceId: "w1", projectId: "p2"})
    })

    it("ignores a desktop pair whose project is gone", () => {
        expect(
            selectContextTarget(
                input({groups: [group("w1", ["p1", "p2"])], desktopLastUsed: {w1: "deleted"}}),
            ),
        ).toBeNull()
    })

    it("shows the picker when several workspaces are in play", () => {
        expect(
            selectContextTarget(input({groups: [group("w1", ["p1"]), group("w2", ["p2"])]})),
        ).toBeNull()
    })
})
