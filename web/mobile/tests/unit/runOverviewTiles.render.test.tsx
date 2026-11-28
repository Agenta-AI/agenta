// @vitest-environment jsdom
import {act, createElement, type ReactNode} from "react"

import type {EvaluationMetric, RunReferences} from "@agenta/entities/evaluationRun"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {RunOverviewView} from "@/features/evaluation-run/overview/RunOverviewView"
import type {
    OverviewMetric,
    ScenarioMetricsState,
} from "@/features/evaluation-run/overview/useRunOverview"

import {
    BOOLEAN,
    CATEGORICAL,
    evaluatorMetric,
    header,
    invocationMetric,
    NUMERIC,
    RUN_ID,
} from "./runOverviewFixtures"

vi.mock("next/router", () => ({
    useRouter: () => ({pathname: "/run", query: {evaluation_id: "run-1"}}),
}))
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

let host: HTMLDivElement
let root: Root
const render = (node: ReactNode) => act(() => root.render(node))

beforeEach(() => {
    host = document.createElement("div")
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
})

const references = (stepKeys: string[]): RunReferences => ({
    applicationId: "app-1",
    variantId: null,
    revisionId: null,
    revisionVersion: null,
    testsets: [],
    evaluators: stepKeys.map((stepKey) => ({
        evaluatorId: `id-${stepKey}`,
        revisionId: null,
        slug: stepKey,
        stepKey,
    })),
    queries: [],
})

const INVOCATION = [
    invocationMetric("cost", {mean: 0.021, count: 9}),
    invocationMetric("duration", {mean: 1500, count: 9}),
    invocationMetric("tokens", {mean: 950, count: 9}),
    invocationMetric("errors", {sum: 2, count: 9}),
]

const view = ({
    metrics,
    stepKeys = ["ev-step"],
    scenarioMetrics = {status: "unavailable"},
    status = "success",
    kind = "auto",
}: {
    metrics: OverviewMetric[]
    stepKeys?: string[]
    scenarioMetrics?: ScenarioMetricsState
    status?: string
    kind?: "auto" | "online"
}) =>
    createElement(RunOverviewView, {
        runId: RUN_ID,
        header: header({status, kind}),
        references: references(stepKeys),
        metrics,
        metricsPending: false,
        metricsError: null,
        names: {
            evaluators: {"id-ev-step": "Exact match"},
            testsets: [],
            application: null,
            variant: null,
        },
        scenarioMetrics,
    })

const tile = (id: string) => host.querySelector(`[data-testid="tile-${id}"]`)?.textContent
const binaryRow = (scenario: string, values: Record<string, boolean>, extra = {}) =>
    ({
        id: `m-${scenario}`,
        run_id: RUN_ID,
        scenario_id: scenario,
        data: {
            "ev-step": Object.fromEntries(
                Object.entries(values).map(([key, value]) => [
                    `attributes.ag.data.outputs.${key}`,
                    {
                        type: "binary",
                        count: 1,
                        freq: [
                            {value: true, count: value ? 1 : 0},
                            {value: false, count: value ? 0 : 1},
                        ],
                    },
                ]),
            ),
            ...extra,
        },
    }) as EvaluationMetric

