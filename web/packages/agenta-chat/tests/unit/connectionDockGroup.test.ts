import {renderHook} from "@testing-library/react"
import {describe, expect, it} from "vitest"

import {useConnectionDock} from "../../src/hooks/useConnectionDock"

const part = (id: string, settled: boolean) => ({
    type: "tool-request_connection",
    toolCallId: id,
    state: settled ? "output-available" : "input-available",
    input: {integration: id.split("-")[0]},
    ...(settled ? {output: {connected: true}} : {}),
})

const turn = (parts: unknown[]) => [{id: "m1", role: "assistant", parts}] as never

describe("useConnectionDock group scoping", () => {
    it("counts only the parked group, not the turn's earlier connections", () => {
        // The reported bug: 7 settled connect calls already in this turn, 1 pending.
        const parts = [
            ...[
                "github",
                "googlecalendar",
                "googletasks",
                "youtube",
                "gmail-a",
                "gmail-b",
                "gmail-c",
            ].map((k) => part(`${k}-1`, true)),
            part("gmail-live", false),
        ]
        const {result} = renderHook(() => useConnectionDock({messages: turn(parts)}))
        expect(result.current.total).toBe(1)
        expect(result.current.batch.map((m) => m.toolCallId)).toEqual(["gmail-live"])
        expect(result.current.position).toBe(1)
    })

    it("keeps a settled member of the group as progress", () => {
        const {result, rerender} = renderHook(
            ({parts}: {parts: unknown[]}) => useConnectionDock({messages: turn(parts)}),
            {initialProps: {parts: [part("a", false), part("b", false), part("c", false)]}},
        )
        expect(result.current.total).toBe(3)
        expect(result.current.position).toBe(1)

        rerender({parts: [part("a", true), part("b", false), part("c", false)]})
        expect(result.current.total).toBe(3)
        expect(result.current.position).toBe(2)
        expect(result.current.batch.map((m) => m.toolCallId)).toEqual(["a", "b", "c"])
    })
})
