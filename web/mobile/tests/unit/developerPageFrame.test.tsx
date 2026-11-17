// @vitest-environment jsdom
import {act} from "react"

import {
    activeUserIdAtom,
    betaDeveloperModeFlagAtom,
    navSimplifiedOverrideAtom,
} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useDeveloperPageFrame, useDetailHeaderTop} from "@/features/developer/developerPageFrame"
;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const Probe = () => <div data-frame={useDeveloperPageFrame()} data-top={useDetailHeaderTop()} />

const render = (beta: boolean) => {
    const store = createStore()
    store.set(activeUserIdAtom, "u1")
    store.set(navSimplifiedOverrideAtom, false)
    store.set(betaDeveloperModeFlagAtom, beta)
    const host = document.createElement("div")
    act(() => {
        createRoot(host).render(
            <Provider store={store}>
                <Probe />
            </Provider>,
        )
    })
    return host.firstElementChild as HTMLElement
}

beforeEach(() => {
    vi.stubGlobal("__env", {NEXT_PUBLIC_AGENTA_BETA_DEVELOPER_MODE: "true"})
})
afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
})

describe("developer page frame", () => {
    it("uses the full width and the compact detail header in beta developer mode", () => {
        const el = render(true)
        expect(el.dataset.frame).not.toContain("max-w-")
        expect(el.dataset.top).toBe("lg:pt-3")
    })

    it("keeps the capped column and the tall header without beta developer mode", () => {
        const el = render(false)
        expect(el.dataset.frame).toContain("max-w-[1248px]")
        expect(el.dataset.top).toBe("lg:pt-14")
    })
})
