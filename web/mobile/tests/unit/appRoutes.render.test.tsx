// @vitest-environment jsdom
import {act} from "react"

import {activeUserIdAtom} from "@agenta/shared/state"
import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {developerViewPreviewAtomFamily} from "@/features/developer/developerViewAccess"
import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {appPageTarget} from "@/features/developer/useAppPageRedirect"

const {betaAtom} = vi.hoisted(() => ({betaAtom: {current: null as PrimitiveAtom<boolean> | null}}))

vi.mock("@agenta/shared/state", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    const {atom} = await import("jotai")
    betaAtom.current = atom(false)
    return {...original, betaDeveloperModeActiveAtom: betaAtom.current}
})
vi.mock("@/components/PageNotFound", () => ({PageNotFound: () => <p>not found</p>}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const P = "/w/ws-1/p/proj-1"

describe("a project page with ?app= in beta developer mode", () => {
    it("moves to the app's own page and keeps the other parameters", () => {
        expect(appPageTarget(`${P}/variants?app=a1&tab=deployments`, "variants", true)).toBe(
            `${P}/apps/a1/variants?tab=deployments`,
        )
        expect(appPageTarget(`${P}/endpoints?app=a1`, "endpoints", true)).toBe(
            `${P}/apps/a1/endpoints`,
        )
    })

    it("stays without an app", () => {
        expect(appPageTarget(`${P}/variants`, "variants", true)).toBeNull()
    })

    it("stays without beta developer mode", () => {
        expect(appPageTarget(`${P}/variants?app=a1`, "variants", false)).toBeNull()
        expect(appPageTarget(`${P}/endpoints?app=a1`, "endpoints", false)).toBeNull()
    })
})

describe("the app routes", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    const render = (beta: boolean) => {
        store.set(betaAtom.current!, beta)
        act(() =>
            root.render(
                <Provider store={store}>
                    <DeveloperViewGate viewId="variants" betaOnly>
                        <p>registry</p>
                    </DeveloperViewGate>
                </Provider>,
            ),
        )
        return host.textContent
    }

    beforeEach(() => {
        host = document.createElement("div")
        root = createRoot(host)
        store = createStore()
        store.set(activeUserIdAtom, "u1")
    })
    afterEach(() => act(() => root.unmount()))

    it("open in beta developer mode", () => {
        expect(render(true)).toBe("registry")
    })

    it("are not found without beta developer mode, even with the view on", () => {
        store.set(developerViewPreviewAtomFamily("variants"), true)
        expect(render(false)).toBe("not found")
    })
})
