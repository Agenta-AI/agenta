import {normalizeMetricStats, type RunHeader} from "@agenta/entities/evaluationRun"
import type {Meta, StoryObj} from "@storybook/nextjs"

import {RunOverviewView} from "../../../mobile/src/features/evaluation-run/overview/RunOverviewView"
import type {OverviewMetric} from "../../../mobile/src/features/evaluation-run/overview/useRunOverview"

const RUN_ID = "run-1"

const header = (patch: Partial<RunHeader> = {}): RunHeader => ({
    name: "Capitals check",
    description: null,
    status: "success",
    kind: "auto",
    flags: {isLive: false, isClosed: false, isActive: false},
    createdAt: "2026-10-30T09:00:00Z",
    updatedAt: "2026-10-30T09:30:00Z",
    createdById: "user-1",
    ...patch,
})

const evaluator = (
    name: string,
    label: string,
    raw: Record<string, unknown>,
    temporal: OverviewMetric["temporal"] = [],
): OverviewMetric => ({
    id: `${name}:${label}`,
    kind: "evaluator",
    stepKey: name,
    metricKey: `attributes.ag.data.outputs.${label}`,
    label,
    evaluatorId: name,
    evaluatorSlug: name,
    evaluatorName: name,
    stats: normalizeMetricStats(raw),
    temporal,
})

const invocation = (
    id: "cost" | "duration" | "tokens" | "errors",
    label: string,
    raw: Record<string, unknown>,
): OverviewMetric => ({
    id,
    kind: "invocation",
    stepKey: "application-geo",
    metricKey: `attributes.ag.metrics.${id}`,
    label,
    evaluatorId: null,
    evaluatorSlug: null,
    evaluatorName: null,
    stats: normalizeMetricStats(raw),
    temporal: [],
})

const BOOLEAN = {
    type: "binary",
    count: 8,
    freq: [
        {value: true, count: 6},
        {value: false, count: 2},
    ],
}
const NUMERIC = {
    type: "numeric/continuous",
    count: 8,
    mean: 0.72,
    min: 0.2,
    max: 1,
    hist: [
        {count: 1, interval: [0.2, 0.4]},
        {count: 2, interval: [0.4, 0.6]},
        {count: 5, interval: [0.8, 1]},
    ],
}
const CATEGORICAL = {
    type: "categorical/single",
    count: 8,
    freq: [
        {value: "friendly", count: 4},
        {value: "neutral", count: 3},
        {value: "curt", count: 1},
    ],
}

const INVOCATIONS = [
    invocation("cost", "Cost", {mean: 0.00042, max: 0.0009}),
    invocation("duration", "Duration", {mean: 1.84, max: 3.2}),
    invocation("tokens", "Tokens", {mean: 1250, max: 2100}),
    invocation("errors", "Errors", {sum: 1, count: 8}),
]

const meta = {
    title: "@agenta/mobile/Developer/Evaluations/RunOverview",
    component: RunOverviewView,
    parameters: {layout: "padded"},
    args: {
        runId: RUN_ID,
        header: header(),
        references: {
            applicationId: "app-1",
            variantId: "var-1",
            revisionId: "rev-1",
            revisionVersion: 3,
            testsets: [{testsetId: "ts-1", revisionId: "tsr-1"}],
            evaluators: [{evaluatorId: "Exact match", revisionId: null, slug: null, stepKey: "e"}],
            queryIds: [],
        },
        metrics: [
            evaluator("Exact match", "success", BOOLEAN),
            evaluator("Similarity", "score", NUMERIC),
            evaluator("Tone check", "tone", CATEGORICAL),
            ...INVOCATIONS,
        ],
        metricsPending: false,
        metricsError: null,
        names: {
            evaluators: {},
            testsets: ["Capitals"],
            application: "Geography bot",
            variant: "default",
        },
    },
} satisfies Meta<typeof RunOverviewView>

export default meta
type Story = StoryObj<typeof meta>

export const AutoMixed: Story = {}

export const OnlyInvocation: Story = {
    args: {metrics: INVOCATIONS.slice(0, 2)},
}

export const MetricsError: Story = {
    args: {metrics: [], metricsError: new Error("Request failed")},
}

export const Empty: Story = {
    args: {
        metrics: [],
        references: {...meta.args.references, evaluators: []},
    },
}

const point = (minute: number, trueCount: number) => ({
    timestamp: Date.UTC(2026, 9, 30, 9, minute),
    stats:
        normalizeMetricStats({
            type: "binary",
            freq: [
                {value: true, count: trueCount},
                {value: false, count: 6 - trueCount},
            ],
        }) ?? {},
})

export const Online: Story = {
    args: {
        header: header({
            name: "Support replies (live)",
            kind: "online",
            status: "running",
            flags: {isLive: true, isClosed: false, isActive: true},
        }),
        metrics: [
            evaluator("Exact match", "success", BOOLEAN, [
                point(0, 2),
                point(10, 3),
                point(20, 5),
                point(30, 4),
            ]),
            evaluator("Similarity", "score", NUMERIC),
            ...INVOCATIONS,
        ],
    },
}

export const Dark: Story = {globals: {theme: "dark"}}

export const Phone: Story = {parameters: {viewport: {defaultViewport: "mobile1"}}}
