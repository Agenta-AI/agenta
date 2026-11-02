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
    projects: projectIds.map((id) => project(id, workspaceId)),
})

const input = (overrides: Partial<ContextTargetInput> = {}): ContextTargetInput => ({
    ready: true,
    shortcut: null,
    groups: [],
    groupsLoaded: true,
    desktopLastUsed: {},
    ...overrides,
})

describe("selectContextTarget", () => {
    it("forwards to the remembered pair", () => {
        const shortcut = {workspaceId: "w1", projectId: "p1"}
        expect(selectContextTarget(input({shortcut, groups: [group("w1", ["p1", "p2"])]}))).toEqual(
            shortcut,
        )
    })

    it("forwards to the remembered pair before the projects have loaded", () => {
        const shortcut = {workspaceId: "w1", projectId: "p1"}
        expect(selectContextTarget(input({shortcut, groupsLoaded: false}))).toEqual(shortcut)
    })

    it("drops a remembered pair the loaded tree no longer holds", () => {
        expect(
            selectContextTarget(
                input({
                    shortcut: {workspaceId: "w1", projectId: "deleted"},
                    groups: [group("w1", ["p1"])],
                    desktopLastUsed: {},
                }),
            ),
        ).toEqual({workspaceId: "w1", projectId: "p1"})
    })

    it("keeps a remembered project whose saved workspace id no group answers", () => {
        // Workspace removal step 2: the saved id can be a legacy workspace id; the project
        // id still finds the project, under its group's segment.
        expect(
            selectContextTarget(
                input({
                    shortcut: {workspaceId: "gone", projectId: "p1"},
                    groups: [group("w1", ["p1", "p2"])],
                    desktopLastUsed: {w1: "p2"},
                }),
            ),
        ).toEqual({workspaceId: "w1", projectId: "p1"})
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
        // There is no picker page: land somewhere and let the drawer correct it.
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

    it("stays inside the workspace the URL names", () => {
        expect(
            selectContextTarget(
                input({
                    workspaceId: "w2",
                    shortcut: {workspaceId: "w1", projectId: "p1"},
                    groups: [group("w1", ["p1"]), group("w2", ["p2"])],
                }),
            ),
        ).toEqual({workspaceId: "w2", projectId: "p2"})
    })

    it("keeps the remembered pair when it belongs to the named workspace", () => {
        const shortcut = {workspaceId: "w1", projectId: "p2"}
        expect(
            selectContextTarget(
                input({workspaceId: "w1", shortcut, groups: [group("w1", ["p1", "p2"])]}),
            ),
        ).toEqual(shortcut)
    })

    it("waits for the tree before forwarding a remembered pair from another workspace", () => {
        expect(
            selectContextTarget(
                input({
                    workspaceId: "w2",
                    shortcut: {workspaceId: "w1", projectId: "p1"},
                    groupsLoaded: false,
                }),
            ),
        ).toBeNull()
    })

    it("falls back to the whole tree when the named workspace is not in it", () => {
        // A truncated or stale link is not a dead end — land somewhere the drawer can correct.
        expect(
            selectContextTarget(input({workspaceId: "gone", groups: [group("w1", ["p1"])]})),
        ).toEqual({workspaceId: "w1", projectId: "p1"})
    })

    it("follows desktop continuity within the named workspace", () => {
        expect(
            selectContextTarget(
                input({
                    workspaceId: "w2",
                    groups: [group("w1", ["p1"]), group("w2", ["p2", "p3"])],
                    desktopLastUsed: {w1: "p1", w2: "p3"},
                }),
            ),
        ).toEqual({workspaceId: "w2", projectId: "p3"})
    })
})

describe("selectContextTarget after workspace removal step 2", () => {
    // Groups route under the organization id; their rows keep the workspace id the API
    // answered (a legacy id on an older pod, or in a pair saved before the upgrade).
    const orgGroup = (organizationId: string, rows: [string, string][]): WorkspaceGroup => ({
        workspaceId: organizationId,
        projects: rows.map(([id, legacy]) => ({
            ...project(id, organizationId),
            legacy_workspace_id: legacy,
        })),
    })

    it("resolves a remembered legacy pair to the organization id", () => {
        expect(
            selectContextTarget(
                input({
                    shortcut: {workspaceId: "W2", projectId: "P2"},
                    groups: [
                        orgGroup("O1", [
                            ["P1", "W1"],
                            ["P2", "W2"],
                        ]),
                    ],
                }),
            ),
        ).toEqual({workspaceId: "O1", projectId: "P2"})
    })

    it("follows a desktop pair keyed by a legacy workspace id", () => {
        expect(
            selectContextTarget(
                input({
                    groups: [
                        orgGroup("O1", [
                            ["P1", "W1"],
                            ["P2", "W2"],
                        ]),
                    ],
                    desktopLastUsed: {W2: "P2"},
                }),
            ),
        ).toEqual({workspaceId: "O1", projectId: "P2"})
    })

    it("scopes a link with a legacy workspace id to that organization", () => {
        expect(
            selectContextTarget(
                input({
                    workspaceId: "W3",
                    groups: [orgGroup("O1", [["P1", "W1"]]), orgGroup("O2", [["P3", "W3"]])],
                }),
            ),
        ).toEqual({workspaceId: "O2", projectId: "P3"})
    })
})
