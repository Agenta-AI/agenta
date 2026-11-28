// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import {annotationSessionController} from "@agenta/annotation"
import type {RunHeader} from "@agenta/entities/evaluationRun"
import {setUserAtoms} from "@agenta/entities/shared"
import {closeTraceDrawerAtom} from "@agenta/observability/traceDrawer"
import {projectIdAtom, sessionAtom, userAtom} from "@agenta/shared/state"
import {QueryClient, QueryClientProvider} from "@tanstack/react-query"
import {atom, getDefaultStore, Provider, useAtomValue} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest"

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

const evaluationsClient = vi.hoisted(() => ({addSteps: vi.fn(), openRun: vi.fn()}))
vi.mock("@agenta/sdk/resources", async (original) => ({
    ...(await original<typeof import("@agenta/sdk/resources")>()),
    getEvaluationsClient: () => evaluationsClient,
}))

const router = vi.hoisted(() => ({query: {} as Record<string, string>, replace: vi.fn()}))
vi.mock("next/router", () => ({
    useRouter: () => ({
        query: router.query,
        pathname: "/w/[workspace_id]/p/[project_id]/evaluations/results/[evaluation_id]",
        replace: router.replace,
    }),
}))
vi.mock("@/features/developer/developerViewAccess", () => ({
    useDeveloperViewEnabled: (viewId: string) => viewId === "testsets",
}))

const permissions = vi.hoisted(() => ({
    allowed: new Set(["edit_annotations", "edit_evaluation_runs", "edit_testsets"]),
}))
vi.mock("@/features/context/useProjectPermission", () => ({
    useProjectPermission: (_projectId: string, action: string) => permissions.allowed.has(action),
}))

const expected = vi.hoisted(() => ({key: null as string | null}))
vi.mock("@/features/evaluation-run/focus/useExpectedColumn", () => ({
    useExpectedColumn: () => expected.key,
}))

// The panel is its own chunk in the app; here it loads when the drawer module loads, and draws
// from the first render after that.
vi.mock("next/dynamic", async () => {
    const {createElement: create, useEffect, useState} = await import("react")
    return {
        default: (loader: () => Promise<unknown>) => {
            const loading = loader().then(
                (module) => ((module as {default?: unknown}).default ?? module) as never,
            )
            let Loaded: ((props: object) => ReactNode) | null = null
            void loading.then((component) => {
                Loaded = component
            })
            return (props: object) => {
                const [Component, setComponent] = useState(() => Loaded)
                useEffect(() => {
                    if (!Component) void loading.then((component) => setComponent(() => component))
                }, [Component])
                return Component ? create(Component, props) : null
            }
        },
    }
})

const session = vi.hoisted(() => ({onSaved: vi.fn()}))
vi.mock("@/features/evaluation-run/focus/useRunAnnotationSession", async () => {
    const {useEffect} = await import("react")
    const {useSetAtom} = await import("jotai")
    const {annotationSessionController: controller} = await import("@agenta/annotation")
    return {
        // The run opens in the session as the real hook does; nothing is read again after a save.
        useRunAnnotationSession: (runId: string) => {
            const openRun = useSetAtom(controller.actions.openRun)
            useEffect(() => {
                openRun({runId})
            }, [runId, openRun])
            return {isOpen: true, onSaved: session.onSaved}
        },
    }
})

const submission = vi.hoisted(() => ({submit: vi.fn()}))
vi.mock("@/features/annotations/useSubmitAnnotations", () => ({
    SUBMIT_FAILURE_TEXT: "Couldn't save the annotations",
    useSubmitAnnotations: () => ({
        submit: submission.submit,
        canSubmit: true,
        isSubmitting: false,
        isCompleted: false,
        hasPendingChanges: false,
        label: "Annotate",
    }),
}))

// The shared form is the queue's (its own tests cover it): here it lists the evaluators the
// session shows, with the panel's section actions.
vi.mock("@/features/annotations/AnnotationFormPanel", () => ({
    AnnotationFormPanel: ({sectionActions}: {sectionActions?: (slug: string) => ReactNode}) => {
        const refs = useAtomValue(annotationSessionController.selectors.evaluatorStepRefs())
        return createElement(
            "div",
            {"data-testid": "annotation-form"},
            createElement("div", null, "form header"),
            ...refs.map((ref) =>
                createElement(
                    "div",
                    {key: ref.slug, "data-testid": `form-${ref.slug}`},
                    ref.slug,
                    sectionActions?.(ref.slug ?? ""),
                ),
            ),
        )
    },
}))

