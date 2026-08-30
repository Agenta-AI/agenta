// @vitest-environment jsdom
/**
 * Unit tests for the session shortcuts. The hook takes every action as a callback and knows
 * nothing about its host, so these drive it directly with spies.
 *
 * The bindings are matched on `event.code`, not `event.key`: macOS reports Option+1 as `¡` and
 * Option+R as `®`. The negative cases matter as much as the positive ones — Ctrl+Alt is AltGr on
 * European layouts (typing `³`, `€`), so a match there would eat characters in the composer.
 */
import {act, createElement} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, describe, expect, it, vi} from "vitest"

import {
    useSessionShortcuts,
    type UseSessionShortcutsParams,
} from "../../src/shortcuts/useSessionShortcuts"

const sessions = [{id: "s1"}, {id: "s2"}, {id: "s3"}]

let root: Root | null = null
let host: HTMLDivElement | null = null

;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

/** Mount a probe that does nothing but run the hook. */
const setup = (overrides: Partial<UseSessionShortcutsParams> = {}) => {
    const handlers = {
        onJump: vi.fn(),
        onRename: vi.fn(),
        onArchive: vi.fn(),
        onNewSession: vi.fn(),
        onCloseSession: vi.fn(),
        onSearch: vi.fn(),
        onToggleConfigPanel: vi.fn(),
        onToggleFilesPane: vi.fn(),
    }
    const Probe = () => {
        useSessionShortcuts({sessions, activeId: "s2", ...handlers, ...overrides})
        return null
    }
    host = document.createElement("div")
    document.body.append(host)
    root = createRoot(host)
    act(() => {
        root?.render(createElement(Probe))
    })
    return handlers
}

const press = (code: string, init: KeyboardEventInit = {}) =>
    document.dispatchEvent(
        new KeyboardEvent("keydown", {
            code,
            altKey: true,
            bubbles: true,
            cancelable: true,
            ...init,
        }),
    )

afterEach(() => {
    act(() => root?.unmount())
    root = null
    host = null
    document.body.innerHTML = ""
})

