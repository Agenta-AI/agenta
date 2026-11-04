// @vitest-environment jsdom
import {act, createElement} from "react"

import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {getDefaultStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {RUNS_LIST_KEY} from "@/features/evaluations/list/runsListKey"
import {LiveEvaluationSheet} from "@/features/evaluations/live/LiveEvaluationSheet"
import type {LiveEvaluationDraft} from "@/features/evaluations/live/useLiveEvaluationForm"

// Only the HTTP layer is mocked (axios and the generated clients). The live create, the evaluator
// stores and the vault store are real.
const http = vi.hoisted(() => ({post: vi.fn(), get: vi.fn(), delete: vi.fn()}))
const toast = vi.hoisted(() => ({
    message: {success: vi.fn(), error: vi.fn(), warning: vi.fn()},
    notification: {error: vi.fn()},
}))
const nav = vi.hoisted(() => ({push: vi.fn()}))
// The vault is read through the generated API client, not axios: this is its HTTP seam.
const vault = vi.hoisted(() => ({listSecrets: vi.fn()}))
const view = vi.hoisted(() => ({evaluators: false}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: http,
    getAgentaApiUrl: () => "https://api.test",
}))
// The live create goes through the generated clients. Each method records its call under its
// endpoint path, in the same list as the axios calls, and answers like the API body.
vi.mock("@agenta/sdk/resources", async (original) => {
    const endpoint =
        (path: (body: {query_id?: string}) => string) =>
        async (body: {query_id?: string}, options: unknown) =>
            (await http.post(`https://api.test${path(body)}`, body, options)).data
    return {
        ...(await original<object>()),
        getSecretsClient: () => vault,
        getQueriesClient: () => ({
            createSimpleQuery: endpoint(() => "/simple/queries/"),
            retrieveQueryRevision: endpoint(() => "/queries/revisions/retrieve"),
            archiveSimpleQuery: endpoint((body) => `/simple/queries/${body.query_id}/archive`),
        }),
        getEvaluationsClient: () => ({
            createSimpleEvaluation: endpoint(() => "/simple/evaluations/"),
        }),
    }
})
vi.mock("@agenta/ui/app-message", () => toast)
vi.mock("next/router", () => ({useRouter: () => ({push: nav.push, query: {}})}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: () => view.evaluators,
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true
// Radix measures the slider thumb; jsdom has no ResizeObserver.
const noop = () => undefined
globalThis.ResizeObserver ??= class {
    observe = noop
    unobserve = noop
    disconnect = noop
} as unknown as typeof ResizeObserver

const API = "https://api.test"
const PARAMS = {queryParams: {project_id: "pr"}}
const ID = {
    regex: "66666666-6666-4666-8666-666666666666",
    regexRevision: "77777777-7777-4777-8777-777777777777",
    judge: "66666666-6666-4666-8666-6666666666bb",
    judgeRevision: "77777777-7777-4777-8777-7777777777bb",
    exact: "66666666-6666-4666-8666-6666666666cc",
    exactRevision: "77777777-7777-4777-8777-7777777777cc",
} as const

interface EvaluatorFixture {
    id: string
    revisionId: string
    name: string
    uri: string
    flags?: Record<string, boolean>
}

const REGEX: EvaluatorFixture = {
    id: ID.regex,
    revisionId: ID.regexRevision,
    name: "Tone check",
    uri: "agenta:builtin:auto_regex_test:v0",
}
const JUDGE: EvaluatorFixture = {
    id: ID.judge,
    revisionId: ID.judgeRevision,
    name: "Helpfulness judge",
    uri: "agenta:builtin:auto_ai_critique:v0",
    flags: {is_llm: true},
}
const EXACT: EvaluatorFixture = {
    id: ID.exact,
    revisionId: ID.exactRevision,
    name: "Exact answer",
    uri: "agenta:builtin:auto_exact_match:v0",
}

let evaluators: EvaluatorFixture[] = []
let evaluatorListError = false
let host: HTMLDivElement
let root: Root
let client: QueryClient
const onClose = vi.fn()
const onCreated = vi.fn()

/** The API answers like the real one for the endpoints the sheet calls. */
const mockApi = (overrides: Record<string, (body: unknown) => unknown> = {}) => {
    http.post.mockImplementation(async (url: string, body: unknown) => {
        const path = url.replace(API, "")
        const override = overrides[path]
        if (override) return {data: override(body)}
        switch (path) {
            case "/workflows/query":
                if (evaluatorListError) throw new Error("list failed")
                return {
                    data: {
                        count: evaluators.length,
                        workflows: evaluators.map((e) => ({
                            id: e.id,
                            name: e.name,
                            slug: e.name.toLowerCase().replace(/ /g, "-"),
                            flags: {is_evaluator: true},
                        })),
                    },
                }
            case "/workflows/revisions/query":
                return {
                    data: {
                        count: evaluators.length,
                        workflow_revisions: evaluators.map((e) => ({
                            id: e.revisionId,
                            workflow_id: e.id,
                            // Revisions often keep the default name, not the evaluator's.
                            name: "default",
                            version: 2,
                            flags: {is_evaluator: true, ...e.flags},
                            data: {
                                uri: e.uri,
                                schemas: {
                                    outputs: {
                                        type: "object",
                                        properties: {success: {type: "boolean"}},
                                    },
                                },
                            },
                        })),
                    },
                }
            case "/simple/queries/":
                return {data: {count: 1, query: {id: "query-1"}}}
            case "/queries/revisions/retrieve":
                return {data: {count: 1, query_revision: {id: "query-rev-1"}}}
            case "/simple/evaluations/":
                return {data: {count: 1, evaluation: {id: "live-run-1"}}}
            case "/simple/queries/query-1/archive":
                return {data: {count: 1}}
            default:
                throw new Error(`Unexpected request: ${path}`)
        }
    })
    http.get.mockImplementation(async (url: string) => {
        // The type tag reads the evaluator template catalog for its label.
        if (url === `${API}/evaluators/catalog/templates/`) {
            return {data: {count: 0, templates: []}}
        }
        throw new Error(`Unexpected request: ${url}`)
    })
    vault.listSecrets.mockResolvedValue([])
}

const tick = () =>
    act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })

/** Lets the requests answer: a few turns, then more until `done` holds or the turns run out. */
const settle = async (done: () => boolean = () => true) => {
    for (let turn = 0; turn < 6; turn++) await tick()
    for (let turn = 0; turn < 60 && !done(); turn++) await tick()
}

const evaluatorsSettled = () => !document.querySelector("[data-slot=combobox-trigger][aria-busy]")

const mount = async (initial?: Partial<LiveEvaluationDraft>) => {
    await act(async () =>
        root.render(
            createElement(
                QueryClientProvider,
                {client},
                createElement(LiveEvaluationSheet, {
                    open: true,
                    projectId: "pr",
                    base: "/w/ws/p/pr",
                    initial,
                    onClose,
                    onCreated,
                }),
            ),
        ),
    )
    await settle(evaluatorsSettled)
}

const text = () => document.body.textContent ?? ""
const button = (label: RegExp) =>
    [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
        label.test(b.textContent ?? ""),
    )
const nameInput = () => document.querySelector<HTMLInputElement>("input[name=name]")
const evaluatorSelect = () =>
    document.querySelector<HTMLInputElement>("input[role=combobox][aria-label=Evaluator]")

const typeName = async (value: string) => {
    const input = nameInput()
    if (!input) throw new Error("No name field")
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    await act(async () => {
        setter?.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
}

const openEvaluators = async () => {
    const trigger = evaluatorSelect()?.closest("[data-slot=combobox-trigger]")
    await act(async () => {
        trigger?.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, cancelable: true}))
    })
}

const pickEvaluator = async (name: string) => {
    await openEvaluators()
    const option = [...document.querySelectorAll<HTMLElement>("[role=option]")].find(
        (o) => o.textContent === name,
    )
    if (!option) throw new Error(`No option ${name}`)
    await act(async () => option.click())
}

const submit = async () => {
    await act(async () => button(/^Create live evaluation$/)?.click())
    await settle(() => !document.querySelector("form [aria-busy=true]"))
}

const createRequests = () =>
    http.post.mock.calls.filter(([url]) => !String(url).startsWith(`${API}/workflows/`)) as [
        string,
        unknown,
        unknown,
    ][]

beforeEach(() => {
    vi.clearAllMocks()
    evaluators = [REGEX]
    evaluatorListError = false
    view.evaluators = false
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const store = getDefaultStore()
    store.set(queryClientAtom, client)
    store.set(projectIdAtom, "pr")
    store.set(sessionAtom, true)
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    mockApi()
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
})