vi.mock("@/features/observability/annotate/useHumanEvaluators", () => ({
    useHumanEvaluators: () => ({
        evaluators: [
            {id: "wf-reviewer", slug: "reviewer-feedback", name: "Reviewer feedback"},
            {id: "wf-tone", slug: "tone-review", name: "Tone review"},
        ],
        isLoading: false,
        isError: false,
        retry: () => undefined,
    }),
}))

import {ScenarioFocusSheet} from "@/features/evaluation-run/focus/ScenarioFocusSheet"

import {answerRequest, newServerState, type ScenarioServerState} from "./runScenariosFixtures"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

const store = getDefaultStore()
let host: HTMLDivElement
let root: Root
let counter = 0
let state: ScenarioServerState
let client: QueryClient
/** The reviews the annotation query returns. */
let storedReviews: Record<string, unknown>[] = []
/** True: creating an annotation fails. */
let failCreate = false
const posts: {url: string; body: Record<string, unknown>}[] = []

const settle = (ms = 1000) =>
    act(async () => {
        await vi.advanceTimersByTimeAsync(ms)
    })

const header = (closed = false): RunHeader => ({
    name: "Capitals check",
    description: null,
    status: "evaluation_finished",
    kind: "auto",
    flags: {isLive: false, isClosed: closed, isActive: false},
    createdAt: null,
    updatedAt: null,
    createdById: null,
})

/**
 * The fixture run made automatic (its app step has origin `auto` and a trace per scenario), on
 * version 7 of its test set, with a judge whose result has a trace and a span; `human` adds the
 * human evaluator "reviewer-feedback", with the value `good` true on sc-1 when `humanValue`.
 */
const run =
    ({human = false, humanValue = false} = {}) =>
    (
        runId: string,
        serverState: ScenarioServerState,
        url: string,
        body?: Record<string, unknown>,
    ) => {
        const answer = answerRequest(runId, serverState, url, body)
        if (url.endsWith("/evaluations/runs/query")) {
            const data = answer.data?.runs?.[0].data as {
                steps: Record<string, unknown>[]
                mappings: Record<string, unknown>[]
            }
            data.steps[0].references = {
                testset: {id: "ts-1", slug: "capitals"},
                testset_revision: {id: "tsr-7", version: 7},
            }
            data.steps[1].origin = "auto"
            data.mappings.push({
                column: {kind: "invocation", name: "answer"},
                step: {key: "app", path: "attributes.ag.data.outputs"},
            })
            if (human) {
                data.steps.push({
                    key: "app.reviewer-feedback",
                    type: "annotation",
                    origin: "human",
                    references: {evaluator: {id: "wf-reviewer", slug: "reviewer-feedback"}},
                })
                data.mappings.push({
                    column: {kind: "annotation", name: "good"},
                    step: {key: "app.reviewer-feedback", path: "attributes.ag.data.outputs.good"},
                })
            }
        }
        if (url.endsWith("/evaluations/results/query")) {
            const results = (answer.data?.results ?? []) as Record<string, unknown>[]
            for (const result of [...results]) {
                const id = result.scenario_id as string
                results.push({...result, step_key: "app", trace_id: `${id}-app-trace`})
                results.push({
                    ...result,
                    step_key: "ev",
                    trace_id: `${id}-ev-trace`,
                    span_id: `${id}-ev-span`,
                })
            }
        }
        if (url.endsWith("/testcases/query")) {
            for (const testcase of (answer.data?.testcases ?? []) as Record<string, unknown>[]) {
                testcase.set_id = "ts-1"
            }
        }
        if (url.endsWith("/evaluations/metrics/query") && humanValue) {
            for (const metric of (answer.data?.metrics ?? []) as {
                scenario_id: string
                data: Record<string, Record<string, unknown>>
            }[]) {
                if (metric.scenario_id !== "sc-1") continue
                metric.data["app.reviewer-feedback"] = {
                    "attributes.ag.data.outputs.good": {
                        type: "binary",
                        count: 1,
                        freq: [{value: true, count: 1}],
                    },
                }
            }
        }
        return answer
    }

