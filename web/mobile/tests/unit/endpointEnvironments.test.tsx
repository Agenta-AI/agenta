// @vitest-environment jsdom
import {act} from "react"

import {atom, createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {useEndpointEnvironments} from "@/features/endpoints/useEndpointEnvironments"

interface Env {
    slug: string
    name: string
    deployedVariantId: string | null
    deployedRevisionId: string | null
}

interface Query {
    data: Env[]
    isPending: boolean
    isError: boolean
    refetch: () => void
}

const queries = vi.hoisted(() => ({byApp: new Map<string, unknown>()}))

vi.mock("@agenta/entities/environment", async () => {
    const {atom: makeAtom} = await import("jotai")
    return {
        appEnvironmentsLoadableAtomFamily: (appId: string) => {
            const key = appId
            if (!queries.byApp.has(key)) queries.byApp.set(key, makeAtom({} as unknown))
            return queries.byApp.get(key)
        },
    }
})
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const env = (name: string, slug = name, deployed = true): Env => ({
    name,
    slug,
    deployedVariantId: deployed ? `${name}-v` : null,
    deployedRevisionId: deployed ? `${name}-r` : null,
})

const settled = (data: Env[]): Query => ({data, isPending: false, isError: false, refetch: vi.fn()})

describe("useEndpointEnvironments", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>
    let latest: ReturnType<typeof useEndpointEnvironments>

    const setQuery = (appId: string, query: Query) => {
        const a = queries.byApp.get(appId) as ReturnType<typeof atom<unknown>> | undefined
        if (!a) throw new Error("hook has not read the app yet")
        act(() => store.set(a as never, query as never))
    }

    const Probe = ({appId}: {appId: string}) => {
        latest = useEndpointEnvironments(appId)
        return null
    }
    const render = (appId: string) =>
        act(() =>
            root.render(
                <Provider store={store}>
                    <Probe appId={appId} />
                </Provider>,
            ),
        )

    beforeEach(() => {
        queries.byApp.clear()
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        store = createStore()
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("Environments still loading report pending, not an empty selection", () => {
        render("a1")
        setQuery("a1", {data: [], isPending: true, isError: false, refetch: vi.fn()})
        expect(latest.isPending).toBe(true)
        expect(latest.selected).toBeNull()
    })

    it("Default selection is production when it exists", () => {
        render("a1")
        // The package returns development, staging, production; the page shows them reversed.
        setQuery("a1", settled([env("development"), env("staging"), env("production")]))
        expect(latest.selected?.name).toBe("production")
        expect(latest.environments.map((item) => item.name)).toEqual([
            "production",
            "staging",
            "development",
        ])
    })

    it("Default selection falls back to the first environment", () => {
        render("a1")
        setQuery("a1", settled([env("alpha"), env("beta")]))
        expect(latest.selected?.name).toBe("alpha")
    })

    it("A refetch keeps the environment the user selected", () => {
        render("a1")
        setQuery("a1", settled([env("development"), env("staging"), env("production")]))
        act(() => latest.select("staging"))
        expect(latest.selected?.name).toBe("staging")
        setQuery("a1", settled([env("development"), env("staging"), env("production")]))
        expect(latest.selected?.name).toBe("staging")
    })

    it("Changing the app resets the selection to that app's default", () => {
        render("a1")
        setQuery("a1", settled([env("staging"), env("production")]))
        act(() => latest.select("staging"))
        render("a2")
        setQuery("a2", settled([env("staging"), env("production")]))
        expect(latest.selected?.name).toBe("production")
    })

    it("An environment without a deployment cannot be selected", () => {
        render("a1")
        setQuery("a1", settled([env("staging", "staging", false), env("production")]))
        act(() => latest.select("staging"))
        expect(latest.selected?.name).toBe("production")
    })

    it("Reports an error and offers a refetch", () => {
        render("a1")
        const refetch = vi.fn()
        setQuery("a1", {data: [], isPending: false, isError: true, refetch})
        expect(latest.isError).toBe(true)
        latest.refetch()
        expect(refetch).toHaveBeenCalled()
    })
})