describe("live evaluation sheet", () => {
    it("Create sends the query, the revision lookup and the evaluation in order", async () => {
        await mount()
        await typeName("Support replies")
        await pickEvaluator("Tone check")

        await submit()

        expect(createRequests()).toEqual([
            [
                `${API}/simple/queries/`,
                {
                    query: {
                        slug: expect.stringMatching(/^support-replies-[0-9a-f]{8}$/),
                        name: "Support replies",
                        description: "",
                        data: {
                            filtering: {
                                operator: "and",
                                conditions: [
                                    {field: "trace_type", operator: "is", value: "invocation"},
                                ],
                            },
                            windowing: {rate: 1},
                        },
                    },
                },
                PARAMS,
            ],
            [`${API}/queries/revisions/retrieve`, {query_ref: {id: "query-1"}}, PARAMS],
            [
                `${API}/simple/evaluations/`,
                {
                    evaluation: {
                        name: "Support replies",
                        description: "",
                        flags: {is_live: true, is_closed: false, is_active: false},
                        data: {
                            status: "pending",
                            query_steps: {"query-rev-1": "auto"},
                            evaluator_steps: {[ID.regexRevision]: "auto"},
                            repeats: 1,
                        },
                    },
                },
                PARAMS,
            ],
        ])
    })

    it("The query filtering starts with the invocation row", async () => {
        await mount({
            name: "Support replies",
            description: "Replies from the help desk",
            samplingRate: 25,
            userFilters: [{field: "attributes", key: "ag.meta.user", operator: "is", value: "Sam"}],
        })
        await pickEvaluator("Tone check")

        await submit()

        const [, body] = createRequests()[0]
        expect(body).toEqual({
            query: {
                slug: expect.stringMatching(/^support-replies-[0-9a-f]{8}$/),
                name: "Support replies",
                description: "Replies from the help desk",
                data: {
                    filtering: {
                        operator: "and",
                        conditions: [
                            {field: "trace_type", operator: "is", value: "invocation"},
                            {
                                field: "attributes",
                                key: "ag.meta.user",
                                operator: "is",
                                value: "Sam",
                            },
                        ],
                    },
                    windowing: {rate: 0.25},
                },
            },
        })
    })

    it("The query summary counts only the user's filters", async () => {
        await mount()
        expect(text()).toContain("No filters • Sampling 100% • Live traffic")
        await act(async () => root.unmount())
        root = createRoot(host)
        await mount({
            userFilters: [
                {field: "attributes", key: "ag.meta.user", operator: "is", value: "Sam"},
                {field: "status", operator: "is", value: "error"},
            ],
            samplingRate: 25,
        })
        expect(text()).toContain("2 filters • Sampling 25% • Live traffic")
    })

    it("Opening the trace filter does not submit the form", async () => {
        await mount()
        await typeName("Support replies")
        await pickEvaluator("Tone check")

        await act(async () =>
            document.querySelector<HTMLButtonElement>("button[aria-label=Filter]")?.click(),
        )
        await settle()

        expect(createRequests()).toEqual([])
        expect(text()).toContain("Apply")
    })

    it("An annotation filter row offers the evaluator and feedback controls", async () => {
        const annotated = {
            field: "has_annotation",
            operator: "in",
            value: [{evaluator: "tone-check"}],
        }
        await mount({userFilters: [annotated]})
        await typeName("Support replies")
        await pickEvaluator("Tone check")

        await act(async () =>
            document.querySelector<HTMLButtonElement>("button[aria-label=Filter]")?.click(),
        )
        // The form's own evaluator select is one; the annotation row adds the second.
        await vi.waitFor(() =>
            expect(
                document.querySelectorAll("input[role=combobox][aria-label=Evaluator]"),
            ).toHaveLength(2),
        )
        await act(async () => button(/^Apply$/)?.click())

        await submit()

        const [, body] = createRequests()[0]
        expect(body).toMatchObject({
            query: {
                data: {
                    filtering: {
                        operator: "and",
                        conditions: [
                            {field: "trace_type", operator: "is", value: "invocation"},
                            annotated,
                        ],
                    },
                },
            },
        })
    })

    it("Empty name shows Enter a name and sends nothing", async () => {
        await mount()
        await pickEvaluator("Tone check")
        await typeName("")

        await submit()

        expect(text()).toContain("Enter a name")
        expect(createRequests()).toEqual([])
        expect(onClose).not.toHaveBeenCalled()
    })

    it("No evaluator shows Select an evaluator and sends nothing", async () => {
        await mount()
        await typeName("Support replies")

        await submit()

        expect(text()).toContain("Select an evaluator")
        expect(createRequests()).toEqual([])
    })

    it("Picking an evaluator fills an empty name and keeps an edited one", async () => {
        evaluators = [REGEX, EXACT, JUDGE]
        await mount()

        await pickEvaluator("Tone check")
        expect(nameInput()?.value).toMatch(/^Tone check-[a-z0-9]{4}$/)

        await typeName("My own name")
        await pickEvaluator("Helpfulness judge")
        expect(nameInput()?.value).toBe("My own name")
    })

    it("An evaluator without a name is listed by its slug, not its revision name", async () => {
        evaluators = [REGEX]
        mockApi({
            "/workflows/query": () => ({
                count: 1,
                workflows: [
                    {id: ID.regex, name: null, slug: "tone-check", flags: {is_evaluator: true}},
                ],
            }),
        })
        await mount()
        await openEvaluators()
        const options = [...document.querySelectorAll("[role=option]")].map((o) => o.textContent)
        expect(options).toEqual(["tone-check"])
    })

    it("Only online capable evaluators are offered", async () => {
        evaluators = [REGEX, EXACT, JUDGE]
        await mount()
        await openEvaluators()
        const options = [...document.querySelectorAll("[role=option]")].map((o) => o.textContent)
        expect(options).toEqual(["Tone check", "Helpfulness judge"])
    })

    it("No supported evaluator disables create and shows the registry text", async () => {
        evaluators = [EXACT]
        view.evaluators = true
        await mount()

        expect(text()).toContain(
            "No supported evaluators are available. Add an evaluator configured as Custom, LLM-as-a-judge, Code, Regex test, or Webhook test to continue.",
        )
        expect(evaluatorSelect()?.disabled).toBe(true)
        expect(button(/^Create live evaluation$/)?.disabled).toBe(true)
        const link = [...document.querySelectorAll("a")].find(
            (a) => a.textContent === "Open evaluator registry",
        )
        expect(link?.getAttribute("href")).toBe("/w/ws/p/pr/evaluators")
    })

    it("The registry link is hidden while the evaluators view is off", async () => {
        evaluators = [EXACT]
        await mount()
        expect(text()).toContain("No supported evaluators are available.")
        expect(text()).not.toContain("Open evaluator registry")
    })

    it("While evaluators load the select says Loading evaluators and the name is usable", async () => {
        const answer = http.post.getMockImplementation()
        http.post.mockImplementation((url: string, body: unknown) =>
            url === `${API}/workflows/query` ? new Promise(() => undefined) : answer?.(url, body),
        )
        await mount()

        expect(text()).toContain("Loading evaluators...")
        await typeName("Support replies")
        expect(nameInput()?.value).toBe("Support replies")
    })

    it("A failed evaluator list shows Could not load evaluators with a retry", async () => {
        evaluatorListError = true
        await mount()
        expect(text()).toContain("Could not load evaluators")

        evaluatorListError = false
        await act(async () => button(/try again/i)?.click())
        await settle()
        expect(text()).not.toContain("Could not load evaluators")
        expect(evaluatorSelect()).not.toBeNull()
    })

    it("A failure shows Couldn't create the live evaluation and keeps the input", async () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined)
        mockApi({
            "/simple/evaluations/": () => {
                throw new Error("database is down")
            },
        })
        await mount()
        await typeName("Support replies")
        await pickEvaluator("Tone check")

        await submit()

        expect(toast.message.error).toHaveBeenCalledWith("Couldn't create the live evaluation")
        expect(text()).not.toContain("database is down")
        expect(createRequests().map(([url]) => url)).toEqual([
            `${API}/simple/queries/`,
            `${API}/queries/revisions/retrieve`,
            `${API}/simple/evaluations/`,
            `${API}/simple/queries/query-1/archive`,
        ])
        expect(onClose).not.toHaveBeenCalled()
        expect(nameInput()?.value).toBe("Support replies")
    })

    it("A second click while creating sends nothing", async () => {
        let release: (value: unknown) => void = () => undefined
        mockApi()
        const answer = http.post.getMockImplementation()
        http.post.mockImplementation((url: string, body: unknown) =>
            url === `${API}/simple/queries/`
                ? new Promise((resolve) => (release = resolve))
                : answer?.(url, body),
        )
        await mount()
        await typeName("Support replies")
        await pickEvaluator("Tone check")

        await act(async () => button(/^Create live evaluation$/)?.click())
        await act(async () => {
            const form = document.querySelector("form")
            form?.dispatchEvent(new Event("submit", {bubbles: true, cancelable: true}))
        })

        expect(createRequests()).toHaveLength(1)
        expect(button(/Create live evaluation/)?.disabled).toBe(true)
        await act(async () => release({data: {query: {id: "query-1"}}}))
        await settle()
        expect(createRequests()).toHaveLength(3)
    })

    it("Success closes the sheet, refetches the runs and reports the new run", async () => {
        const invalidate = vi.spyOn(client, "invalidateQueries")
        await mount()
        await typeName("Support replies")
        await pickEvaluator("Tone check")

        await submit()

        expect(toast.message.success).toHaveBeenCalledWith("Live evaluation created")
        expect(invalidate).toHaveBeenCalledWith({queryKey: RUNS_LIST_KEY})
        expect(onCreated).toHaveBeenCalledTimes(1)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it("An LLM evaluator without a provider key is blocked", async () => {
        evaluators = [JUDGE]
        await mount()
        await typeName("Support replies")
        await pickEvaluator("Helpfulness judge")

        await submit()

        expect(toast.message.error).toHaveBeenCalledWith(
            "LLM keys are required for AI Critique configuration",
        )
        expect(createRequests()).toEqual([])
        expect(onClose).not.toHaveBeenCalled()
    })
})