async function mount({
    answer = run(),
    closed = false,
    patch = {},
}: {
    answer?: ReturnType<typeof run>
    closed?: boolean
    patch?: Partial<ScenarioServerState>
} = {}) {
    const runId = `run-${++counter}`
    state = newServerState({failing: ["sc-1"], ...patch})
    http.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
        posts.push({url, body})
        if (url.endsWith("/simple/traces/query")) {
            return {data: {count: storedReviews.length, traces: storedReviews}}
        }
        if (url.endsWith("/simple/traces/")) {
            if (failCreate) throw new Error("Request failed with status code 500")
            const trace = (body as {trace: Record<string, unknown>}).trace
            return {data: {count: 1, trace: {...trace, trace_id: "new", span_id: "new"}}}
        }
        if (url.endsWith("/testsets/revisions/commit")) {
            return {data: {testset_revision: {id: "tsr-8", version: 8}}}
        }
        return answer(runId, state, url, body)
    })
    client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    store.set(queryClientAtom, client)
    router.query = {
        workspace_id: "ws",
        project_id: "pr",
        focusScenarioId: "sc-1",
        focusRunId: runId,
        tab: "scenarios",
    }
    await act(async () =>
        root.render(
            createElement(
                Provider,
                {store},
                createElement(
                    QueryClientProvider,
                    {client},
                    createElement(ScenarioFocusSheet, {runId, header: header(closed), poll: false}),
                ),
            ),
        ),
    )
    await settle()
    await settle()
    return runId
}

const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement
const panel = () =>
    document.body.querySelector('aside[aria-label="Annotate"]') as HTMLElement | null
const section = (label: string) =>
    document.body.querySelector(`[aria-label="${label}"]`) as HTMLElement
const buttons = () => [...document.body.querySelectorAll<HTMLElement>("button")]
const buttonNamed = (name: string) =>
    buttons().find(
        (button) => button.textContent === name || button.getAttribute("aria-label") === name,
    ) as HTMLElement
const press = async (name: string) => {
    await act(async () => {
        buttonNamed(name).click()
    })
    await settle()
}
const openTab = (name: string) =>
    act(async () => {
        const tab = [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')].find(
            (candidate) => candidate.textContent === name,
        ) as HTMLElement
        tab.dispatchEvent(new MouseEvent("mousedown", {bubbles: true, button: 0}))
    })
const typeInto = (input: HTMLInputElement | HTMLTextAreaElement, value: string) =>
    act(async () => {
        const proto = Object.getPrototypeOf(input)
        Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(input, value)
        input.dispatchEvent(new Event("input", {bubbles: true}))
    })
const creates = () => posts.filter(({url}) => url.endsWith("/simple/traces/"))

/** A stored review of the judge on sc-1. */
const review = (verdict: "agree" | "disagree", author: string) => ({
    trace_id: `review-${author}`,
    span_id: `review-${author}-span`,
    data: {outputs: {success: verdict === "agree" ? false : true}},
    references: {evaluator: {id: "ev-1", slug: "exact-match"}},
    links: {invocation: {trace_id: "sc-1-ev-trace", span_id: "sc-1-ev-span"}},
    origin: "human",
    meta: {name: "Exact Match", verdict},
    created_by_id: author,
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
})

beforeAll(async () => {
    // The panel's chunk is ready before the first click, as after the app has loaded it once.
    await import("@/features/evaluation-run/focus/ScenarioFocusAnnotatePanel")
})

