// @vitest-environment jsdom
/**
 * The Configuration page edits the agent's latest revision, follows the revision its own
 * auto-save makes, and moves to a version saved elsewhere only when asked (the status's update).
 */
import {act} from "react"

import {atom, createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const handlers = vi.hoisted(() => new Map<string, (from: string, to: string) => void>())
const latest = vi.hoisted(() => ({atom: null as unknown}))

vi.mock("@agenta/playground/state", () => ({
    registerAgentAutoCommitHandler: (key: string, handler: (from: string, to: string) => void) => {
        handlers.set(key, handler)
        return () => handlers.delete(key)
    },
}))
vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const value = atom<string | null>("rev-4")
    latest.atom = value
    const query = atom({isPending: false, isFetching: false, refetch: async () => undefined})
    return {
        workflowLatestRevisionIdAtomFamily: () => value,
        workflowLatestRevisionQueryAtomFamily: () => query,
    }
})

const {useConfigurationRevision} = await import("@/features/agent-pages/useConfigurationRevision")

let seen: {revisionId: string | null; pin: (id: string) => void; failed: boolean}
const Probe = () => {
    seen = useConfigurationRevision("support")
    return null
}

let host: HTMLDivElement
let root: Root
let store: ReturnType<typeof createStore>
beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    store = createStore()
    host = document.createElement("div")
    root = createRoot(host)
    act(() =>
        root.render(
            <Provider store={store}>
                <Probe />
            </Provider>,
        ),
    )
})
afterEach(() => act(() => root.unmount()))

const latestAtom = () => latest.atom as ReturnType<typeof atom<string | null>>

describe("useConfigurationRevision", () => {
    it("starts on the agent's latest revision", () => {
        expect(seen.revisionId).toBe("rev-4")
        expect(seen.failed).toBe(false)
    })

    it("follows its own auto-save, even while the latest query is stale", () => {
        act(() => handlers.get("configuration-page:support")?.("rev-4", "rev-5"))
        expect(seen.revisionId).toBe("rev-5")
        act(() => store.set(latestAtom(), "rev-4"))
        expect(seen.revisionId).toBe("rev-5")
    })

    it("holds its revision when a version is saved elsewhere", () => {
        act(() => store.set(latestAtom(), "rev-6"))
        expect(seen.revisionId).toBe("rev-4")
    })

    it("ignores a save made from another revision", () => {
        act(() => handlers.get("configuration-page:support")?.("rev-2", "rev-9"))
        expect(seen.revisionId).toBe("rev-4")
    })

    it("moves to a newer version when the status asks", () => {
        act(() => seen.pin("rev-7"))
        expect(seen.revisionId).toBe("rev-7")
    })
})
