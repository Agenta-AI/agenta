// @vitest-environment jsdom
/**
 * A scan that fails for a reason other than a queue add, with an error text the user must not see.
 * The scan pipeline is replaced here; `runAddAllMatching.test.ts` covers a failed page read over HTTP.
 */
import type {ReactElement} from "react"

import {afterEach, describe, expect, it, vi} from "vitest"

const {message} = vi.hoisted(() => ({message: {open: vi.fn(), destroy: vi.fn()}}))

vi.mock("@agenta/ui/app-message", () => ({message}))
vi.mock("@agenta/entities/simpleQueue/etl", async (original) => ({
    ...(await original<object>()),
    addAllMatchingTracesToQueue: vi.fn(async () => {
        throw new Error('column "queue_items.trace_id" does not exist')
    }),
}))

import {runAddAllMatching} from "@/features/observability/queueAll/runAddAllMatching"

afterEach(() => vi.restoreAllMocks())

describe("Add all matching to a queue", () => {
    it("A failure shows plain text, not the API error", async () => {
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
        await runAddAllMatching({
            queue: {id: "queue-1", name: "Weekly review"},
            projectId: "project-1",
            appId: "",
            filters: [],
            sort: undefined,
            traceTabs: "trace",
            pageSignal: new AbortController().signal,
        })

        const [args] = message.open.mock.calls.at(-1) ?? []
        expect(args).toMatchObject({type: "error", action: {label: "Retry"}})
        expect((args.content as ReactElement<{title: string; description: string}>).props).toEqual({
            title: "Queue add failed",
            description: "Something went wrong. Try again.",
        })
        expect(logged).toHaveBeenCalled()
    })
})
