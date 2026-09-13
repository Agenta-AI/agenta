import {describe, expect, it} from "vitest"

import {resolveRouteContext, type RouteContextInput} from "./routeContext"

const guard = (overrides: Partial<RouteContextInput> = {}): RouteContextInput => ({
    routeLayer: "project",
    workspaceId: "ws-1",
    projectId: "p-1",
    isPending: false,
    failed: false,
    workspaceHoldsProject: true,
    projectInWorkspace: true,
    ...overrides,
})

const NEUTRAL = {isResolving: false, isNotFound: false, isError: false}

describe("resolveRouteContext", () => {
    it("stays neutral off a route that carries these ids", () => {
        expect(resolveRouteContext(guard({routeLayer: "root"}))).toEqual(NEUTRAL)
    })

    it("stays neutral when the URL names no workspace", () => {
        expect(resolveRouteContext(guard({workspaceId: null}))).toEqual(NEUTRAL)
    })

    it("resolves while the guard query is pending", () => {
        expect(resolveRouteContext(guard({isPending: true})).isResolving).toBe(true)
    })

    it("stays neutral when both ids resolve", () => {
        expect(resolveRouteContext(guard())).toEqual(NEUTRAL)
    })

    it("reads a workspace the account holds no project in as not found", () => {
        const ctx = guard({workspaceHoldsProject: false, projectInWorkspace: false})
        expect(resolveRouteContext(ctx).isNotFound).toBe(true)
    })

    it("reads a project that is not in the named workspace as not found", () => {
        expect(resolveRouteContext(guard({projectInWorkspace: false})).isNotFound).toBe(true)
    })

    it("ignores the project check on a route that names no project", () => {
        const ctx = guard({routeLayer: "workspace", projectId: null, projectInWorkspace: false})
        expect(resolveRouteContext(ctx)).toEqual(NEUTRAL)
    })

    it("guards app routes too, so a bad workspace 404s under /apps", () => {
        const ctx = guard({routeLayer: "app", workspaceHoldsProject: false})
        expect(resolveRouteContext(ctx).isNotFound).toBe(true)
    })

    it("never shows the 404 when the guard query itself failed", () => {
        const ctx = guard({failed: true, workspaceHoldsProject: false, projectInWorkspace: false})
        expect(resolveRouteContext(ctx)).toEqual({
            isResolving: false,
            isNotFound: false,
            isError: true,
        })
    })

    it("prefers pending over a stale failure", () => {
        expect(resolveRouteContext(guard({isPending: true, failed: true})).isResolving).toBe(true)
    })
})
