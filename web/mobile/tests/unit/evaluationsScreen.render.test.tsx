// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {EvaluationsScreen} from "@/features/evaluations/list/EvaluationsScreen"

import {makeRun, page} from "./evaluationRunsFixtures"

const http = vi.hoisted(() => ({post: vi.fn(), delete: vi.fn()}))
const env = vi.hoisted(() => ({
    permissions: {edit_evaluation_runs: true} as Record<string, boolean>,
    wide: true,
    query: {} as Record<string, string | undefined>,
    replace: vi.fn(),
    push: vi.fn(),
}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
    getAgentaApiUrl: () => "https://api.test",
}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: env.query,
        pathname: "/evaluations",
        replace: env.replace,
        push: env.push,
    }),
}))
vi.mock("next/dynamic", () => ({default: () => () => null}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (_project: string, action: string) => env.permissions[action] ?? false,
}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => false,
}))
vi.mock("@/features/observability/ObservabilityAppFilter", () => ({
    ObservabilityAppFilter: ({
        value,
        onChange,
    }: {
        value: string | null
        onChange: (appId: string | null) => void
    }) =>
        createElement(
            "div",
            null,
            createElement("button", {"data-testid": "pick-app", onClick: () => onChange("app-1")}),
            createElement("button", {"data-testid": "all-apps", onClick: () => onChange(null)}),
            createElement("span", {"data-testid": "app-value"}, value ?? "none"),
        ),
}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => env.wide}))
vi.mock("@agenta/entities/shared", async (original) => ({
    ...(await original<object>()),
    UserAuthorLabel: () => createElement("span", null, "Alex Kim"),
}))
vi.mock("@agenta/entities/testset", async (original) => {
    const {atom} = await import("jotai")
    const testset = atom({name: "Capitals"})
    return {...(await original<object>()), testsetMolecule: {selectors: {data: () => testset}}}
})
vi.mock("@agenta/entities/workflow", async (original) => {
    const {atom} = await import("jotai")
    return {
        ...(await original<object>()),
        appWorkflowsListQueryStateAtom: atom({
            data: [{id: "app-1", name: "Support bot", slug: "support-bot"}],
            isPending: false,
            isError: false,
        }),
    }
})
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root

const settle = async () => {
    for (let turn = 0; turn < 4; turn++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }
}

const mount = async (props: {onCreate?: (kind: string) => void} = {}) => {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    await act(async () =>
        root.render(
            createElement(
                QueryClientProvider,
                {client},
                createElement(EvaluationsScreen, {workspaceId: "ws", projectId: "pr", ...props}),
            ),
        ),
    )
    await settle()
}

const text = () => host.textContent ?? ""
const button = (label: RegExp) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
        label.test(b.textContent ?? ""),
    )
const tabLabels = () => [...host.querySelectorAll("[role=tab]")].map((tab) => tab.textContent)

const openMenuOf = async (trigger: Element | null | undefined) => {
    await act(async () => {
        trigger?.dispatchEvent(
            new KeyboardEvent("keydown", {key: "ArrowDown", bubbles: true, cancelable: true}),
        )
    })
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    http.post.mockReset()
    env.replace.mockReset()
    env.push.mockReset()
    env.permissions = {edit_evaluation_runs: true}
    env.wide = true
    env.query = {}
    http.post.mockResolvedValue(page([]))
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    document.body.innerHTML = ""
})

