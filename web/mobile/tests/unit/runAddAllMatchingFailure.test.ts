// @vitest-environment jsdom
/**
 * A scan that fails for a reason other than a queue add. The HTTP layer cannot produce this (the
 * trace page read returns an empty page on an error), so the scan pipeline is replaced here.
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
        let current: AbortController | null = null

        await runAddAllMatching({
            queue: {id: "queue-1", name: "Weekly review"},
            projectId: "project-1",
            appId: "",
            query: {
                params: {focus: "trace"},
                hasAnnotationConditions: [],
                hasAnnotationOperator: undefined,
                isHasAnnotationSelected: -1,
            },
            run: {
                begin: () => (current = new AbortController()),
                owns: (controller) => controller === current,
            },
        })

        const [args] = message.open.mock.calls.at(-1) ?? []
        expect(args).toMatchObject({type: "error", action: {label: "Retry"}})
        expect(
            (args.content as ReactElement<{title: string; description: string}>).props,
        ).toEqual({title: "Queue add failed", description: "Something went wrong. Try again."})
        expect(logged).toHaveBeenCalled()
    })
})
