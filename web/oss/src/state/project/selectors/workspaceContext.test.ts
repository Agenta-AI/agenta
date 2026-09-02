import {describe, expect, it} from "vitest"

import {resolveWorkspaceContext, type WorkspaceContextInput} from "./workspaceContext"

const guard = (overrides: Partial<WorkspaceContextInput> = {}): WorkspaceContextInput => ({
    routeLayer: "workspace",
    workspaceId: "does-not-exist-xyz",
    isPending: false,
    failed: false,
    belongsToWorkspace: false,
    ...overrides,
})

const NEUTRAL = {isResolving: false, isNotFound: false, isError: false}

describe("resolveWorkspaceContext", () => {
    it("stays neutral off a workspace-scoped route", () => {
        expect(resolveWorkspaceContext(guard({routeLayer: "app"}))).toEqual(NEUTRAL)
    })

    it("stays neutral when the URL names no workspace", () => {
        expect(resolveWorkspaceContext(guard({workspaceId: null}))).toEqual(NEUTRAL)
    })

    it("resolves while the guard query is pending", () => {
        expect(resolveWorkspaceContext(guard({isPending: true})).isResolving).toBe(true)
    })

    it("stays neutral once a project in the workspace is found", () => {
        expect(resolveWorkspaceContext(guard({belongsToWorkspace: true}))).toEqual(NEUTRAL)
    })

    it("reads an account with no project in the workspace as not found", () => {
        expect(resolveWorkspaceContext(guard()).isNotFound).toBe(true)
    })

    it("never shows the 404 when the guard query itself failed", () => {
        const ctx = resolveWorkspaceContext(guard({failed: true}))
        expect(ctx).toEqual({isResolving: false, isNotFound: false, isError: true})
    })

    it("prefers pending over a stale failure", () => {
        expect(resolveWorkspaceContext(guard({isPending: true, failed: true})).isResolving).toBe(
            true,
        )
    })
})