describe("run overview tiles", () => {
    it("A finished run shows the six tiles in order, with the Passed counts", () => {
        render(
            view({
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN),
                    ...INVOCATION,
                ],
                scenarioMetrics: {
                    status: "ready",
                    rows: [binaryRow("s1", {success: true}), binaryRow("s2", {success: false})],
                    failedSteps: [],
                },
            }),
        )
        const ids = Array.from(host.querySelectorAll("[data-testid^='tile-']")).map((node) =>
            node.getAttribute("data-testid"),
        )
        expect(ids).toEqual([
            "tile-testCases",
            "tile-passed",
            "tile-cost",
            "tile-duration",
            "tile-tokens",
            "tile-errors",
        ])
        expect(tile("testCases")).toBe("Test cases9all finished")
        expect(tile("passed")).toBe("Passed50%1 of 2 test cases3 of 4 assertions true")
        expect(tile("cost")).toBe("Cost$0.021per case, average")
        expect(tile("errors")).toBe("Errors2total")
    })

    it("A run with no binary metric has no Passed tile", () => {
        render(view({metrics: [evaluatorMetric("attributes.ag.data.outputs.score", NUMERIC)]}))
        expect(tile("passed")).toBeUndefined()
        expect(host.querySelectorAll("[data-testid^='tile-']")).toHaveLength(5)
    })

    it("Test cases that did not run, and no evaluator failure, show no alert", () => {
        render(
            view({
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN),
                    {...invocationMetric("duration", {mean: 1, count: 2}), stepKey: "app"},
                ],
                scenarioMetrics: {
                    status: "ready",
                    rows: [binaryRow("s1", {success: true}), binaryRow("s2", {})],
                    failedSteps: [{scenarioId: "s2", stepKey: "app"}],
                },
            }),
        )
        expect(host.querySelector('[role="alert"]')).toBeNull()
        expect(tile("testCases")).toBe("Test cases1 of 21 did not run")
    })

    it("On touch, a tap on the did not run line opens the explanation in a popover", () => {
        vi.stubGlobal("matchMedia", (query: string) => ({
            matches: query === "(pointer: coarse)",
            addEventListener() {},
            removeEventListener() {},
        }))
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            },
        )
        render(
            view({
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN),
                    {...invocationMetric("duration", {mean: 1, count: 2}), stepKey: "app"},
                ],
                scenarioMetrics: {
                    status: "ready",
                    rows: [binaryRow("s1", {success: true}), binaryRow("s2", {})],
                    failedSteps: [{scenarioId: "s2", stepKey: "app"}],
                },
            }),
        )
        const line = host.querySelector<HTMLButtonElement>('[data-testid="tile-testCases"] button')!
        expect(line.textContent).toBe("1 did not run")
        // The kit Button, not a raw <button> (design ratchet CONS-03).
        expect(line.dataset.variant).toBe("ghost")
        act(() => line.click())
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
            "1 of 2 test cases did not run, because the application returned an error.",
        )
    })

    it("The did not run explanation groups the total's digits", () => {
        vi.stubGlobal("matchMedia", (query: string) => ({
            matches: query === "(pointer: coarse)",
            addEventListener() {},
            removeEventListener() {},
        }))
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            },
        )
        render(
            view({
                metrics: [evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN)],
                scenarioMetrics: {
                    status: "ready",
                    rows: [binaryRow("s1", {success: true})],
                    failedSteps: [
                        {scenarioId: "s2", stepKey: "app"},
                        ...Array.from({length: 999}, (_, i) => ({
                            scenarioId: `x${i}`,
                            stepKey: "app",
                        })),
                    ],
                },
            }),
        )
        act(() =>
            host.querySelector<HTMLButtonElement>('[data-testid="tile-testCases"] button')!.click(),
        )
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
            "1000 of 1,001 test cases did not run",
        )
    })

    it("Without per-test-case rows the Passed tile shows a dash and the assertions line", () => {
        render(view({metrics: [evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN)]}))
        expect(tile("passed")).toBe("Passed—3 of 4 assertions true")
    })

    it("An errors run says some test cases failed; an online run counts traces", () => {
        render(view({metrics: INVOCATION, status: "errors"}))
        expect(tile("testCases")).toContain("some test cases failed to run")
        render(view({metrics: INVOCATION, kind: "online"}))
        expect(tile("testCases")).toMatch(/^Traces/)
        expect(tile("cost")).toContain("per trace, average")
    })

    it("An online run with only its latest time bucket shows no trace count", () => {
        const bucketOnly = INVOCATION.map((metric) => ({...metric, statsAreRunWide: false}))
        render(view({metrics: bucketOnly, kind: "online"}))
        expect(tile("testCases")).toMatch(/^Traces—/)
        expect(tile("cost")).toBe("Cost—per trace, average")
    })

    it("Failed test cases show the evaluator alert, the ran count and the no result part of a cell", () => {
        render(
            view({
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN),
                    {...invocationMetric("duration", {mean: 1, count: 3}), stepKey: "app"},
                ],
                scenarioMetrics: {
                    status: "ready",
                    // s2 did not run: its evaluator value does not count in "Passed".
                    rows: [
                        binaryRow("s1", {success: true}),
                        binaryRow("s2", {success: false}),
                        binaryRow("s3", {}),
                    ],
                    failedSteps: [
                        {scenarioId: "s2", stepKey: "app"},
                        {scenarioId: "s3", stepKey: "ev-step"},
                    ],
                },
            }),
        )
        // Test cases that did not run are told by the tile, not by the alert.
        const alert = host.querySelector('[role="alert"]')?.textContent ?? ""
        expect(alert).toContain(
            "1 test case has no result from one evaluator, because the evaluator failed.",
        )
        expect(alert).toContain("The numbers below count only the results that exist.")
        expect(alert).not.toContain("did not run")
        expect(host.querySelector('[role="alert"] a')?.textContent).toBe("Show test cases")
        expect(tile("testCases")).toBe("Test cases2 of 31 did not run")
        const notRun = host.querySelector<HTMLElement>(
            '[data-testid="tile-testCases"] [tabindex="0"]',
        )!
        expect(notRun.className).toContain("decoration-dotted")
        // The tooltip content measures itself; jsdom has no ResizeObserver.
        vi.stubGlobal(
            "ResizeObserver",
            class {
                observe() {}
                unobserve() {}
                disconnect() {}
            },
        )
        act(() => notRun.focus())
        const tooltip = document.querySelector('[role="tooltip"]')?.textContent ?? ""
        expect(tooltip).toContain(
            "1 of 3 test cases did not run, because the application returned an error.",
        )
        expect(tooltip).toContain(
            "A test case that did not run counts as neither passed nor failed.",
        )
        expect(tile("passed")).toContain("1 of 1 that ran")
        expect(tile("errors")).toBe("Errors21 runs, 1 evaluator")
        expect(host.textContent).toContain("3 of 4, 1 no result")
        expect(host.querySelector('[data-segment="noResult"]')).not.toBeNull()
    })
})

