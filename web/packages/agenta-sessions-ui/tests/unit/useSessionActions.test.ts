/**
 * The session verbs follow who owns the session (S4): the owner gets every verb plus Share,
 * someone else on an owned session gets Open, Pin and Copy share link only, and an ownerless
 * session (channel, API key, trigger) keeps today's verbs without Share.
 */
import {act, createElement} from "react"
import {createRoot, type Root} from "react-dom/client"

import {atom} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

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
vi.mock("@tanstack/react-query", () => ({
    useQueryClient: () => ({invalidateQueries: vi.fn(), setQueriesData: vi.fn()}),
}))

import {sessionMenuAccess, useSessionActions} from "../../src/useSessionActions"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const ME = "user-alice"
const onShare = vi.fn()

const readActions = () => {
    let actions: ReturnType<typeof useSessionActions> | null = null
    const Probe = () => {
        actions = useSessionActions({
            sharePathFor: () => "/s/session-1",
            currentUserId: ME,
            onShare,
        })
        return null
    }
    act(() => root.render(createElement(Probe)))
    if (!actions) throw new Error("hook did not run")
    return actions as ReturnType<typeof useSessionActions>
}

const keysOf = (ownerUserId: string | null | undefined) => {
    const actions = readActions()
    return actions
        .menuItems(
            {sessionId: "session-1", appId: "agent-1", name: "Chat", ownerUserId},
            {onOpen: () => undefined},
        )
        .map((entry) => ("key" in entry ? entry.key : "divider"))
}

describe("session verbs by owner", () => {
    it("owner gets share, rename, archive, delete", () => {
        expect(keysOf(ME)).toEqual([
            "open",
            "rename",
            "pin",
            "share",
            "copy-link",
            "divider",
            "archive",
            "delete",
        ])
    })

    it("participant gets no share, rename, archive or delete on an owned session", () => {
        expect(keysOf("user-bob")).toEqual(["open", "pin", "copy-link"])
    })

    it("ownerless session keeps today's verbs", () => {
        const today = ["open", "rename", "pin", "copy-link", "divider", "archive", "delete"]
        expect(keysOf(null)).toEqual(today)
        // A host that does not know the owner keeps them too.
        expect(keysOf(undefined)).toEqual(today)
    })

    it("the share key opens the host's dialog", () => {
        const actions = readActions()
        const target = {sessionId: "session-1", appId: "agent-1", ownerUserId: ME}
        act(() => actions.onMenuClick(target)({key: "share"}))
        expect(onShare).toHaveBeenCalledWith(target)
    })

    it("tells the owner from everyone else", () => {
        expect(sessionMenuAccess({ownerUserId: ME}, ME)).toBe("owner")
        expect(sessionMenuAccess({ownerUserId: ME}, "user-bob")).toBe("member")
        expect(sessionMenuAccess({ownerUserId: ME}, null)).toBe("member")
        expect(sessionMenuAccess({ownerUserId: null}, ME)).toBe("ownerless")
    })
})
