// @vitest-environment jsdom
/**
 * The Configuration page asks for the agent's latest revision when it opens and holds the answer.
 * It follows its own auto-save, and moves to a version saved elsewhere only when asked (the
 * status's update).
 */
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const handlers = vi.hoisted(() => new Map<string, (from: string, to: string) => void>())
const server = vi.hoisted(() => ({
    next: null as null | (() => Promise<{data: {id: string} | null; isError?: boolean}>),
}))

vi.mock("@agenta/playground/state", () => ({
    registerAgentAutoCommitHandler: (key: string, handler: (from: string, to: string) => void) => {
        handlers.set(key, handler)
        return () => handlers.delete(key)
    },
}))
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    // The cached answer says rev-4; the server's answer comes from `server.next`.
    const query = atom({data: {id: "rev-4"}, refetch: () => server.next!()})
    return {workflowLatestRevisionQueryAtomFamily: () => query}
})

const {useConfigurationRevision} = await import("@/features/agent-pages/useConfigurationRevision")

let seen: {revisionId: string | null; pin: (id: string) => void; failed: boolean}
const Probe = () => {
    seen = useConfigurationRevision("support")
    return null
}

let host: HTMLDivElement
let root: Root
let resolve: (value: {data: {id: string} | null; isError?: boolean}) => void
beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    server.next = () => new Promise((r) => (resolve = r))
    host = document.createElement("div")
    root = createRoot(host)
    act(() =>
        root.render(
            <Provider store={createStore()}>
                <Probe />
            </Provider>,
        ),
    )
})
afterEach(() => act(() => root.unmount()))

const answer = (id: string | null) => act(async () => resolve({data: id ? {id} : null}))

describe("useConfigurationRevision", () => {
    it("waits for the server's answer, not the cached one, then holds it", async () => {
        expect(seen.revisionId).toBeNull()
        await answer("rev-6")
        expect(seen.revisionId).toBe("rev-6")
        expect(seen.failed).toBe(false)
    })

    it("follows its own auto-save", async () => {
        await answer("rev-4")
        act(() => handlers.get("configuration-page:support")?.("rev-4", "rev-5"))
        expect(seen.revisionId).toBe("rev-5")
    })

    it("ignores a save made from another revision", async () => {
        await answer("rev-4")
        act(() => handlers.get("configuration-page:support")?.("rev-2", "rev-9"))
        expect(seen.revisionId).toBe("rev-4")
    })

    it("moves to a newer version only when the status asks", async () => {
        await answer("rev-4")
        act(() => seen.pin("rev-7"))
        expect(seen.revisionId).toBe("rev-7")
    })

    it("does not hold the cached revision when the request fails", async () => {
        await act(async () => resolve({data: {id: "rev-4"}, isError: true}))
        expect(seen.revisionId).toBeNull()
        expect(seen.failed).toBe(true)
    })

    it("fails when the agent has no revision", async () => {
        await answer(null)
        expect(seen.revisionId).toBeNull()
        expect(seen.failed).toBe(true)
    })
})