describe("evaluation runs table", () => {
    it("A run without a name shows its id", async () => {
        http.post.mockResolvedValue(page([makeRun("run-abc", {name: null})]))
        await mount()
        expect(text()).toContain("run-abc")
    })

    it("Kind badges read Auto, Human, Live and SDK", async () => {
        http.post.mockResolvedValue(
            page([
                makeRun("a"),
                makeRun("h", {kind: "human"}),
                makeRun("l", {live: true}),
                makeRun("s", {kind: "custom"}),
            ]),
        )
        await mount()
        const badges = [...host.querySelectorAll("[data-slot=badge]")].map((el) => el.textContent)
        expect(badges).toEqual(["Auto", "Human", "Live", "SDK"])
    })

    it("A row shows the app, the test set, the date and the author", async () => {
        http.post.mockResolvedValue(
            page([
                makeRun("a", {
                    references: {application: {id: "app-1"}, testset: {id: "ts-1"}},
                }),
            ]),
        )
        await mount()
        expect(text()).toContain("Support bot")
        expect(text()).toContain("Capitals")
        expect(text()).toContain("Alex Kim")
        expect(text()).toContain("Mar 4, 2026")
    })

    it("The status dot is named by the status word", async () => {
        http.post.mockResolvedValue(page([makeRun("a", {status: "running"})]))
        await mount()
        expect(host.querySelector("[role=img][aria-label=Running]")).not.toBeNull()
    })

    it("A stopped live run reads Stopped, not Running", async () => {
        http.post.mockResolvedValue(
            page([
                makeRun("l", {live: true, status: "running", flags: {is_active: false}}),
                makeRun("r", {live: true, status: "running", flags: {is_active: true}}),
            ]),
        )
        await mount()
        expect(host.querySelectorAll("[role=img][aria-label=Stopped]")).toHaveLength(1)
        expect(host.querySelectorAll("[role=img][aria-label=Running]")).toHaveLength(1)
    })

    it("Phones show status, name and the menu only", async () => {
        env.wide = false
        http.post.mockResolvedValue(page([makeRun("a")]))
        await mount()
        const headers = [...host.querySelectorAll("[role=columnheader]")].map((h) => h.textContent)
        expect(headers).toEqual(["Status", "Name", "Actions"])
        expect(text()).not.toContain("Alex Kim")
        expect(host.querySelector("[aria-label='Run actions']")).not.toBeNull()
    })

    it("App scope drops the Application column", async () => {
        env.query = {app: "app-1"}
        http.post.mockResolvedValue(page([makeRun("a")]))
        await mount()
        const headers = [...host.querySelectorAll("[role=columnheader]")].map((h) => h.textContent)
        expect(headers).not.toContain("Application")
        expect(headers).toContain("Test set")
    })
})

