import {describe, expect, it} from "vitest"

import {resolveWorkspaceContext, type WorkspaceContextInput} from "./workspaceContext"

const settled = (overrides: Partial<WorkspaceContextInput> = {}): WorkspaceContextInput => ({
    routeLayer: "workspace",
    workspaceId: "does-not-exist-xyz",
    sessionExists: true,
    isPending: false,
    failure: null,
    ...overrides,
})

describe("resolveWorkspaceContext", () => {
    it("stays neutral off a workspace-scoped route", () => {
        const ctx = resolveWorkspaceContext(settled({routeLayer: "app", failure: {status: 401}}))
        expect(ctx).toEqual({isResolving: false, isNotFound: false, isError: false})
    })

    it("resolves while the projects query is pending", () => {
        expect(resolveWorkspaceContext(settled({isPending: true})).isResolving).toBe(true)
    })

    it("stays neutral once the projects query succeeds", () => {
        const ctx = resolveWorkspaceContext(settled())
        expect(ctx).toEqual({isResolving: false, isNotFound: false, isError: false})
    })

    it.each([400, 401, 403, 404])("reads a %i as a workspace that is not there", (status) => {
        expect(resolveWorkspaceContext(settled({failure: {status}})).isNotFound).toBe(true)
    })

    it("blames the session, not the id, when the session is gone", () => {
        const ctx = resolveWorkspaceContext(settled({failure: {status: 401}, sessionExists: false}))
        expect(ctx.isNotFound).toBe(false)
        expect(ctx.isResolving).toBe(true)
    })

    it("never shows the 404 for a transport failure", () => {
        const ctx = resolveWorkspaceContext(settled({failure: {status: null}}))
        expect(ctx).toEqual({isResolving: false, isNotFound: false, isError: true})
    })

    it("never shows the 404 for a server failure", () => {
        expect(resolveWorkspaceContext(settled({failure: {status: 500}})).isError).toBe(true)
    })
})