describe("run overview tiles: counts and incomplete data", () => {
    it("Counts in the tiles use the locale's digit grouping", () => {
        const notRun = Array.from({length: 1000}, (_, i) => ({scenarioId: `x${i}`, stepKey: "app"}))
        render(
            view({
                metrics: [evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN)],
                scenarioMetrics: {
                    status: "ready",
                    rows: [binaryRow("s1", {success: true})],
                    failedSteps: notRun,
                },
            }),
        )
        expect(tile("testCases")).toMatch(/^Test cases1 of 1,001/)
    })

    it("When the failed steps fill the page, Passed shows a dash, not a count that may hold cases that did not run", () => {
        // s2's application failed, but its failed step is past the page of 5000 failed steps.
        const evaluatorFailures = Array.from({length: 5000}, (_, i) => ({
            scenarioId: `e${i}`,
            stepKey: "ev-step",
        }))
        render(
            view({
                metrics: [evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN)],
                scenarioMetrics: {
                    status: "ready",
                    rows: [binaryRow("s1", {success: true}), binaryRow("s2", {success: true})],
                    failedSteps: evaluatorFailures,
                },
            }),
        )
        expect(tile("passed")).toBe("Passed—3 of 4 assertions true")
    })

    it("A test case that did not run counts as neither passed nor failed", () => {
        render(
            view({
                metrics: [evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN)],
                scenarioMetrics: {
                    status: "ready",
                    rows: [
                        binaryRow("s1", {success: true}),
                        binaryRow("s2", {success: true}),
                        binaryRow("s3", {success: false}),
                    ],
                    failedSteps: [
                        {scenarioId: "s2", stepKey: "app"},
                        {scenarioId: "s3", stepKey: "app"},
                    ],
                },
            }),
        )
        expect(tile("passed")).toContain("100%1 of 1 that ran")
    })
})

