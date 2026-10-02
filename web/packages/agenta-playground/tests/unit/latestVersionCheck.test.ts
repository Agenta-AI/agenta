import {describe, expect, it, vi} from "vitest"

const retrieve = vi.hoisted(() => vi.fn())
vi.mock("@agenta/entities/workflow", () => ({retrieveWorkflowRevision: retrieve}))

import {watchLatestVersion} from "../../src/state/execution/latestVersionCheck"

/** A page whose visibility the test flips, standing in for `document`. */
const fakePage = (visibilityState: "visible" | "hidden") => {
    const listeners = new Set<() => void>()
    return {
        visibilityState,
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
        become(state: "visible" | "hidden") {
            this.visibilityState = state
            listeners.forEach((fn) => fn())
        },
    }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("watchLatestVersion", () => {
    it("checks once now and once per return to the page, never while hidden", async () => {
        retrieve.mockReset().mockResolvedValue({id: "rev-6", version: "6"})
        const page = fakePage("hidden")
        const onLatest = vi.fn()
        const stop = watchLatestVersion({
            workflowId: "agent-1",
            projectId: "project-1",
            onLatest,
            page: page as unknown as Document,
        })
        expect(retrieve).not.toHaveBeenCalled()

        page.become("visible")
        await flush()
        expect(retrieve).toHaveBeenCalledOnce()
        expect(retrieve).toHaveBeenCalledWith(
            expect.objectContaining({projectId: "project-1", workflowRef: {id: "agent-1"}}),
        )
        expect(onLatest).toHaveBeenCalledWith({workflowId: "agent-1", id: "rev-6", version: 6})

        page.become("hidden")
        expect(retrieve).toHaveBeenCalledOnce()

        stop()
        page.become("visible")
        expect(retrieve).toHaveBeenCalledOnce()
    })

    it("drops an older check that lands after a newer one", async () => {
        let resolveFirst!: (value: unknown) => void
        retrieve
            .mockReset()
            .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
            .mockResolvedValueOnce({id: "rev-7", version: "7"})
        const page = fakePage("visible")
        const onLatest = vi.fn()
        watchLatestVersion({
            workflowId: "agent-1",
            projectId: "project-1",
            onLatest,
            page: page as unknown as Document,
        })
        page.become("visible")
        await flush()
        resolveFirst({id: "rev-6", version: "6"})
        await flush()
        expect(onLatest).toHaveBeenCalledOnce()
        expect(onLatest).toHaveBeenCalledWith({workflowId: "agent-1", id: "rev-7", version: 7})
    })
})
