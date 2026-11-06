// @vitest-environment jsdom
import {act, type ReactNode} from "react"

import {activeUserIdAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {DeveloperViewGate} from "@/features/developer/DeveloperViewGate"
import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"

vi.mock("next/router", () => ({
    useRouter: () => ({asPath: "/w/ws/p/pr/variants", back: vi.fn()}),
}))

vi.mock("@agenta/auth-ui", () => ({
    NotFoundScreen: ({path}: {path?: string}) => <p data-testid="not-found">{path}</p>,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

describe("variants route", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    const render = (node: ReactNode) =>
        act(() => root.render(<Provider store={store}>{node}</Provider>))

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        store = createStore()
        store.set(activeUserIdAtom, "u1")
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        localStorage.clear()
    })

    it("Variants route shows not found while the view is hidden", () => {
        render(
            <DeveloperViewGate viewId="variants">
                <p data-testid="view">view</p>
            </DeveloperViewGate>,
        )
        expect(document.querySelector("[data-testid=not-found]")).not.toBeNull()
        expect(document.querySelector("[data-testid=view]")).toBeNull()
    })

    it("The Variants entry is in preview and has the registry fields", () => {
        const entry = DEVELOPER_VIEWS.find((view) => view.id === "variants")
        expect(entry).toBeDefined()
        expect(entry?.stage).toBe("preview")
        expect(entry?.routes).toEqual(["/variants"])
    })
})