beforeEach(() => {
    vi.useFakeTimers()
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
    store.set(projectIdAtom, "pr")
    store.set(sessionAtom, true)
    store.set(userAtom, {id: "u-me"} as never)
    setUserAtoms({
        membersAtom: atom([{user: {id: "u-dana", username: "Dana"}}]),
        currentUserAtom: atom({id: "u-me", username: "Sam"}),
    })
    Object.values(http).forEach((fn) => fn.mockReset())
    evaluationsClient.addSteps.mockReset().mockResolvedValue({run: {id: "run"}})
    evaluationsClient.openRun.mockReset().mockResolvedValue({run: {id: "run"}})
    submission.submit.mockReset()
    session.onSaved.mockReset()
    permissions.allowed = new Set(["edit_annotations", "edit_evaluation_runs", "edit_testsets"])
    expected.key = null
    storedReviews = []
    failCreate = false
    posts.length = 0
    store.set(closeTraceDrawerAtom)
    // The app traces hold the output "Paris"; the trace API is read with fetch.
    const appTrace = (traceId: string) => ({
        trace_id: traceId,
        spans: {
            root: {
                trace_id: traceId,
                span_id: "root",
                span_type: "agent",
                span_name: "root",
                start_time: "2026-11-19T19:21:00.000Z",
                end_time: "2026-11-19T19:21:01.000Z",
                attributes: {ag: {data: {inputs: {}, outputs: "Paris"}}},
            },
        },
    })
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
        const url = String(input instanceof Request ? input.url : input)
        const ids = state.ids.map((id) => `${id}-app-trace`)
        const body = url.includes("/traces/query")
            ? {count: ids.length, traces: ids.map(appTrace)}
            : {count: 1, trace: appTrace(url.match(/\/traces\/([^/?]+)/)?.[1] ?? "")}
        return new Response(JSON.stringify(body), {headers: {"content-type": "application/json"}})
    })
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
})

