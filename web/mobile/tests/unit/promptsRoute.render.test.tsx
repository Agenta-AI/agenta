// @vitest-environment jsdom
import {act} from "react"

import {activeUserIdAtom} from "@agenta/shared/state"
import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import PromptsPage from "../../src/pages/w/[workspace_id]/p/[project_id]/prompts"

vi.mock("next/router", () => ({
    useRouter: () => ({query: {workspace_id: "ws", project_id: "pr"}}),
}))

vi.mock("@/features/prompts/PromptsScreen", () => ({
    PromptsScreen: () => <p data-testid="prompts-screen" />,
}))

vi.mock("@agenta/auth-ui", () => ({
    NotFoundScreen: ({path}: {path?: string}) => <p data-testid="not-found">{path}</p>,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

describe("prompts route", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

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

    it("Prompts route shows not found while the view is hidden", () => {
        act(() =>
            root.render(
                <Provider store={store}>
                    <PromptsPage />
                </Provider>,
            ),
        )
        expect(host.querySelector("[data-testid=not-found]")).not.toBeNull()
        expect(host.querySelector("[data-testid=prompts-screen]")).toBeNull()
    })
})
