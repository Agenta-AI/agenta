import {Profiler} from "react"

import {atom, createStore, Provider} from "jotai"
import {createRoot} from "react-dom/client"
import {describe, expect, it, vi} from "vitest"

// Like the real selector: its atom family keys on an object, so each call returns a new atom.
vi.mock("@agenta/playground", () => ({
    executionController: {
        selectors: {
            derivedLoadableId: atom("loadable-1"),
            backendSessionId: () => atom<string | null>(null),
        },
    },
}))
vi.mock("@/oss/components/AgentChatSlice/components/Inspector/InspectorDrawer", () => ({
    InspectorDrawer: () => null,
}))

import PanelSessionInspectorButton from "./PanelSessionInspectorButton"

/**
 * Each compare column renders this button. It read an atom that the playground selector built
 * anew on each render, so `useAtomValue` subscribed, rendered again, and logged
 * "Maximum update depth exceeded" 100 to 400 times per load in /w compare mode.
 */
describe("PanelSessionInspectorButton", () => {
    it("renders a compare column without an update loop", async () => {
        let commits = 0
        const root = createRoot(document.createElement("div"))

        root.render(
            <Provider store={createStore()}>
                <Profiler id="column" onRender={() => (commits += 1)}>
                    <PanelSessionInspectorButton entityId="revision-1" />
                </Profiler>
            </Provider>,
        )
        await new Promise((resolve) => setTimeout(resolve, 300))
        root.unmount()

        expect(commits).toBeGreaterThan(0)
        expect(commits).toBeLessThan(5)
    })
})
