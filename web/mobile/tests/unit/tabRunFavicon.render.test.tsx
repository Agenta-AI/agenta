// @vitest-environment jsdom
import {act} from "react"

import type {SessionRunStatus} from "@agenta/chat/model"
import {setSessionStatusAtom} from "@agenta/chat/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import type {TabRunBadge} from "@/features/app/tabRunBadge"
import {TabRunFavicon} from "@/features/app/TabRunFavicon"

const shown: TabRunBadge[] = []
vi.mock("@/features/app/faviconBadge", () => ({
    showTabRunBadge: (badge: TabRunBadge) => shown.push(badge),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let root: Root | undefined
let hidden = false
let store = createStore()

const setHidden = (next: boolean) => {
    hidden = next
    act(() => {
        document.dispatchEvent(new Event("visibilitychange"))
    })
}
const setStatus = (id: string, status: SessionRunStatus) => {
    act(() => store.set(setSessionStatusAtom, {id, status}))
}
const mount = () => {
    root = createRoot(document.createElement("div"))
    act(() =>
        root!.render(
            <Provider store={store}>
                <TabRunFavicon />
            </Provider>,
        ),
    )
}

beforeEach(() => {
    shown.length = 0
    hidden = false
    store = createStore()
    Object.defineProperty(document, "hidden", {configurable: true, get: () => hidden})
})

afterEach(() => {
    if (root) act(() => root!.unmount())
    root = undefined
})

describe("TabRunFavicon", () => {
    it("does no favicon work while the tab stays visible", () => {
        mount()
        setStatus("s1", "running")
        setStatus("s1", "awaiting")
        setStatus("s1", "running")
        setStatus("s1", "idle")
        expect(shown).toEqual([])
    })

    it("badges a hidden run once per change and restores on return", () => {
        mount()
        setStatus("s1", "running")
        setHidden(true)
        setStatus("s1", "running")
        setStatus("s2", "running")
        setStatus("s2", "idle")
        setStatus("s1", "idle")
        setHidden(false)
        expect(shown).toEqual(["running", "completed", null])
    })

    it("restores the icon when it unmounts with a badge up", () => {
        mount()
        setHidden(true)
        setStatus("s1", "awaiting")
        act(() => root!.unmount())
        root = undefined
        setStatus("s1", "idle")
        setHidden(false)
        expect(shown).toEqual(["awaiting", null])
    })
})
