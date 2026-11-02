// @vitest-environment jsdom
import {act, createContext, useContext, type ReactNode} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {EndpointsScreen} from "@/features/endpoints/EndpointsScreen"

import {appsAtom, envsQuery, fakeEnv, variantsAtom, type FakeEnv} from "./endpointsScreenFixtures"

const router = vi.hoisted(() => ({
    query: {} as Record<string, string | undefined>,
    replace: vi.fn(),
}))
const copyError = vi.hoisted(() => vi.fn())
const invalidate = vi.hoisted(() => vi.fn())

vi.mock("next/router", () => ({
    useRouter: () => ({
        query: router.query,
        pathname: "/w/[workspace_id]/p/[project_id]/endpoints",
        replace: router.replace,
    }),
}))
vi.mock("@tanstack/react-query", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@tanstack/react-query")>()),
    useQueryClient: () => ({invalidateQueries: invalidate}),
}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/components/PageNotFound", () => ({
    PageNotFound: () => <p data-testid="not-found">not found</p>,
}))
vi.mock("@/lib/env", () => ({getApiUrl: () => "https://api.test/api"}))
vi.mock("@agenta/ui/app-message", () => ({message: {error: copyError}}))

vi.mock("@agenta/entities/workflow", async () => {
    const fixtures = await import("./endpointsScreenFixtures")
    const {atom} = await import("jotai")
    const select = (key: "url" | "inputSchema" | "isChat") => () =>
        atom((get) => get(fixtures.revisionAtom)[key])
    return {
        appWorkflowsListQueryStateAtom: fixtures.appsAtom,
        workflowVariantsListQueryStateAtomFamily: () => fixtures.variantsAtom,
        workflowMolecule: {
            selectors: {
                deploymentUrl: select("url"),
                inputSchema: select("inputSchema"),
                isChat: select("isChat"),
            },
        },
    }
})
vi.mock("@agenta/entities/environment", async () => {
    const fixtures = await import("./endpointsScreenFixtures")
    return {appEnvironmentsLoadableAtomFamily: () => fixtures.envsQuery}
})

// Radix Select needs pointer events jsdom lacks: a flat list of buttons does the same job here.
const PickContext = createContext<(value: string) => void>(() => undefined)
vi.mock("@agenta/ui/ui", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/ui/ui")>()
    return {
        ...actual,
        Select: ({
            onValueChange,
            children,
        }: {
            onValueChange: (value: string) => void
            children: ReactNode
        }) => <PickContext.Provider value={onValueChange}>{children}</PickContext.Provider>,
        SelectTrigger: () => null,
        SelectValue: () => null,
        SelectContent: ({children}: {children: ReactNode}) => <div>{children}</div>,
        SelectItem: function Item({value, children}: {value: string; children: ReactNode}) {
            const pick = useContext(PickContext)
            return (
                <button type="button" data-testid={`app-${value}`} onClick={() => pick(value)}>
                    {children}
                </button>
            )
        },
    }
})
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const APPS = [
    {id: "app-1", name: "Capitals", slug: "capitals"},
    {id: "app-2", name: "Chat bot", slug: "chat-bot"},
]

