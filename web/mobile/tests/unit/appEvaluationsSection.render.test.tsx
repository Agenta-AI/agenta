// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {AppEvaluationsSection} from "@/features/app-overview/AppEvaluationsSection"
import {useEvaluationRunsList} from "@/features/evaluations/list/useEvaluationRunsList"

import {makeRun, page} from "./evaluationRunsFixtures"

// Only axios is replaced: the runs query, its paging and its cache keys are the package's own.
const http = vi.hoisted(() => ({post: vi.fn(), delete: vi.fn()}))
const env = vi.hoisted(() => ({evaluationsOn: true}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
    getAgentaApiUrl: () => "https://api.test",
}))
vi.mock("next/router", () => ({
    useRouter: () => ({query: {}, pathname: "/", push: vi.fn(), replace: vi.fn()}),
}))
vi.mock("next/link", () => ({
    default: ({
        children,
        href,
        prefetch,
    }: {
        children?: ReactNode
        href: string
        prefetch?: boolean
    }) => createElement("a", {href, "data-prefetch": String(prefetch)}, children),
}))
vi.mock("@/features/context/useProjectPermission", () => ({useProjectPermission: () => true}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: (id: string) => (id === "evaluations" ? env.evaluationsOn : false),
}))
vi.mock("@agenta/ui/hooks", () => ({useMediaQuery: () => true}))
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
        appWorkflowsListQueryStateAtom: atom({data: [], isPending: false, isError: false}),
    }
})
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
let client: QueryClient

const settle = async () => {
    for (let turn = 0; turn < 4; turn++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0))
        })
    }
}

const section = (kind: "auto" | "human") =>
    createElement(AppEvaluationsSection, {
        projectId: "pr",
        appId: "app-1",
        base: "/w/ws/p/pr",
        kind,
    })

const mount = async (kind: "auto" | "human" = "auto") => {
    await act(async () => root.render(createElement(QueryClientProvider, {client}, section(kind))))
    await settle()
}

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    http.post.mockReset().mockResolvedValue(page([]))
    env.evaluationsOn = true
})

afterEach(() => {
    vi.useRealTimers()
    act(() => root.unmount())
    host.remove()
})

describe("app evaluations section", () => {
    it("The auto section shows the five newest auto runs of this app", async () => {
        const runs = Array.from({length: 8}, (_, index) =>
            makeRun(`r${index + 1}`, {kind: "auto", references: {application: {id: "app-1"}}}),
        )
        http.post.mockResolvedValue(page(runs, "cursor-9"))
        await mount("auto")
        expect(host.textContent).toContain("Run r5")
        expect(host.textContent).not.toContain("Run r6")
        for (const id of ["r1", "r2", "r3", "r4"]) expect(host.textContent).toContain(`Run ${id}`)
        expect(host.textContent).toContain("Auto Evaluations")
    })

    it("A human run is not listed in the auto section", async () => {
        http.post.mockResolvedValue(
            page([makeRun("r-auto", {kind: "auto"}), makeRun("r-human", {kind: "human"})]),
        )
        await mount("auto")
        expect(host.textContent).toContain("Run r-auto")
        expect(host.textContent).not.toContain("Run r-human")
    })

    it("The latest runs query does not share a cache entry with the runs list", async () => {
        http.post.mockResolvedValue(page([makeRun("r1")]))
        const Probe = () => {
            useEvaluationRunsList({
                projectId: "pr",
                kind: "auto",
                appId: "app-1",
                search: "",
                statuses: [],
            })
            return null
        }
        await act(async () =>
            root.render(
                createElement(
                    QueryClientProvider,
                    {client},
                    createElement("div", null, section("auto"), createElement(Probe)),
                ),
            ),
        )
        await settle()
        const keys = client
            .getQueryCache()
            .getAll()
            .map((query) => JSON.stringify(query.queryKey))
            .filter((key) => key.includes("evaluation-runs"))
        expect(keys).toHaveLength(2)
        expect(new Set(keys).size).toBe(2)
        expect(keys.filter((key) => key.includes('"latest"'))).toHaveLength(1)
    })

    it("A run in progress refreshes the section every five seconds", async () => {
        http.post.mockResolvedValue(page([makeRun("r1", {status: "running"})]))
        vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]})
        await mount("auto")
        const before = http.post.mock.calls.length
        await act(async () => {
            await vi.advanceTimersByTimeAsync(5_100)
        })
        await settle()
        expect(http.post.mock.calls.length).toBeGreaterThan(before)
    })

    it("Finished runs are not refreshed", async () => {
        http.post.mockResolvedValue(page([makeRun("r1", {status: "success"})]))
        vi.useFakeTimers({toFake: ["setInterval", "clearInterval"]})
        await mount("auto")
        const before = http.post.mock.calls.length
        await act(async () => {
            await vi.advanceTimersByTimeAsync(11_000)
        })
        await settle()
        expect(http.post.mock.calls.length).toBe(before)
    })

    it("No runs shows the kind's empty state without a start button", async () => {
        await mount("human")
        expect(host.textContent).toContain("Get Started with Human Evaluation")
        expect(host.textContent).toContain("Learn More")
        const labels = [...host.querySelectorAll("button")].map((b) => b.textContent?.trim())
        expect(labels).not.toContain("Create Evaluation")
        expect(labels).not.toContain("Run Evaluation")
    })

    it("The section link opens the evaluations list for this app and kind", async () => {
        await mount("human")
        const link = host.querySelector("a")
        expect(link?.textContent).toBe("Human Evaluations →")
        expect(link?.getAttribute("href")).toBe("/w/ws/p/pr/evaluations?app=app-1&kind=human")
        expect(link?.getAttribute("data-prefetch")).toBe("false")
    })

    it("The section has no link while the evaluations view is off", async () => {
        env.evaluationsOn = false
        await mount("auto")
        expect(host.querySelector("a[href*='/evaluations']")).toBeNull()
        expect(host.textContent).toContain("Auto Evaluations")
    })

    it("A failed load shows Could not load evaluations with a retry", async () => {
        http.post.mockRejectedValue(new Error("boom"))
        await mount("auto")
        expect(host.textContent).toContain("Could not load evaluations")
        expect(host.textContent).not.toContain("Get Started")
        const retry = [...host.querySelectorAll("button")].find((b) =>
            /try again/i.test(b.textContent ?? ""),
        )
        const before = http.post.mock.calls.length
        await act(async () => retry?.click())
        await settle()
        expect(http.post.mock.calls.length).toBeGreaterThan(before)
    })
})
