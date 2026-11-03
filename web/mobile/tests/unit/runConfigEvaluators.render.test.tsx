// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {activeUserIdAtom, projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore, Provider} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Only the HTTP layer is fake: the run query, the workflow queries and the section hooks are the
// real package and app code.
const http = vi.hoisted(() => ({
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
}))
vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<typeof import("@agenta/shared/api")>()),
    axios: http,
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

const router = vi.hoisted(() => ({query: {} as Record<string, string>, replace: vi.fn()}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: router.query,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]",
        asPath: "/w/ws/p/pr/evaluations/results/run",
        replace: router.replace,
        back: vi.fn(),
    }),
}))
vi.mock("@agenta/ui/app-message", () => ({message: {success: vi.fn(), error: vi.fn()}}))
vi.mock("@/features/context/useProjectPermission", () => ({useProjectPermission: () => true}))
vi.mock("@/features/nav/AppShell", () => ({
    AppShell: ({children}: {children: ReactNode}) => children,
}))
vi.mock("@/features/nav/NavDrawer", () => ({NavDrawer: () => null}))
vi.mock("@/features/context/useBindProjectContext", () => ({
    useBindProjectContext: () => undefined,
}))
vi.mock("@/components/PageTitle", () => ({PageTitle: () => null}))
vi.mock("@agenta/auth-ui", () => ({NotFoundScreen: () => null}))
// The drawer is a separate chunk with its own tests; here it only shows which kind opened.
vi.mock("@/features/revisions/RevisionDrawerHost", () => ({
    RevisionDrawerHost: ({kind}: {kind: string}) =>
        createElement("div", {"data-testid": "drawer"}, kind),
}))
vi.mock("@/features/evaluation-run/configuration/ConfigJsonViewer", () => ({
    ConfigJsonViewer: ({value}: {value: unknown}) =>
        createElement("pre", {"data-testid": "json"}, JSON.stringify(value)),
}))

import {EvaluatorsConfigSection} from "@/features/evaluation-run/configuration/EvaluatorsConfigSection"
import type {EvaluatorConfig} from "@/features/evaluation-run/configuration/useEvaluatorConfigs"
import EvaluationRunPage from "@/pages/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const store = getDefaultStore()
let host: HTMLDivElement
let root: Root
let runCounter = 0

const tick = (ms = 100) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)))
const flush = async () => {
    for (let i = 0; i < 10; i++) await tick()
}

const buttons = () => [...host.querySelectorAll("button")]

beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_AGENTA_DEVELOPER_VIEWS", "evaluations")
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store.set(activeUserIdAtom, "user-1")
    store.set(projectIdAtom, "pr")
    store.set(sessionAtom, true)
    Object.values(http).forEach((fn) => fn.mockReset())
    router.replace.mockReset()
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllEnvs()
    store.set(sessionAtom, false)
})

const EVALUATOR: EvaluatorConfig = {
    key: "ev-step",
    name: "Exact match",
    description: "Compares the answer with the expected one",
    version: 4,
    latest: false,
    revisionId: "ev-rev-4",
    settings: {correct_answer_key: "capital"},
    snapshot: {parameters: {correct_answer_key: "capital"}},
    pending: false,
    failed: false,
}

async function renderSection(evaluators: EvaluatorConfig[]) {
    await act(async () => {
        root.render(createElement(EvaluatorsConfigSection, {evaluators}))
    })
}

describe("evaluators section", () => {
    it("Each evaluator shows its name, version and description, the first one open", async () => {
        router.query = {}
        await renderSection([
            EVALUATOR,
            {...EVALUATOR, key: "second", name: "Length check", description: "Checks length"},
        ])
        const cards = [...host.querySelectorAll('[data-testid="evaluator-card"]')]
        expect(cards).toHaveLength(2)
        expect(cards[0].textContent).toContain("Exact match")
        expect(cards[0].textContent).toContain("V4")
        expect(cards[0].textContent).toContain("Compares the answer with the expected one")
        // The open card lists its settings; the closed one keeps only its header.
        expect(cards[0].textContent).toContain("correct_answer_key")
        expect(cards[1].textContent).toContain("Length check")
        expect(cards[1].textContent).not.toContain("correct_answer_key")
        expect(cards[0].querySelector('[aria-expanded="true"]')).not.toBeNull()
        expect(cards[1].querySelector('[aria-expanded="false"]')).not.toBeNull()
    })

    it("A run without evaluators says so", async () => {
        await renderSection([])
        expect(host.textContent).toContain("No evaluator reference found for this run.")
    })

    it("A failed evaluator shows Failed to load evaluator details", async () => {
        await renderSection([{...EVALUATOR, failed: true}])
        expect(host.textContent).toContain("Failed to load evaluator details")
    })
})