describe("useSessionShortcuts", () => {
    it("jumps to the session at the pressed position", () => {
        const {onJump} = setup()
        press("Digit3")
        expect(onJump).toHaveBeenCalledWith("s3")
    })

    it("ignores a position past the last open session", () => {
        const {onJump} = setup()
        press("Digit4")
        expect(onJump).not.toHaveBeenCalled()
    })

    it("steps to the previous and next session", () => {
        const {onJump} = setup()
        press("KeyX")
        expect(onJump).toHaveBeenLastCalledWith("s3")
        press("KeyZ")
        expect(onJump).toHaveBeenLastCalledWith("s1")
    })

    it("wraps forward from the last session to the first", () => {
        const {onJump} = setup({activeId: "s3"})
        press("KeyX")
        expect(onJump).toHaveBeenCalledWith("s1")
    })

    it("wraps backward from the first session to the last", () => {
        const {onJump} = setup({activeId: "s1"})
        press("KeyZ")
        expect(onJump).toHaveBeenCalledWith("s3")
    })

    it("steps from the head when the active id is stale", () => {
        const {onJump} = setup({activeId: "closed-tab"})
        press("KeyX")
        expect(onJump).toHaveBeenCalledWith("s2")
    })

    it("steps to the only session when there is just one", () => {
        const {onJump} = setup({sessions: [{id: "solo"}], activeId: "solo"})
        press("KeyX")
        expect(onJump).toHaveBeenCalledWith("solo")
    })

    it("does not step when no sessions are open", () => {
        const {onJump} = setup({sessions: [], activeId: undefined})
        press("KeyX")
        press("KeyZ")
        expect(onJump).not.toHaveBeenCalled()
    })

    it("opens, closes, searches and toggles both side panels", () => {
        const {onNewSession, onCloseSession, onSearch, onToggleConfigPanel, onToggleFilesPane} =
            setup()
        press("KeyN")
        press("KeyW")
        press("KeyK")
        press("KeyC")
        press("KeyO")
        expect(onNewSession).toHaveBeenCalled()
        expect(onCloseSession).toHaveBeenCalledWith("s2")
        expect(onSearch).toHaveBeenCalled()
        expect(onToggleConfigPanel).toHaveBeenCalled()
        expect(onToggleFilesPane).toHaveBeenCalled()
    })

    // The letters that browsers claim: Chrome/Edge open their menu on Alt+F, Firefox opens a menu
    // on Alt+F/E/V/S/B/T/H, and both focus the address bar on Alt+D. None may be bound here.
    it("binds no letter a browser menu already claims", () => {
        const handlers = setup()
        for (const code of ["KeyF", "KeyE", "KeyV", "KeyS", "KeyB", "KeyT", "KeyH", "KeyD"]) {
            press(code)
        }
        for (const handler of Object.values(handlers)) {
            expect(handler).not.toHaveBeenCalled()
        }
    })

    // The pane is per-session and the panel renders none without one, so the key must not flip a
    // state nothing shows.
    it("refuses to toggle the files pane with no active session", () => {
        const {onToggleFilesPane} = setup({sessions: [], activeId: undefined})
        press("KeyO")
        expect(onToggleFilesPane).not.toHaveBeenCalled()
    })

    it("refuses to close the last remaining session", () => {
        const {onCloseSession} = setup({sessions: [{id: "solo"}], activeId: "solo"})
        press("KeyW")
        expect(onCloseSession).not.toHaveBeenCalled()
    })

    it("renames and archives the active session", () => {
        const {onRename, onArchive} = setup()
        press("KeyR")
        press("KeyA")
        expect(onRename).toHaveBeenCalledWith("s2")
        expect(onArchive).toHaveBeenCalledWith("s2")
    })

    it("skips the active-session verbs when no session is active", () => {
        const {onRename, onArchive} = setup({activeId: undefined})
        press("KeyR")
        press("KeyA")
        expect(onRename).not.toHaveBeenCalled()
        expect(onArchive).not.toHaveBeenCalled()
    })

    it("does nothing while disabled", () => {
        const {onJump} = setup({enabled: false})
        press("Digit1")
        expect(onJump).not.toHaveBeenCalled()
    })

    it("ignores AltGr (Ctrl+Alt), Alt+Shift and Alt+Cmd", () => {
        const {onJump} = setup()
        press("Digit1", {ctrlKey: true})
        press("Digit1", {shiftKey: true})
        press("Digit1", {metaKey: true})
        expect(onJump).not.toHaveBeenCalled()
    })

    it("ignores held-down repeats", () => {
        const {onJump} = setup()
        press("Digit1", {repeat: true})
        expect(onJump).not.toHaveBeenCalled()
    })

    it("still fires while a text field has focus", () => {
        const {onJump} = setup()
        const input = document.createElement("input")
        document.body.append(input)
        input.focus()
        input.dispatchEvent(
            new KeyboardEvent("keydown", {code: "Digit1", altKey: true, bubbles: true}),
        )
        expect(onJump).toHaveBeenCalledWith("s1")
    })

    it("stays quiet while a modal is open", () => {
        const {onJump, onArchive} = setup()
        const modal = document.createElement("div")
        modal.className = "ant-modal-wrap"
        document.body.append(modal)
        press("Digit1")
        press("KeyA")
        expect(onJump).not.toHaveBeenCalled()
        expect(onArchive).not.toHaveBeenCalled()
    })

    it("prevents the default only on a match", () => {
        setup()
        const matched = new KeyboardEvent("keydown", {
            code: "Digit1",
            altKey: true,
            cancelable: true,
        })
        const unmatched = new KeyboardEvent("keydown", {
            code: "KeyQ",
            altKey: true,
            cancelable: true,
        })
        document.dispatchEvent(matched)
        document.dispatchEvent(unmatched)
        expect(matched.defaultPrevented).toBe(true)
        expect(unmatched.defaultPrevented).toBe(false)
    })
})
