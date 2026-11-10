import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {appStateSnapshotAtom, navigationRequestAtom} from "./atoms"
import {useQueryParamState} from "./hooks"
import {createInitialParsedLocation} from "./parse"

/**
 * Closing an evaluator drawer clears `revisionId` with `useQueryParamState`. On the playground the
 * param is not in the URL, and a navigation there rebuilt the URL from the router's query, which
 * dropped `?revisions=` and the `#pgSnapshot` hash that the playground writes itself.
 */
describe("useQueryParamState", () => {
    let root: Root
    let container: HTMLDivElement
    let store: ReturnType<typeof createStore>
    let setRevision: ReturnType<typeof useQueryParamState>[1] = () => undefined

    const Probe = () => {
        setRevision = useQueryParamState("revisionId")[1]
        return null
    }

    const renderWithQuery = (query: Record<string, string>) => {
        store.set(appStateSnapshotAtom, {...createInitialParsedLocation(), query})
        act(() => {
            root.render(
                <Provider store={store}>
                    <Probe />
                </Provider>,
            )
        })
    }

    beforeEach(() => {
        ;(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
        store = createStore()
        container = document.createElement("div")
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
    })

    it("clearing a param that is not in the URL does not navigate", () => {
        renderWithQuery({revisions: "rev-1"})

        act(() => setRevision(null, {shallow: true}))

        expect(store.get(navigationRequestAtom)).toBeNull()
    })

    it("clearing a param that is in the URL removes it", () => {
        renderWithQuery({revisionId: "rev-2"})

        act(() => setRevision(null, {shallow: true}))

        expect(store.get(navigationRequestAtom)).toEqual({
            type: "patch-query",
            patch: {revisionId: undefined},
            shallow: true,
        })
    })
})
