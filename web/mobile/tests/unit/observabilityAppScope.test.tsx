// @vitest-environment jsdom
import {act} from "react"

import {
    observabilityScopeAtom,
    userFiltersAtomFamily,
    type Filter,
    type ObservabilityScope,
} from "@agenta/observability"
import {createStore, Provider, useAtomValue} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {useObservabilityAppScope} from "@/features/observability/observabilityAppScope"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const PROJECT_WIDE: ObservabilityScope = {appId: null, routeAppId: null}

/** Reads the scope the way a query does: during its own render, after the parent's render. */
const ScopeProbe = ({seen}: {seen: ObservabilityScope[]}) => {
    seen.push(useAtomValue(observabilityScopeAtom))
    return null
}

const Screen = ({
    routeAppId,
    enabled,
    seen,
}: {
    routeAppId: string | null
    enabled: boolean
    seen: ObservabilityScope[]
}) => {
    useObservabilityAppScope(routeAppId, enabled)
    // Keyed like the screen's wait: its content mounts only after the view answers, so its
    // queries subscribe to a scope that is already set.
    return <ScopeProbe key={String(enabled)} seen={seen} />
}

describe("useObservabilityAppScope", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>

    const render = (node: React.ReactNode) =>
        act(() => root.render(<Provider store={store}>{node}</Provider>))

    beforeEach(() => {
        localStorage.clear()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        store = createStore()
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("Scope is project wide when the view is disabled even with an app in the URL", () => {
        const seen: ObservabilityScope[] = []
        render(<Screen routeAppId="app-1" enabled={false} seen={seen} />)

        expect(seen.every((scope) => scope.appId === null && scope.routeAppId === null)).toBe(true)
        expect(store.get(observabilityScopeAtom)).toEqual(PROJECT_WIDE)
    })

    it("An app in the URL scopes the very first traces query", () => {
        const seen: ObservabilityScope[] = []
        render(<Screen routeAppId="app-1" enabled seen={seen} />)

        expect(seen[0]).toEqual({appId: "app-1", routeAppId: "app-1"})
    })

    it("The scope is ready on the first render after the view turns on", () => {
        const seen: ObservabilityScope[] = []
        render(<Screen routeAppId="app-1" enabled={false} seen={seen} />)
        seen.length = 0
        render(<Screen routeAppId="app-1" enabled seen={seen} />)

        expect(seen[0]).toEqual({appId: "app-1", routeAppId: "app-1"})
    })

    it("Choosing All apps returns the scope to project wide", () => {
        const seen: ObservabilityScope[] = []
        render(<Screen routeAppId="app-1" enabled seen={seen} />)
        render(<Screen routeAppId={null} enabled seen={seen} />)

        expect(store.get(observabilityScopeAtom)).toEqual(PROJECT_WIDE)
    })

    it("Saved user filters switch with the chosen app", () => {
        const filter: Filter = {field: "name", operator: "contains", value: "checkout"}
        const seen: ObservabilityScope[] = []

        render(<Screen routeAppId="app-1" enabled seen={seen} />)
        act(() => store.set(userFiltersAtomFamily("traces"), [filter]))
        expect(store.get(userFiltersAtomFamily("traces"))).toEqual([filter])

        render(<Screen routeAppId="app-2" enabled seen={seen} />)
        expect(store.get(userFiltersAtomFamily("traces"))).toEqual([])

        render(<Screen routeAppId="app-1" enabled seen={seen} />)
        expect(store.get(userFiltersAtomFamily("traces"))).toEqual([filter])
    })

    it("Leaving the screen resets the scope", () => {
        const seen: ObservabilityScope[] = []
        render(<Screen routeAppId="app-1" enabled seen={seen} />)
        expect(store.get(observabilityScopeAtom).appId).toBe("app-1")

        render(null)

        expect(store.get(observabilityScopeAtom)).toEqual(PROJECT_WIDE)
    })
})