describe("evaluator table", () => {
    it("One row per evaluator: binary, numeric, then categorical, text left out", () => {
        render(
            view({
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.reason", {
                        type: "string",
                        count: 4,
                    }),
                    evaluatorMetric("attributes.ag.data.outputs.tone", CATEGORICAL),
                    evaluatorMetric("attributes.ag.data.outputs.score", NUMERIC),
                    evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN),
                ],
            }),
        )
        const row = host.querySelector('[data-testid="evaluator-ev-step"]')
        expect(row?.textContent).toContain("Exact match3 metrics")
        const cells = Array.from(row?.querySelectorAll("[data-testid^='metric-']") ?? [])
        expect(cells.map((cell) => cell.getAttribute("data-testid"))).toEqual([
            "metric-ev-step:attributes.ag.data.outputs.success",
            "metric-ev-step:attributes.ag.data.outputs.score",
            "metric-ev-step:attributes.ag.data.outputs.tone",
        ])
        expect(host.textContent).not.toContain("reason")
        expect(host.textContent).not.toContain("not summarized")
    })

    it("Cells: a pass bar with its count, a histogram from the server bins, category shares", () => {
        render(
            view({
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN),
                    evaluatorMetric("attributes.ag.data.outputs.score", NUMERIC),
                    evaluatorMetric("attributes.ag.data.outputs.tone", CATEGORICAL),
                ],
            }),
        )
        const cell = (label: string) =>
            host.querySelector(`[data-testid="metric-ev-step:attributes.ag.data.outputs.${label}"]`)

        expect(cell("success")?.textContent).toBe("success75% 3 of 4")
        expect(cell("success")?.querySelector('[role="img"]')?.getAttribute("title")).toBe(
            "3 passed, 1 failed",
        )
        // The text after the axis ends is the histogram's hidden accessible description.
        expect(cell("score")?.textContent).toMatch(/^score0\.75 mean0\.51(0\.5 to 0\.75)/)
        expect(cell("score")?.querySelector("[data-bar='0']")?.getAttribute("title")).toBe(
            "0.5 to 0.75: 2 of 4 test cases",
        )
        expect(cell("tone")?.textContent).toContain("friendly 50%, neutral 33%, curt 17%")
        const legend = host.textContent ?? ""
        expect(legend).toContain("Failed")
        expect(legend).toContain("Score distribution: bar height is the share of test cases")
    })

    it("Every histogram on 0 to 1 gets the long legend", () => {
        render(
            view({
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.score", {
                        ...NUMERIC,
                        hist: [
                            {count: 2, interval: [0, 0.5]},
                            {count: 2, interval: [0.5, 1]},
                        ],
                    }),
                ],
            }),
        )
        expect(host.textContent).toContain(
            "Score distribution: every chart goes from 0 to 1, and bar height is the share of test cases",
        )
    })

    it("A step with no values yet shows No results yet; a step with only text metrics has no row", () => {
        render(
            view({
                stepKeys: ["ev-step", "empty", "notes"],
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.success", BOOLEAN),
                    evaluatorMetric(
                        "attributes.ag.data.outputs.reason",
                        {type: "string", count: 4},
                        {id: "notes:reason", stepKey: "notes"},
                    ),
                ],
            }),
        )
        expect(host.querySelector('[data-testid="evaluator-empty"]')?.textContent).toBe(
            "emptyNo results yet",
        )
        expect(host.querySelector('[data-testid="evaluator-notes"]')).toBeNull()
    })

    it("A run whose evaluators report only text metrics shows the empty state, not an empty table", () => {
        render(
            view({
                metrics: [
                    evaluatorMetric("attributes.ag.data.outputs.reason", {
                        type: "string",
                        count: 4,
                    }),
                ],
            }),
        )
        expect(host.textContent).toContain("No metric values generated")
        expect(host.querySelector('[data-testid^="evaluator-"]')).toBeNull()
    })
})