describe("evaluations screen", () => {
    it("The tabs read All, Auto, Human, Live and SDK Evals", async () => {
        await mount()
        expect(tabLabels()).toEqual([
            "All Evals",
            "Auto Evals",
            "Human Evals",
            "Live Evals",
            "SDK Evals",
        ])
    })

    it("App scope hides the Live Evals tab", async () => {
        env.query = {app: "app-1"}
        await mount()
        expect(tabLabels()).not.toContain("Live Evals")
    })

    it("Picking an app writes app to the URL and All apps removes it", async () => {
        await mount()
        await act(async () => host.querySelector<HTMLElement>("[data-testid=pick-app]")?.click())
        expect(env.replace).toHaveBeenLastCalledWith(
            {pathname: "/evaluations", query: {app: "app-1"}},
            undefined,
            {shallow: true},
        )
        env.query = {app: "app-1", kind: "human"}
        await mount()
        await act(async () => host.querySelector<HTMLElement>("[data-testid=all-apps]")?.click())
        expect(env.replace).toHaveBeenLastCalledWith(
            {pathname: "/evaluations", query: {kind: "human"}},
            undefined,
            {shallow: true},
        )
    })

    it("Picking a tab writes kind to the URL", async () => {
        await mount()
        const tab = [...host.querySelectorAll<HTMLElement>("[role=tab]")].find(
            (el) => el.textContent === "Human Evals",
        )
        await act(async () => {
            tab?.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, button: 0}))
        })
        expect(env.replace).toHaveBeenLastCalledWith(
            {pathname: "/evaluations", query: {kind: "human"}},
            undefined,
            {shallow: true},
        )
    })

    it("The All menu offers Live evaluation", async () => {
        const onCreate = vi.fn()
        await mount({onCreate})
        await openMenuOf(button(/New evaluation|Start evaluation/))
        const items = [...document.querySelectorAll<HTMLElement>("[role=menuitem]")]
        expect(items.map((el) => el.textContent)).toEqual([
            "Auto evaluationRun test sets with configured evaluators for fast iteration.",
            "Human evaluationCollect human votes or ratings on evaluation outputs.",
            "Live evaluationEvaluate live traffic with an automatic evaluator.",
            "SDK evaluationRun evaluations programmatically using the Agenta SDK.",
        ])
        await act(async () => items[2].click())
        expect(onCreate).toHaveBeenCalledWith("online")
    })

    it("The toolbar button reads New evaluation on every tab and sits on the right", async () => {
        for (const kind of [undefined, "auto", "human", "online", "custom"]) {
            env.query = kind ? {kind} : {}
            await mount({onCreate: vi.fn()})
            const toolbarButtons = [...host.querySelectorAll<HTMLButtonElement>("button")].filter(
                (b) => /^(New|Start) evaluation$/.test(b.textContent?.trim() ?? ""),
            )
            expect(toolbarButtons[0]?.textContent?.trim()).toBe("New evaluation")
            expect(toolbarButtons[0]?.parentElement?.className).toContain("ml-auto")
            act(() => root.unmount())
            root = createRoot(host)
        }
    })

    it("The runs request leaves out runs that come from traces or test cases", async () => {
        await mount()
        const body = http.post.mock.calls[0][1] as {run?: {flags?: Record<string, boolean>}}
        expect(body.run?.flags).toEqual({has_testcases: false, has_traces: false})
    })

    it("An empty list hides its column header row and a list with runs shows it", async () => {
        const headerRow = () => host.querySelector("[role=row]")
        await mount()
        expect(headerRow()?.className).toContain("sr-only")
        act(() => root.unmount())
        root = createRoot(host)
        http.post.mockResolvedValue(page([makeRun("run-abc", {name: "Alpha"})]))
        await mount()
        expect(headerRow()?.className).not.toContain("sr-only")
    })

    it("The SDK tab empty state offers Get Started and Learn More", async () => {
        env.query = {kind: "custom"}
        const onCreate = vi.fn()
        await mount({onCreate})
        expect(text()).toContain("Get Started with SDK Evaluations")
        await act(async () => button(/^Get Started$/)?.click())
        expect(onCreate).toHaveBeenCalledWith("custom")
        expect(text()).toContain("Learn More")
    })

    it("A kind tab create button opens that kind directly", async () => {
        env.query = {kind: "human"}
        const onCreate = vi.fn()
        await mount({onCreate})
        await act(async () => button(/New evaluation/)?.click())
        expect(onCreate).toHaveBeenCalledWith("human")
    })

    it("The Live tab shows a create button", async () => {
        env.query = {kind: "online"}
        const onCreate = vi.fn()
        await mount({onCreate})
        await act(async () => button(/New evaluation/)?.click())
        expect(onCreate).toHaveBeenCalledWith("online")
    })

    it("The Live empty state starts a live evaluation", async () => {
        env.query = {kind: "online"}
        const onCreate = vi.fn()
        await mount({onCreate})
        expect(text()).toContain("Get Started with Live Evaluation")
        await act(async () => button(/^Create Evaluation$/)?.click())
        expect(onCreate).toHaveBeenCalledWith("online")
    })

    it("A reader without edit rights sees no Live entry", async () => {
        env.permissions = {}
        env.query = {kind: "online"}
        await mount({onCreate: vi.fn()})
        expect(button(/New evaluation|Create Evaluation/)).toBeUndefined()
    })

    it("A reader without edit rights sees no create button", async () => {
        env.permissions = {}
        await mount({onCreate: vi.fn()})
        expect(button(/New evaluation|Start evaluation/)).toBeUndefined()
    })

    it("A failed first load shows Could not load evaluations with a retry", async () => {
        http.post.mockRejectedValue(new Error("403"))
        await mount()
        expect(text()).toContain("Could not load evaluations")
        expect(text()).not.toContain("Get Started")
        const calls = http.post.mock.calls.length
        await act(async () => button(/try again/i)?.click())
        await settle()
        expect(http.post.mock.calls.length).toBeGreaterThan(calls)
    })

    it("The human tab empty state shows Get Started with Human Evaluation", async () => {
        env.query = {kind: "human"}
        await mount({onCreate: vi.fn()})
        expect(text()).toContain("Get Started with Human Evaluation")
        expect(button(/Create Evaluation/)).toBeDefined()
        expect(text()).toContain("Learn More")
    })

    it("The empty state has no start button for a reader without edit rights", async () => {
        env.permissions = {}
        env.query = {kind: "auto"}
        await mount({onCreate: vi.fn()})
        expect(text()).toContain("Get Started with Evaluations")
        expect(button(/Run Evaluation/)).toBeUndefined()
        expect(text()).toContain("Learn More")
    })

    it("A search with no rows shows No evaluations match your filters", async () => {
        env.query = {q: "zzz"}
        await mount()
        expect(text()).toContain("No evaluations match your filters")
        expect(text()).not.toContain("Get Started")
        await act(async () => button(/Clear filters/)?.click())
        expect(env.replace).toHaveBeenLastCalledWith(
            {pathname: "/evaluations", query: {}},
            undefined,
            {shallow: true},
        )
    })

    it("Applied filters show as chips, and a chip's remove drops only that filter", async () => {
        env.query = {status: "running,failure", range: "7 days", types: "human"}
        await mount()
        const chips = [...host.querySelectorAll("[aria-label='Applied filters'] li")].map(
            (chip) => chip.textContent,
        )
        expect(chips).toEqual([
            "Status: Running, Failure",
            "Type: Human",
            "Date range: Last 7 days",
        ])
        expect(host.querySelector("[aria-label='Filters']")?.textContent).toBe("3")
        await act(async () =>
            host.querySelector<HTMLButtonElement>("[aria-label='Remove Status filter']")?.click(),
        )
        expect(env.replace).toHaveBeenLastCalledWith(
            {pathname: "/evaluations", query: {range: "7 days", types: "human"}},
            undefined,
            {shallow: true},
        )
    })

    it("Without filters the toolbar says so", async () => {
        await mount()
        expect(text()).toContain("No filters applied")
        expect(host.querySelector("[aria-label='Filters']")?.textContent).toBe("0")
    })

    it("A status picked in the panel is applied only on Apply", async () => {
        await mount()
        await act(async () =>
            host.querySelector<HTMLButtonElement>("[aria-label='Filters']")?.click(),
        )
        expect(button(/^Apply$/)?.disabled).toBe(true)
        await openMenuOf(document.querySelector("[aria-label='Status']"))
        const failure = [...document.querySelectorAll<HTMLElement>("[role=menuitemcheckbox]")].find(
            (item) => item.textContent === "Failure",
        )
        await act(async () => failure?.click())
        expect(env.replace).not.toHaveBeenCalled()
        await act(async () => button(/^Apply$/)?.click())
        expect(env.replace).toHaveBeenLastCalledWith(
            {pathname: "/evaluations", query: {status: "failure"}},
            undefined,
            {shallow: true},
        )
    })

    it("The Type filter is offered on the All tab only", async () => {
        env.query = {kind: "auto"}
        await mount()
        await act(async () =>
            host.querySelector<HTMLButtonElement>("[aria-label='Filters']")?.click(),
        )
        expect(document.querySelector("[aria-label='Type']")).toBeNull()
        expect(document.querySelector("[aria-label='Evaluators']")).not.toBeNull()
        expect(document.querySelector<HTMLButtonElement>("[aria-label='Variants']")?.disabled).toBe(
            true,
        )
    })

    it("A status filter with no rows shows the no match state", async () => {
        env.query = {status: "running"}
        await mount()
        expect(text()).toContain("No evaluations match your filters")
    })

    it("An empty page with older runs left asks to load more, not Get Started", async () => {
        env.query = {kind: "human"}
        http.post.mockResolvedValue(page([], "cursor-1"))
        await mount()
        expect(text()).toContain("No matching evaluations in the newest runs")
        expect(text()).not.toContain("Get Started")
        expect(button(/Load more/)).toBeDefined()
    })

    it("Load more shows while there is a next page and asks for it", async () => {
        http.post
            .mockResolvedValueOnce(page([makeRun("a")], "cursor-1"))
            .mockResolvedValueOnce(page([makeRun("b")]))
        await mount()
        await act(async () => button(/Load more/)?.click())
        await settle()
        expect(text()).toContain("Run b")
        expect(button(/Load more/)).toBeUndefined()
    })

    it("Search is sent to the server as the run name", async () => {
        env.query = {q: "alpha"}
        await mount()
        const body = http.post.mock.calls[0][1] as {run?: {name?: string}}
        expect(body.run?.name).toBe("alpha")
    })
})
