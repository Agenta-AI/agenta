/**
 * The "Rename" menu entry, end to end through the shared layer.
 *
 * The entry shipped on every session surface but `onMenuClick` had no branch for its key, so on
 * the chat tab strip and the card lists it did nothing at all. These lock both halves of the fix:
 * the key reaches the surface, and the surface keeps the caret it just claimed.
 */
import {act, createElement, type ReactNode} from "react"
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
}))
vi.mock("@agenta/shared/state", () => ({projectIdAtom: atom("project-1")}))
vi.mock("@agenta/ui/app-message", () => ({
    message: {error: vi.fn(), success: vi.fn()},
    modal: {confirm: vi.fn()},
}))
vi.mock("@agenta/ui/utils", () => ({copyToClipboard: vi.fn(async () => true)}))
vi.mock("@tanstack/react-query", () => ({
    useQueryClient: () => ({
        invalidateQueries: vi.fn(),
        setQueriesData: vi.fn(),
    }),
}))

/** Radix portals nothing jsdom can lay out, so the primitives are stubbed and the content
 * element's `onCloseAutoFocus` is captured — that handler IS the focus contract under test. */
const menuStub = vi.hoisted(() => ({
    onCloseAutoFocus: undefined as ((event: Event) => void) | undefined,
}))
vi.mock("@agenta/ui/ui", async () => {
    const {createElement} = await import("react")
    return {
        ContextMenu: ({children}: {children: ReactNode}) => children,
        ContextMenuTrigger: ({children}: {children: ReactNode}) => children,
        ContextMenuContent: ({
            children,
            onCloseAutoFocus,
        }: {
            children: ReactNode
            onCloseAutoFocus?: (event: Event) => void
        }) => {
            menuStub.onCloseAutoFocus = onCloseAutoFocus
            return createElement("div", null, children)
        },
        ContextMenuItem: ({
            children,
            onSelect,
            disabled,
        }: {
            children: ReactNode
            onSelect?: () => void
            disabled?: boolean
        }) => createElement("button", {disabled, onClick: onSelect}, children),
        ContextMenuSeparator: () => createElement("hr"),
    }
})

import {SessionRowContextMenu} from "../../src/SessionRowContextMenu"
import {useSessionActions} from "../../src/useSessionActions"

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

/** Renders the hook once and hands back its return value. */
const readActions = () => {
    let actions: ReturnType<typeof useSessionActions> | null = null
    const Probe = () => {
        actions = useSessionActions({sharePathFor: () => "/s/session-1"})
        return null
    }
    act(() => root.render(createElement(Probe)))
    if (!actions) throw new Error("hook did not run")
    return actions as ReturnType<typeof useSessionActions>
}

describe("onMenuClick", () => {
    it("routes the rename key to the surface that owns the editor", () => {
        const onRename = vi.fn()
        const onOpen = vi.fn()
        const actions = readActions()

        act(() => actions.onMenuClick(target, {onOpen, onRename})({key: "rename"}))

        expect(onRename).toHaveBeenCalledTimes(1)
        expect(onOpen).not.toHaveBeenCalled()
    })

    it("leaves every other key alone", () => {
        const onRename = vi.fn()
        const onOpen = vi.fn()
        const actions = readActions()

        act(() => actions.onMenuClick(target, {onOpen, onRename})({key: "open"}))

        expect(onOpen).toHaveBeenCalledTimes(1)
        expect(onRename).not.toHaveBeenCalled()
    })

    it("does not throw where the surface renames by intercepting the key itself", () => {
        const actions = readActions()

        expect(() => act(() => actions.onMenuClick(target)({key: "rename"}))).not.toThrow()
    })

    it("offers rename on a live session and drops it on an archived one", () => {
        const actions = readActions()
        const keys = (entries: ReturnType<typeof actions.menuItems>) =>
            entries.map((entry) => ("key" in entry ? entry.key : "divider"))

        expect(keys(actions.menuItems(target))).toContain("rename")
        expect(keys(actions.menuItems({...target, archived: true}))).not.toContain("rename")
    })
})

describe("the menu's close handoff", () => {
    const entries = [
        {key: "rename", label: "Rename"},
        {key: "archive", label: "Archive"},
    ]

    /** Clicks one entry, then runs the close handler Radix runs as the menu unmounts. */
    const selectThenClose = (label: string, onSelect: (key: string) => (() => void) | void) => {
        act(() =>
            root.render(
                createElement(
                    SessionRowContextMenu,
                    {entries, onSelect},
                    createElement("div", null, "row"),
                ),
            ),
        )
        const button = Array.from(container.querySelectorAll("button")).find(
            (element) => element.textContent === label,
        )
        act(() => button?.dispatchEvent(new MouseEvent("click", {bubbles: true})))

        const event = new Event("closeAutoFocus", {cancelable: true})
        act(() => menuStub.onCloseAutoFocus?.(event))
        return event.defaultPrevented
    }

    // The editor must not mount while the menu still holds its focus trap: the trap blurs it
    // straight back out, and a blur commits and closes it.
    it("runs deferred work after the menu closes, not during the select", () => {
        const ran: string[] = []
        const restored = selectThenClose("Rename", () => {
            ran.push("select")
            return () => ran.push("close")
        })

        expect(ran).toEqual(["select", "close"])
        expect(restored).toBe(true)
    })

    it("restores focus to the row for a verb that defers nothing", () => {
        expect(selectThenClose("Archive", () => undefined)).toBe(false)
    })

    it("drops the deferred work when a later select supersedes it", () => {
        const deferred = vi.fn()
        act(() =>
            root.render(
                createElement(
                    SessionRowContextMenu,
                    {entries, onSelect: (key: string) => (key === "rename" ? deferred : undefined)},
                    createElement("div", null, "row"),
                ),
            ),
        )
        const click = (label: string) =>
            act(() =>
                Array.from(container.querySelectorAll("button"))
                    .find((element) => element.textContent === label)
                    ?.dispatchEvent(new MouseEvent("click", {bubbles: true})),
            )
        click("Rename")
        click("Archive")
        act(() => menuStub.onCloseAutoFocus?.(new Event("closeAutoFocus", {cancelable: true})))

        expect(deferred).not.toHaveBeenCalled()
    })
})
