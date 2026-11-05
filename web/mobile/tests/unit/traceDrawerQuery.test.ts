// @vitest-environment jsdom
import {traceDrawerClearParams, traceDrawerSetQueryParam} from "@agenta/observability/traceDrawer"
import type {NextRouter} from "next/router"
import {describe, expect, it, vi} from "vitest"

import {bindTraceDrawerSeams, currentQuery} from "@/features/observability/bindTraceDrawerSeams"

const router = (pathname: string, query: NextRouter["query"]) => ({pathname, query}) as NextRouter

describe("currentQuery", () => {
    it("keeps the route's session when the address bar names another", () => {
        const query = currentQuery(
            router("/w/[workspace_id]/p/[project_id]/sessions/[session_id]", {
                workspace_id: "w",
                project_id: "p",
                session_id: "A",
            }),
            "?session_id=B&trace=t1",
        )
        expect(query).toEqual({workspace_id: "w", project_id: "p", session_id: "A", trace: "t1"})
    })

    it("reads non-route params from the address bar", () => {
        expect(currentQuery(router("/sessions", {}), "?trace=t1&span=s1")).toEqual({
            trace: "t1",
            span: "s1",
        })
    })
})

describe("the drawer's clear params", () => {
    const bind = (pathname: string, search: string) => {
        window.history.replaceState(null, "", `${pathname}${search}`)
        const push = vi.fn(() => Promise.resolve(true))
        bindTraceDrawerSeams({pathname, query: {}, push} as unknown as NextRouter, {
            playground: false,
            openTraceId: () => null,
        })
        return push
    }

    it("drops trace and span from the address", () => {
        const push = bind("/observability", "?trace=t1&span=s1&app=a1")
        traceDrawerClearParams()
        expect(push).toHaveBeenCalledWith(
            {pathname: "/observability", query: {app: "a1"}},
            undefined,
            {shallow: true},
        )
    })

    it("does not push on a page the drawer has no params on", () => {
        // The Playground button closes the drawer and opens the playground. The drawer clears
        // its params after the close animation, when the playground address holds the snapshot.
        const push = bind("/playground", "?revisions=r1#pgSnapshot=abc")
        traceDrawerClearParams()
        expect(push).not.toHaveBeenCalled()
        expect(window.location.hash).toBe("#pgSnapshot=abc")
    })
})

describe("the drawer's address", () => {
    it("names the open trace next to the span, so a reload can open it again", () => {
        window.history.replaceState(null, "", "/observability?app=a1")
        const push = vi.fn(() => Promise.resolve(true))
        bindTraceDrawerSeams(
            {pathname: "/observability", query: {}, push} as unknown as NextRouter,
            {
                playground: false,
                openTraceId: () => "t1",
            },
        )
        traceDrawerSetQueryParam("span", "s1")
        expect(push).toHaveBeenCalledWith(
            {pathname: "/observability", query: {app: "a1", trace: "t1", span: "s1"}},
            undefined,
            {shallow: true},
        )
    })

    it("keeps the asked span and writes the trace while the trace loads", () => {
        window.history.replaceState(null, "", "/observability?trace=t1&span=s1")
        const push = vi.fn(() => Promise.resolve(true))
        bindTraceDrawerSeams(
            {pathname: "/observability", query: {}, push} as unknown as NextRouter,
            {playground: false, openTraceId: () => "t1"},
        )
        // The drawer writes no span until the trace is loaded.
        traceDrawerSetQueryParam("span", null)
        expect(push).toHaveBeenCalledWith(
            {pathname: "/observability", query: {trace: "t1", span: "s1"}},
            undefined,
            {shallow: true},
        )
    })
})
