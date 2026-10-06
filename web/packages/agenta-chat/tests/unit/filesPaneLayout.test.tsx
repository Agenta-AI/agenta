import {act} from "react"
import {createRoot} from "react-dom/client"

import {Provider, createStore} from "jotai"
import {afterEach, describe, expect, it} from "vitest"

import {useFilesPaneLayout} from "../../src/state/filesPaneLayout"
import {
    chatPanelMaximizedAtom,
    configPanelCollapsedAtom,
    configPanelCollapsedPhonePreferenceAtom,
    configPanelCollapsedPreferenceAtom,
    filesPaneWidthAtom,
    playgroundLayoutActionAtom,
    rightPanelWidthAtom,
} from "../../src/state/panelLayout"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let cleanup: (() => void) | undefined
afterEach(() => cleanup?.())

function setup() {
    const store = createStore()
    const mount = document.createElement("div")
    const root = createRoot(mount)
    let layout: ReturnType<typeof useFilesPaneLayout> | undefined
    function Host({session, open}: {session: string; open: boolean}) {
        layout = useFilesPaneLayout("w:scope", session, open)
        return null
    }
    const render = (session = "session-1", open = true) =>
        act(() =>
            root.render(
                <Provider store={store}>
                    <Host session={session} open={open} />
                </Provider>,
            ),
        )
    render()
    cleanup = () => act(() => root.unmount())
    return {
        store,
        render,
        expanded: () => layout!.expanded,
        toggle: () => act(() => layout!.toggleExpand()),
    }
}

describe("useFilesPaneLayout", () => {
    it("flips the expansion on each toggle", () => {
        const host = setup()
        host.toggle()
        expect(host.expanded()).toBe(true)
        host.toggle()
        expect(host.expanded()).toBe(false)
    })

    it("writes no width or collapse preference while expanding and restoring", () => {
        const host = setup()
        host.store.set(configPanelCollapsedPreferenceAtom, false)
        host.store.set(configPanelCollapsedPhonePreferenceAtom, true)
        host.store.set(rightPanelWidthAtom, 460)
        host.store.set(filesPaneWidthAtom, 620)
        const action = host.store.get(playgroundLayoutActionAtom)
        host.toggle()
        host.toggle()
        expect(host.store.get(playgroundLayoutActionAtom)).toBe(action)
        expect(host.store.get(configPanelCollapsedPreferenceAtom)).toBe(false)
        expect(host.store.get(configPanelCollapsedPhonePreferenceAtom)).toBe(true)
        expect(host.store.get(rightPanelWidthAtom)).toBe(460)
        expect(host.store.get(filesPaneWidthAtom)).toBe(620)
    })

    it("ends when the pane closes", () => {
        const host = setup()
        host.toggle()
        host.render("session-1", false)
        host.render("session-1", true)
        expect(host.expanded()).toBe(false)
    })

    it("ends when the session changes", () => {
        const host = setup()
        host.toggle()
        host.render("session-2")
        expect(host.expanded()).toBe(false)
    })

    it("ends on a config collapse write", () => {
        const host = setup()
        host.toggle()
        act(() => host.store.set(configPanelCollapsedAtom, true))
        expect(host.expanded()).toBe(false)
    })

    it("ends on a maximize write", () => {
        const host = setup()
        host.toggle()
        act(() => host.store.set(chatPanelMaximizedAtom, true))
        expect(host.expanded()).toBe(false)
    })

    it("does not expand a closed pane", () => {
        const host = setup()
        host.render("session-1", false)
        host.toggle()
        expect(host.expanded()).toBe(false)
    })
})
