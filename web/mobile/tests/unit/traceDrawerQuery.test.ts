import type {NextRouter} from "next/router"
import {describe, expect, it} from "vitest"

import {currentQuery} from "@/features/observability/bindTraceDrawerSeams"

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
