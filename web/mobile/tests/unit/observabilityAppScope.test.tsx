// @vitest-environment jsdom
import {act, StrictMode} from "react"

import {
    observabilityScopeAtom,
    userFiltersAtomFamily,
    type Filter,
    type ObservabilityScope,
} from "@agenta/observability"
import {createStore, Provider, useAtomValue} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {
    useObservabilityAppScope,
    useSelectObservabilityApp,
} from "@/features/observability/observabilityAppScope"

const router = vi.hoisted(() => ({pathname: "/observability", query: {}, replace: vi.fn()}))
vi.mock("next/router", () => ({useRouter: () => router}))
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
    useObservabilityAppScope(enabled ? routeAppId : null)
    // Keyed like the screen's wait: its content mounts only after the view answers, so its
    // queries subscribe to a scope that is already set.
    return <ScopeProbe key={String(enabled)} seen={seen} />
}

/** The toolbar picker: it reads the scope in its own render, as `TracesFilters` does. */
let select: (appId: string | null) => void = () => undefined
const Picker = ({seen}: {seen: ObservabilityScope[]}) => {
    select = useSelectObservabilityApp()
    seen.push(useAtomValue(observabilityScopeAtom))
    return null
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

    it("The scope survives the StrictMode effect replay", () => {
        const seen: ObservabilityScope[] = []
        // StrictMode at the root, as Next renders it: React replays the effects only then.
        act(() =>
            root.render(
                <StrictMode>
                    <Provider store={store}>
                        <Screen routeAppId="app-1" enabled seen={seen} />
                    </Provider>
                </StrictMode>,
            ),
        )

        expect(store.get(observabilityScopeAtom)).toEqual({appId: "app-1", routeAppId: "app-1"})
        expect(seen.every((scope) => scope.appId === "app-1")).toBe(true)
    })

    it("Picking an app scopes the queries without a React update during render", () => {
        const seen: ObservabilityScope[] = []
        const errors = vi.spyOn(console, "error").mockImplementation(() => undefined)
        try {
            const Mounted = ({routeAppId}: {routeAppId: string | null}) => (
                <>
                    <Screen routeAppId={routeAppId} enabled seen={seen} />
                    <Picker seen={seen} />
                </>
            )
            render(<Mounted routeAppId="app-1" />)
            act(() => select("app-2"))
            expect(router.replace).toHaveBeenCalledWith(
                {pathname: "/observability", query: {app: "app-2"}},
                undefined,
                {shallow: true},
            )
            // The URL change arrives after the pick.
            render(<Mounted routeAppId="app-2" />)

            expect(store.get(observabilityScopeAtom)).toEqual({appId: "app-2", routeAppId: "app-2"})
            expect(seen.at(-1)).toEqual({appId: "app-2", routeAppId: "app-2"})
            // React logs "Cannot update a component while rendering a different component" here.
            expect(errors).not.toHaveBeenCalled()
        } finally {
            errors.mockRestore()
        }
    })

    it("Leaving the screen resets the scope", () => {
        const seen: ObservabilityScope[] = []
        render(<Screen routeAppId="app-1" enabled seen={seen} />)
        expect(store.get(observabilityScopeAtom).appId).toBe("app-1")

        render(null)

        expect(store.get(observabilityScopeAtom)).toEqual(PROJECT_WIDE)
    })
})
