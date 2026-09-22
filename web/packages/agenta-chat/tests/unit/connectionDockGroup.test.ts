import {act, renderHook} from "@testing-library/react"
import {describe, expect, it, vi} from "vitest"

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

describe("useConnectionDock host-driven dismiss", () => {
    // A chat message sent over the dock replaces the requests. The host settles every parked card
    // through this, exactly as each card's own "Not now" would, before steering the message in.
    it("declines every parked connection once, and closes the dock while the writes are out", async () => {
        const onOutput = vi.fn(() => Promise.resolve(true))
        const parts = [part("github-1", false), part("gmail-1", false)]
        const {result} = renderHook(() => useConnectionDock({messages: turn(parts), onOutput}))
        expect(result.current.open).toBe(true)

        await act(async () => {
            await Promise.all([result.current.dismiss(), result.current.dismiss()])
        })

        expect(onOutput).toHaveBeenCalledTimes(2)
        expect(onOutput.mock.calls.map((call) => call[0])).toEqual([
            expect.objectContaining({
                toolCallId: "github-1",
                output: {
                    connected: false,
                    integration: "github",
                    slug: "github",
                    reason: "declined",
                },
            }),
            expect.objectContaining({
                toolCallId: "gmail-1",
                output: {connected: false, integration: "gmail", slug: "gmail", reason: "declined"},
            }),
        ])
        // Shut, but still holding the cards so the host can animate the collapse.
        expect(result.current.open).toBe(false)
        expect(result.current.stack).toHaveLength(2)
    })

    it("re-opens the dock and lets the failure through when a write does not land", async () => {
        const onOutput = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)
        const parts = [part("github-1", false), part("gmail-1", false)]
        const {result} = renderHook(() => useConnectionDock({messages: turn(parts), onOutput}))

        await act(async () => {
            await expect(result.current.dismiss()).rejects.toThrow("couldn't be dismissed")
        })

        expect(result.current.open).toBe(true)
        // The latch let go too: the next attempt goes out again.
        await act(async () => {
            await result.current.dismiss().catch(() => undefined)
        })
        expect(onOutput).toHaveBeenCalledTimes(4)
    })

    it("does nothing when nothing is parked", async () => {
        const onOutput = vi.fn()
        const {result} = renderHook(() =>
            useConnectionDock({messages: turn([part("github-1", true)]), onOutput}),
        )

        await act(async () => {
            await result.current.dismiss()
        })

        expect(onOutput).not.toHaveBeenCalled()
        expect(result.current.open).toBe(false)
    })
})