/** A run with an evaluator step, and the workflow reads that answer for it. */
function serveRunWithEvaluator(options: {revisionReference: boolean; workflowsFail?: boolean}) {
    const id = `run-${++runCounter}`
    const run = {
        id,
        name: "Capitals check",
        status: "evaluation_finished",
        flags: {is_live: false, is_active: false, is_closed: false},
        data: {
            steps: [
                {
                    key: "ev-step",
                    type: "annotation",
                    origin: "auto",
                    references: {
                        evaluator: {id: "ev-1", slug: "exact-match"},
                        ...(options.revisionReference
                            ? {evaluator_revision: {id: "ev-rev-4", version: 4}}
                            : {}),
                    },
                },
            ],
        },
    }
    const revision = {
        id: "ev-rev-4",
        version: 4,
        workflow_id: "ev-1",
        flags: {is_evaluator: true},
        data: {parameters: {correct_answer_key: "capital"}},
    }
    http.post.mockImplementation(async (url: string) => {
        if (url.endsWith("/evaluations/runs/query")) return {data: {count: 1, runs: [run]}}
        if (url.endsWith("/evaluations/metrics/query")) return {data: {count: 0, metrics: []}}
        if (options.workflowsFail && url.includes("/workflows/")) {
            throw new Error("internal-detail-secret")
        }
        if (url.endsWith("/workflows/query")) {
            return {
                data: {
                    count: 1,
                    workflows: [
                        {id: "ev-1", name: "Exact match", description: "Compares the answer"},
                    ],
                },
            }
        }
        if (url.endsWith("/workflows/revisions/query")) {
            return {data: {count: 1, workflow_revisions: [revision]}}
        }
        return {data: {}}
    })
    http.get.mockImplementation(async (url: string) => {
        if (url.includes("/workflows/revisions/")) {
            return {data: {count: 1, workflow_revision: revision}}
        }
        return {data: {}}
    })
    router.query = {
        workspace_id: "ws",
        project_id: "pr",
        evaluation_id: id,
        view: "configuration",
    }
}

async function mountPage() {
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store.set(queryClientAtom, client)
    await act(async () => {
        root.render(
            createElement(
                Provider,
                {store},
                createElement(QueryClientProvider, {client}, createElement(EvaluationRunPage)),
            ),
        )
    })
    await flush()
    for (let i = 0; i < 30 && !host.querySelector('[aria-label="Run summary"]'); i++) await tick()
    await flush()
}

describe("evaluators on the Configuration tab", () => {
    it("An evaluator without a revision reference shows Latest and sends no PATCH", async () => {
        serveRunWithEvaluator({revisionReference: false})
        await mountPage()
        const card = host.querySelector('[data-testid="evaluator-card"]')
        expect(card?.textContent).toContain("Exact match")
        expect(card?.textContent).toContain("Latest")
        expect(card?.textContent).not.toContain("V4")
        expect(http.patch).not.toHaveBeenCalled()
        expect(http.put).not.toHaveBeenCalled()
        expect(http.delete).not.toHaveBeenCalled()
        expect(
            http.post.mock.calls
                .map((call) => String(call[0]))
                .filter((url) => !url.endsWith("/query")),
        ).toEqual([])
    })

    it("Clicking an evaluator opens the evaluator revision drawer", async () => {
        serveRunWithEvaluator({revisionReference: true})
        await mountPage()
        const name = buttons().find((button) => button.textContent === "Exact match")
        await act(async () => name?.click())
        expect(router.replace).toHaveBeenCalledWith(
            expect.objectContaining({query: expect.objectContaining({revisionId: "ev-rev-4"})}),
            undefined,
            {shallow: true},
        )
        // With the id in the URL, the page mounts the drawer for an evaluator revision.
        router.query = {...router.query, revisionId: "ev-rev-4"}
        await act(async () => {
            root.render(
                createElement(
                    Provider,
                    {store},
                    createElement(
                        QueryClientProvider,
                        {client: store.get(queryClientAtom)},
                        createElement(EvaluationRunPage),
                    ),
                ),
            )
        })
        await flush()
        expect(host.querySelector('[data-testid="drawer"]')?.textContent).toBe("evaluator")
    })

    it("An evaluator load error shows Failed to load evaluator details without the raw error", async () => {
        serveRunWithEvaluator({revisionReference: true, workflowsFail: true})
        const logged = vi.spyOn(console, "error").mockImplementation(() => undefined)
        await mountPage()
        expect(host.textContent).toContain("Failed to load evaluator details")
        expect(host.textContent).not.toContain("internal-detail-secret")
        logged.mockRestore()
    })
})