describe("EndpointsScreen", () => {
    let root: Root
    let host: HTMLDivElement
    let store: ReturnType<typeof createStore>
    const writeText = vi.fn()

    const text = () => host.textContent ?? ""
    const byTestId = (id: string) => host.querySelector(`[data-testid="${id}"]`)
    const click = (element: Element | null) => {
        if (!element) throw new Error("element not found")
        act(() => element.dispatchEvent(new MouseEvent("click", {bubbles: true})))
    }
    const clickText = (label: string) => {
        const matches = Array.from(host.querySelectorAll("*")).filter(
            (node) => node.textContent?.trim() === label,
        )
        click(matches.find((node) => node.tagName === "BUTTON") ?? matches.at(-1) ?? null)
    }
    const render = () =>
        act(() =>
            root.render(
                <Provider store={store}>
                    <EndpointsScreen workspaceId="ws-1" projectId="proj-1" />
                </Provider>,
            ),
        )
    const ready = (envs: FakeEnv[]) => {
        router.query.app = "app-1"
        store.set(appsAtom, {data: APPS, isPending: false, isError: false})
        store.set(variantsAtom, {data: [{id: "v1"}], isPending: false, isError: false})
        store.set(envsQuery, {data: envs, isPending: false, isError: false, refetch: vi.fn()})
    }

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        store = createStore()
        router.query = {workspace_id: "ws-1", project_id: "proj-1"}
        router.replace.mockReset()
        copyError.mockReset()
        invalidate.mockReset()
        writeText.mockReset()
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: {writeText},
        })
        store.set(appsAtom, {data: APPS, isPending: false, isError: false})
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    it("No app in the URL shows the pick an app state", () => {
        render()
        expect(text()).toContain("Pick an app")
        expect(text()).toContain("Choose an app to see how to call it.")
        expect(text()).toContain("Select an environment then use this endpoint")
    })

    it("Picking an app writes the app id to the URL", () => {
        render()
        click(byTestId("app-app-2"))
        expect(router.replace).toHaveBeenCalledWith(
            {
                pathname: "/w/[workspace_id]/p/[project_id]/endpoints",
                query: {workspace_id: "ws-1", project_id: "proj-1", app: "app-2"},
            },
            undefined,
            {shallow: true},
        )
    })

    it("An unknown app id shows not found", () => {
        router.query.app = "nope"
        render()
        expect(byTestId("not-found")).not.toBeNull()
    })

    it("An app without variants shows No variants available", () => {
        ready([fakeEnv("production")])
        store.set(variantsAtom, {data: [], isPending: false, isError: false})
        render()
        expect(text()).toContain("No variants available")
    })

    it("An environment without a deployment shows Publish Required with its name", () => {
        ready([fakeEnv("production", "production", false)])
        render()
        expect(text()).toContain("Publish Required")
        expect(text()).toContain("No variants have been published to production environment.")
        expect(byTestId("endpoints-invoke-code")).toBeNull()
    })

    it("Loading shows the skeleton, never Publish Required or an undefined environment", () => {
        ready([])
        store.set(envsQuery, {data: [], isPending: true, isError: false, refetch: vi.fn()})
        render()
        expect(byTestId("endpoints-skeleton")).not.toBeNull()
        expect(text()).not.toContain("Publish Required")
        expect(text()).not.toContain("undefined")
    })

    it("Switching language changes the code and the copied text", async () => {
        ready([fakeEnv("production")])
        render()
        expect(byTestId("endpoints-invoke-code")?.textContent).toContain("import requests")
        clickText("cURL")
        expect(byTestId("endpoints-invoke-code")?.textContent).toContain("curl -X POST")
        await act(async () => {
            clickText("Copy")
        })
        expect(writeText).toHaveBeenCalledTimes(1)
        expect(writeText.mock.calls[0][0]).toContain("curl -X POST")
    })

    it("A failed copy tells the reader in plain words", async () => {
        ready([fakeEnv("production")])
        writeText.mockRejectedValue(new Error("NotAllowedError: raw browser text"))
        render()
        await act(async () => {
            clickText("Copy")
        })
        expect(copyError).toHaveBeenCalledWith("Couldn't copy the snippet")
    })

    it("Snippets carry the key placeholder and the environment slug, not its name", () => {
        ready([fakeEnv("Production", "prod-eu")])
        render()
        expect(byTestId("endpoints-invoke-code")?.textContent).toContain("ApiKey YOUR_API_KEY")
        expect(byTestId("endpoints-invoke-code")?.textContent).toContain('"slug": "prod-eu"')
        click(host.querySelector('[data-slot="accordion-trigger"]:not([data-state="open"])'))
        const config = byTestId("endpoints-config-code")?.textContent ?? ""
        expect(config).toContain('environment_slug="prod-eu"')
        expect(config).not.toContain('"Production"')
    })

    it("A failed environments load shows a retry", () => {
        ready([])
        const refetch = vi.fn()
        store.set(envsQuery, {data: [], isPending: false, isError: true, refetch})
        render()
        expect(text()).toContain("Could not load endpoints")
        expect(text()).not.toContain("No variants available")
        expect(text()).not.toMatch(/Error|undefined|status/)
        clickText("Try again")
        expect(refetch).toHaveBeenCalled()
        expect(invalidate).toHaveBeenCalled()
    })

    it("A refetch keeps the environment the reader picked", () => {
        const envs = [fakeEnv("development"), fakeEnv("production")]
        ready(envs)
        render()
        clickText("development")
        expect(byTestId("endpoints-invoke-code")?.textContent).toContain('"slug": "development"')
        act(() =>
            store.set(envsQuery, {
                data: [...envs],
                isPending: false,
                isError: false,
                refetch: vi.fn(),
            }),
        )
        expect(byTestId("endpoints-invoke-code")?.textContent).toContain('"slug": "development"')
    })
})
