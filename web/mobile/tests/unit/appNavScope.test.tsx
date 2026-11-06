// @vitest-environment jsdom
import {act} from "react"

import {createStore, Provider, type PrimitiveAtom} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"
import {appNavItems} from "@/features/nav/appNavScope"
import {appScopeAppId} from "@/features/nav/appRoute"
import {appSwitchHref} from "@/features/nav/AppSwitcher"
import {useRailScope} from "@/features/nav/railScope"

const {betaAtom, route} = vi.hoisted(() => ({
    betaAtom: {current: null as PrimitiveAtom<boolean> | null},
    route: {pathname: "", query: {} as Record<string, string>, asPath: ""},
}))

vi.mock("@agenta/shared/state", async (importOriginal) => {
    const original = await importOriginal<Record<string, unknown>>()
    const {atom} = await import("jotai")
    betaAtom.current = atom(false)
    return {...original, betaDeveloperModeActiveAtom: betaAtom.current}
})
vi.mock("next/router", () => ({useRouter: () => route}))
// The two scopes' own hooks are not what this checks: which scope a page gets is.
vi.mock("@/features/nav/mobileNavScope", () => ({
    useMobileNavScope: () => ({id: "mobile-main"}),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const P = "/w/ws-1/p/proj-1"
const R = "/w/[workspace_id]/p/[project_id]"

describe("the pages that show the app menu", () => {
    it("are the app's own pages, and Registry and Endpoints with an app picked", () => {
        expect(appScopeAppId(`${R}/apps/[app_id]/overview`, {app_id: "a1"})).toBe("a1")
        expect(appScopeAppId(`${R}/apps/[app_id]/playground`, {app_id: "a1"})).toBe("a1")
        expect(appScopeAppId(`${R}/variants`, {app: "a1"})).toBe("a1")
        expect(appScopeAppId(`${R}/endpoints`, {app: "a1"})).toBe("a1")
    })

    it("are not the project pages", () => {
        expect(appScopeAppId(`${R}/apps`, {})).toBeNull()
        expect(appScopeAppId(`${R}/apps/archived`, {})).toBeNull()
        expect(appScopeAppId(`${R}/variants`, {})).toBeNull()
        expect(appScopeAppId(`${R}/evaluations`, {app: "a1"})).toBeNull()
        expect(appScopeAppId(`${R}/observability`, {app: "a1"})).toBeNull()
    })
})

describe("the app menu", () => {
    it("lists Overview, Playground, Registry, Evaluations and Observability, like /w", () => {
        const items = appNavItems(P, "a1", DEVELOPER_VIEWS)
        expect(items.map(({title, link, prefetch}) => ({title, link, prefetch}))).toEqual([
            {title: "Overview", link: `${P}/apps/a1/overview`, prefetch: false},
            {title: "Playground", link: `${P}/apps/a1/playground`, prefetch: false},
            {title: "Registry", link: `${P}/variants?app=a1`, prefetch: false},
            {title: "Evaluations", link: `${P}/evaluations?app=a1`, prefetch: false},
            {title: "Observability", link: `${P}/observability?app=a1`, prefetch: false},
        ])
        // No Home row: inside an app, nothing on the project rail lights up.
        expect(items.some(({title}) => title === "Home")).toBe(false)
    })

    it("keeps Registry selected while its URL carries a revision", () => {
        const registry = appNavItems(P, "a1", DEVELOPER_VIEWS).find((i) => i.title === "Registry")
        expect(registry?.matchLinks).toEqual([`${P}/variants`])
    })
})

describe("switching apps", () => {
    it("keeps the page the reader is on", () => {
        expect(appSwitchHref(P, `${R}/apps/[app_id]/overview`, {app_id: "a1"}, "a2")).toBe(
            `${P}/apps/a2/overview`,
        )
        expect(appSwitchHref(P, `${R}/apps/[app_id]/playground`, {app_id: "a1"}, "a2")).toBe(
            `${P}/apps/a2/playground`,
        )
        expect(
            appSwitchHref(
                P,
                `${R}/variants`,
                {app: "a1", tab: "deployments", revision: "r1"},
                "a2",
            ),
        ).toBe(`${P}/variants?app=a2&tab=deployments`)
        expect(appSwitchHref(P, `${R}/endpoints`, {app: "a1"}, "a2")).toBe(`${P}/endpoints?app=a2`)
    })
})

describe("an app id with reserved characters", () => {
    it("stays one path segment in the switch link and the menu links", () => {
        expect(appSwitchHref(P, `${R}/apps/[app_id]/overview`, {app_id: "a1"}, "a/b?c#d")).toBe(
            `${P}/apps/a%2Fb%3Fc%23d/overview`,
        )
        expect(appNavItems(P, "a/b", DEVELOPER_VIEWS)[0].link).toBe(`${P}/apps/a%2Fb/overview`)
    })
})

describe("which rail a page shows", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>
    let scopeId = ""

    const Probe = () => {
        scopeId = useRailScope("ws-1", "proj-1").id
        return null
    }
    // The app menu's code loads on demand, so the scope can change after the first render.
    const render = async (beta: boolean, pathname: string, query: Record<string, string>) => {
        store.set(betaAtom.current!, beta)
        Object.assign(route, {pathname, query, asPath: pathname})
        await act(async () =>
            root.render(
                <Provider store={store}>
                    <Probe />
                </Provider>,
            ),
        )
        await act(async () => {
            await import("@/features/nav/appNavScope")
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
        return scopeId
    }

    beforeEach(() => {
        host = document.createElement("div")
        root = createRoot(host)
        store = createStore()
    })
    afterEach(() => act(() => root.unmount()))

    it("beta developer mode shows the app menu inside an app", async () => {
        expect(await render(true, `${R}/apps/[app_id]/overview`, {app_id: "a1"})).toBe("mobile-app")
        expect(await render(true, `${R}/variants`, {app: "a1"})).toBe("mobile-app")
        expect(await render(true, `${R}/prompts`, {})).toBe("mobile-main")
    })

    it("without beta developer mode every page keeps the main rail", async () => {
        expect(await render(false, `${R}/apps/[app_id]/overview`, {app_id: "a1"})).toBe(
            "mobile-main",
        )
        expect(await render(false, `${R}/apps/[app_id]/playground`, {app_id: "a1"})).toBe(
            "mobile-main",
        )
        expect(await render(false, `${R}/variants`, {app: "a1"})).toBe("mobile-main")
    })
})
