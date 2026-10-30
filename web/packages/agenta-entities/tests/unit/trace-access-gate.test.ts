// Trace content is readable only by a role that holds `view_spans`. Without it, the trace
// atoms read nothing at all: no request leaves the browser, and every display that builds on
// the summary falls back to what the turn itself carries.
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient} from "@tanstack/react-query"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {describe, expect, it, vi} from "vitest"

const check = vi.hoisted(() => ({allowed: false, calls: 0}))
vi.mock("@agenta/sdk/resources", () => ({
    getAccessClient: () => ({
        checkPermissions: async () => {
            check.calls += 1
            if (!check.allowed) throw new Error("403")
            return {}
        },
    }),
}))

import {canViewSpansAtom} from "../../src/access"
import {traceDataSummaryAtomFamily} from "../../src/loadable"
import {traceSummaryQueryAtomFamily} from "../../src/trace/state/store"

const store = () => {
    const jotai = createStore()
    jotai.set(queryClientAtom, new QueryClient())
    jotai.set(projectIdAtom, "project-1")
    jotai.set(sessionAtom, "session-token")
    return jotai
}

describe("trace reads without view_spans", () => {
    it("answers no while the check has not landed", () => {
        expect(store().get(canViewSpansAtom)).toBe(false)
    })

    it("returns an empty summary and asks for no trace", () => {
        const jotai = store()
        const summary = jotai.get(traceDataSummaryAtomFamily("trace-1"))

        expect(summary.isPending).toBe(false)
        expect(summary.rootSpan).toBeNull()
        expect(summary.metrics).toEqual({})
    })

    it("keeps the trace summary query switched off", () => {
        const jotai = store()
        const query = jotai.get(traceSummaryQueryAtomFamily("trace-1"))

        expect(query.fetchStatus).toBe("idle")
        expect(query.isFetching).toBe(false)
    })
})
