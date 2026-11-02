/**
 * `commitRename` on a session the host holds in its local cache.
 *
 * The cache write can fail exactly like the direct header write. The verb used to drop its
 * answer and report success, so the row kept the new name until the next list read put the old
 * one back, and nobody was told (#6695).
 */
import {act, createElement} from "react"

import {atom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const queryClient = vi.hoisted(() => ({
    invalidateQueries: vi.fn(),
    setQueriesData: vi.fn(),
}))

vi.mock("@agenta/entities/session", () => ({
    archiveSessionRemote: vi.fn(async () => true),
    deleteSessionRemote: vi.fn(async () => true),
    setSessionHeader: vi.fn(async () => true),
    unarchiveSessionRemote: vi.fn(async () => true),
}))
vi.mock("@agenta/sessions/link", () => ({shareUrl: (path: string) => path}))
vi.mock("@agenta/sessions/state", () => ({
    pinnedSessionIdsAtom: atom<string[]>([]),
    toggleSessionPinAtom: atom(null, () => undefined),
    unpinSessionAtom: atom(null, () => undefined),
}))
vi.mock("@agenta/shared/state", () => ({projectIdAtom: atom("project-1")}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {error: vi.fn(), success: vi.fn()},
    modal: {confirm: vi.fn()},
}))
vi.mock("@agenta/ui/utils", () => ({copyToClipboard: vi.fn(async () => true)}))
vi.mock("@tanstack/react-query", () => ({useQueryClient: () => queryClient}))

import {useSessionActions, type SessionLocalCache} from "../../src/useSessionActions"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
})

const target = {sessionId: "session-1", appId: "agent-1", name: "Old name", archived: false}

const readActions = (rename: SessionLocalCache["rename"]) => {
    const localCache: SessionLocalCache = {
        has: () => true,
        rename,
        setArchived: vi.fn(),
        remove: vi.fn(),
    }
    let actions: ReturnType<typeof useSessionActions> | null = null
    const Probe = () => {
        actions = useSessionActions({localCache, sharePathFor: () => "/s/session-1"})
        return null
    }
    act(() => root.render(createElement(Probe)))
    if (!actions) throw new Error("hook did not run")
    return actions as ReturnType<typeof useSessionActions>
}

describe("commitRename through the local cache", () => {
    it("reports a cache write that did not land, and leaves the list rows alone", async () => {
        const rename = vi.fn(async () => false)
        const actions = readActions(rename)

        await expect(actions.commitRename(target, "New name")).resolves.toBe(false)
        expect(rename).toHaveBeenCalledWith(target, "New name")
        expect(queryClient.setQueriesData).not.toHaveBeenCalled()
    })

    it("treats a cache write that answers nothing as landed", async () => {
        const actions = readActions(vi.fn(() => undefined))

        await expect(actions.commitRename(target, "New name")).resolves.toBe(true)
        expect(queryClient.setQueriesData).toHaveBeenCalled()
    })

    it("treats a cache write that resolves true as landed", async () => {
        const actions = readActions(vi.fn(async () => true))

        await expect(actions.commitRename(target, "New name")).resolves.toBe(true)
    })
})
