import {describe, expect, it, vi} from "vitest"

const retrieve = vi.hoisted(() => vi.fn())
vi.mock("@agenta/entities/workflow", () => ({retrieveWorkflowRevision: retrieve}))
const commits = vi.hoisted(
    () => new Map<string, (from: string, to: string, workflowId?: string) => void>(),
)
vi.mock("../../src/state/execution/agentAutoCommit", () => ({
    registerAgentAutoCommitHandler: (
        key: string,
        handler: (from: string, to: string, workflowId?: string) => void,
    ) => {
        commits.set(key, handler)
        return () => commits.delete(key)
    },
}))
const landCommit = (workflowId: string) =>
    commits.forEach((handler) => handler("rev-a", "rev-b", workflowId))

import {
    requestLatestVersionCheck,
    watchLatestVersion,
} from "../../src/state/execution/latestVersionCheck"

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

/** A window whose focus the test fires, standing in for `window`. */
const fakeWindow = () => {
    const listeners = new Set<() => void>()
    return {
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
        focus: () => listeners.forEach((fn) => fn()),
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
            win: fakeWindow(),
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
            win: fakeWindow(),
        })
        page.become("visible")
        await flush()
        resolveFirst({id: "rev-6", version: "6"})
        await flush()
        expect(onLatest).toHaveBeenCalledOnce()
        expect(onLatest).toHaveBeenCalledWith({workflowId: "agent-1", id: "rev-7", version: 7})
    })

    it("checks again when this tab saves a new version of the same agent", async () => {
        commits.clear()
        retrieve.mockReset().mockResolvedValueOnce({id: "rev-6", version: "6"})
        const page = fakePage("visible")
        const onLatest = vi.fn()
        const stop = watchLatestVersion({
            workflowId: "agent-1",
            projectId: "project-1",
            onLatest,
            page: page as unknown as Document,
            win: fakeWindow(),
        })
        await flush()

        retrieve.mockResolvedValueOnce({id: "rev-7", version: "7"})
        landCommit("agent-2")
        await flush()
        expect(retrieve).toHaveBeenCalledOnce()

        landCommit("agent-1")
        await flush()
        expect(retrieve).toHaveBeenCalledTimes(2)
        expect(onLatest).toHaveBeenLastCalledWith({workflowId: "agent-1", id: "rev-7", version: 7})

        stop()
        landCommit("agent-1")
        expect(retrieve).toHaveBeenCalledTimes(2)
    })

    it("checks again when the window gets focus, and not after it stopped", async () => {
        retrieve.mockReset().mockResolvedValue({id: "rev-6", version: "6"})
        const win = fakeWindow()
        const stop = watchLatestVersion({
            workflowId: "agent-1",
            projectId: "project-1",
            onLatest: vi.fn(),
            page: fakePage("visible") as unknown as Document,
            win,
        })
        await flush()
        expect(retrieve).toHaveBeenCalledOnce()

        win.focus()
        await flush()
        expect(retrieve).toHaveBeenCalledTimes(2)

        stop()
        win.focus()
        expect(retrieve).toHaveBeenCalledTimes(2)
    })

    // Own agent ids: a watcher an earlier test left running would answer a request too.
    it("checks the watchers of one agent when a builder saved a version of it", async () => {
        retrieve.mockReset().mockResolvedValue({id: "rev-5", version: "5"})
        const watch = (workflowId: string, onLatest = vi.fn()) => ({
            onLatest,
            stop: watchLatestVersion({
                workflowId,
                projectId: "project-1",
                onLatest,
                page: fakePage("visible") as unknown as Document,
                win: fakeWindow(),
            }),
        })
        const first = watch("built-1")
        const second = watch("built-1")
        const other = watch("built-2")
        await flush()
        expect(retrieve).toHaveBeenCalledTimes(3)

        retrieve.mockResolvedValue({id: "rev-6", version: "6"})
        requestLatestVersionCheck("built-1")
        await flush()
        expect(retrieve).toHaveBeenCalledTimes(5)
        expect(first.onLatest).toHaveBeenLastCalledWith({
            workflowId: "built-1",
            id: "rev-6",
            version: 6,
        })
        expect(second.onLatest).toHaveBeenLastCalledWith({
            workflowId: "built-1",
            id: "rev-6",
            version: 6,
        })
        expect(other.onLatest).toHaveBeenCalledOnce()

        first.stop()
        second.stop()
        other.stop()
        requestLatestVersionCheck("built-1")
        expect(retrieve).toHaveBeenCalledTimes(5)
    })

    it("does not check a hidden page when a builder saved a version", async () => {
        retrieve.mockReset().mockResolvedValue({id: "rev-5", version: "5"})
        const stop = watchLatestVersion({
            workflowId: "built-1",
            projectId: "project-1",
            onLatest: vi.fn(),
            page: fakePage("hidden") as unknown as Document,
            win: fakeWindow(),
        })
        requestLatestVersionCheck("built-1")
        expect(retrieve).not.toHaveBeenCalled()
        stop()
    })
})