describe("Annotate panel in the test case drawer", () => {
    it("Without edit_annotations there is no Annotate button, and the marks stay", async () => {
        permissions.allowed.delete("edit_annotations")
        storedReviews = [review("disagree", "u-me")]
        await mount()
        expect(buttonNamed("Annotate")).toBeUndefined()
        await openTab("Results")
        await settle()
        expect(section("Evaluators").textContent).toContain("Disagreed")
    })

    it("Annotate opens the panel with its three parts and an empty Annotations part", async () => {
        await mount()
        await press("Annotate")
        await settle()
        const aside = panel() as HTMLElement
        expect(aside).not.toBeNull()
        expect(aside.textContent).toContain("No annotations yet")
        expect(aside.textContent).toContain("Pick a human evaluator to annotate this test case.")
        expect(section("Evaluator results").textContent).toContain("0 of 1 failed reviewed")
        expect(section("Test case").textContent).toContain(", version 7")
        expect(dialog().className).toContain("1100px")
        await press("Close annotations")
        expect(panel()).toBeNull()
    })

    it("The picker marks the run's evaluators and a checkbox acts at once", async () => {
        await mount({answer: run({human: true})})
        await press("Annotate")
        expect(document.querySelector('[data-testid="form-reviewer-feedback"]')).not.toBeNull()
        await press("Add evaluator")
        const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="evaluator-row"]')]
        expect(rows.map((row) => row.textContent)).toEqual([
            "Reviewer feedbackIn this run",
            "Tone reviewMetric",
        ])
        await act(async () => {
            rows[0].querySelector<HTMLElement>("button")?.click()
        })
        expect(document.querySelector('[data-testid="form-reviewer-feedback"]')).toBeNull()
        await act(async () => {
            rows[0].querySelector<HTMLElement>("button")?.click()
        })
        expect(document.querySelector('[data-testid="form-reviewer-feedback"]')).not.toBeNull()
    })

    it("Without edit_evaluation_runs the picker lists only the run's evaluators", async () => {
        permissions.allowed.delete("edit_evaluation_runs")
        await mount({answer: run({human: true})})
        await press("Annotate")
        await press("Add evaluator")
        const rows = document.querySelectorAll('[data-testid="evaluator-row"]')
        expect([...rows].map((row) => row.textContent)).toEqual(["Reviewer feedbackIn this run"])
    })

    it("A new evaluator is added to the run on Save, before anything is saved", async () => {
        await mount()
        client.setQueryData(["workflows", "latestRevision", "wf-tone", "pr"], {
            id: "rev-tone",
            workflow_id: "wf-tone",
            workflow_variant_id: "var-tone",
        })
        await press("Annotate")
        await press("Add evaluator")
        const tone = [...document.querySelectorAll<HTMLElement>('[data-testid="evaluator-row"]')][1]
        await act(async () => {
            tone.querySelector<HTMLElement>("button")?.click()
        })
        expect(document.querySelector('[data-testid="form-tone-review"]')).not.toBeNull()
        expect(panel()?.textContent).toContain(
            "New in this run. The other test cases show it empty until someone fills it.",
        )
        const order: string[] = []
        evaluationsClient.addSteps.mockImplementation(async () => {
            order.push("steps")
            return {run: {id: "run"}}
        })
        await press("Agree")
        const base = http.post.getMockImplementation()
        http.post.mockImplementation(async (url: string, body: Record<string, unknown>) => {
            if (url.endsWith("/simple/traces/")) order.push("review")
            return base?.(url, body)
        })
        await press("Save")
        expect(evaluationsClient.addSteps).toHaveBeenCalledWith(
            {
                evaluation_id: expect.any(String),
                steps: [
                    {
                        key: "app.tone-review",
                        type: "annotation",
                        origin: "human",
                        references: {},
                        inputs: [{key: "ts"}, {key: "app"}],
                    },
                ],
            },
            {queryParams: {project_id: "pr"}},
        )
        expect(order).toEqual(["steps", "review"])
    })

    it("A test case with no app output asks to run the invocation first", async () => {
        const noApp: ReturnType<typeof run> = (runId, serverState, url, body) => {
            const answer = run()(runId, serverState, url, body)
            if (url.endsWith("/evaluations/results/query")) {
                const results = (answer.data?.results ?? []) as Record<string, unknown>[]
                answer.data!.results = results.filter(
                    (result) => result.step_key !== "app",
                ) as never
            }
            return answer
        }
        await mount({answer: noApp})
        await press("Annotate")
        expect(panel()?.textContent).toContain(
            "Run the invocation to generate output before annotating.",
        )
        expect(buttonNamed("Add evaluator")).toBeUndefined()
    })

    it("Disagree opens the corrected value and a note, and Save stores one review", async () => {
        await mount()
        await press("Annotate")
        expect(buttonNamed("Save").hasAttribute("disabled")).toBe(true)
        await press("Disagree")
        const reviews = section("Evaluator results")
        expect(reviews.textContent).toContain("1 of 1 failed reviewed")
        expect(reviews.textContent).toContain("Corrected value")
        expect(reviews.textContent).toContain("success")
        expect(reviews.textContent).toContain("Note")
        await typeInto(reviews.querySelector("textarea") as HTMLTextAreaElement, "Too strict.")
        expect(panel()?.textContent).toContain("1 change to this test case")
        await press("Save")
        expect(creates()).toHaveLength(1)
        const trace = creates()[0].body.trace as Record<string, unknown>
        expect(trace.meta).toEqual({name: "Exact Match", verdict: "disagree", note: "Too strict."})
        expect(trace.origin).toBe("human")
        expect(trace.links).toEqual({
            invocation: {trace_id: "sc-1-ev-trace", span_id: "sc-1-ev-span"},
        })
        expect((trace.references as Record<string, unknown>).testset_revision).toEqual({
            id: "tsr-7",
        })
        expect(evaluationsClient.addSteps).not.toHaveBeenCalled()
        expect(submission.submit).not.toHaveBeenCalled()
    })

    it("A failed save says so with Try again and keeps the change", async () => {
        failCreate = true
        await mount()
        await press("Annotate")
        await press("Agree")
        await press("Save")
        expect(panel()?.textContent).toContain("Couldn't save the annotations")
        expect(panel()?.textContent).toContain("1 change to this test case")
        failCreate = false
        await act(async () => {
            ;[...(panel() as HTMLElement).querySelectorAll("button")]
                .find((button) => button.textContent === "Try again")
                ?.click()
        })
        await settle()
        expect(creates()).toHaveLength(2)
        expect(panel()?.textContent).not.toContain("Couldn't save the annotations")
    })

    it("Human values show on their own line and in their group, apart from Passed", async () => {
        await mount({answer: run({human: true, humanValue: true})})
        const header = dialog().querySelector('[data-slot="sheet-header"]') as HTMLElement
        expect(header.textContent).toContain("0 of 1")
        expect(header.textContent).toContain("1 human annotation")
        expect(header.textContent).toContain("Good")
        await openTab("Results")
        const human = section("Human annotations")
        expect(human.textContent).toContain("Not counted in Passed")
        expect(human.textContent).toContain("Human")
    })

    it("An empty human evaluator reads No value yet and opens the panel", async () => {
        await mount({answer: run({human: true})})
        await openTab("Results")
        expect(section("Human annotations").textContent).toContain("No value yet")
        await press("No value yet")
        expect(panel()).not.toBeNull()
    })

    it("The own mark opens the panel at that judge; others' reviews show as a count", async () => {
        storedReviews = [review("disagree", "u-me"), review("agree", "u-dana")]
        await mount()
        await openTab("Results")
        await settle()
        const row = section("Evaluators")
        expect(row.textContent).toContain("Disagreed")
        expect(row.textContent).toContain("2 reviews")
        await press("Disagreed")
        expect(panel()).not.toBeNull()
        const focused = document.querySelector('[data-testid^="review-"]') as HTMLElement
        expect(focused.className).toContain("bg-selected")
        // The own review loads into the panel.
        expect(section("Evaluator results").textContent).toContain("Corrected value")
    })

    it("Edit fields edits the test case in place, and Save to test set makes a version", async () => {
        await mount()
        await press("Annotate")
        await press("Edit fields")
        const input = dialog().querySelector(
            'textarea[aria-label="country"]',
        ) as HTMLTextAreaElement
        await typeInto(input, "Paris")
        const part = section("Test case")
        expect(part.textContent).toContain("1 field edited: country")
        expect(part.textContent).toContain("Not saved yet. Goes to a new version of")
        expect(section("Inputs").textContent).toContain("Edited")
        // The test case change is not one of the panel's Save.
        expect(buttonNamed("Save").hasAttribute("disabled")).toBe(true)
        await press("Save to test set")
        const commit = posts.find(({url}) => url.endsWith("/testsets/revisions/commit"))
        expect(commit?.body).toMatchObject({
            testset_revision: {
                testset_id: "ts-1",
                revision_id: "tsr-7",
                delta: {rows: {replace: [{id: "tc-sc-1", data: {country: "Paris"}}]}},
            },
        })
        expect(part.textContent).toContain("as version 8.")
        expect(part.textContent).toContain("The next run can use it.")
        expect(part.textContent).toContain("This run keeps version 7. Its scores do not change.")
        expect(part.textContent).toContain("Open test set")
    })

    it("Use as reference writes the output to the expected column, with Undo", async () => {
        expected.key = "reference_output"
        await mount()
        await press("Annotate")
        expect(section("Test case").textContent).toContain(
            "Writes it to the column reference_output",
        )
        await press("Use as reference")
        const output = section("Output")
        expect(output.textContent).toContain("Reference")
        expect(output.textContent).toContain("Undo")
        expect(section("Test case").textContent).toContain("Not saved yet.")
        await press("Undo")
        expect(section("Output").textContent).toContain("Use as reference")
    })

    it("Unsaved test case changes stop Next and Close until the user picks", async () => {
        await mount()
        await press("Annotate")
        await press("Edit fields")
        await typeInto(
            dialog().querySelector('textarea[aria-label="country"]') as HTMLTextAreaElement,
            "Paris",
        )
        await press("Next")
        expect(document.body.textContent).toContain("Your test case changes are not saved")
        await press("Keep editing")
        expect(router.query.focusScenarioId).toBe("sc-1")
        await press("Close annotations")
        expect(document.body.textContent).toContain("Your test case changes are not saved")
        await press("Keep editing")
        expect(panel()).not.toBeNull()
        await press("Next")
        await press("Discard changes")
        expect(router.replace).toHaveBeenCalled()
        const target = router.replace.mock.calls.at(-1)?.[0] as {query: Record<string, string>}
        expect(target.query.focusScenarioId).toBe("sc-2")
    })

    it("A closed run is read only and offers Reopen run", async () => {
        await mount({closed: true})
        await press("Annotate")
        expect(panel()?.textContent).toContain("This run is closed. Reopen it to add feedback.")
        expect(buttonNamed("Save")).toBeUndefined()
        await press("Reopen run")
        expect(evaluationsClient.openRun).toHaveBeenCalledWith(
            {run_id: expect.any(String)},
            {queryParams: {project_id: "pr"}},
        )
    })
})
