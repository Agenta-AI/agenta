import {normalizeMetricStats, type RunHeader} from "@agenta/entities/evaluationRun"

import type {OverviewMetric} from "@/features/evaluation-run/overview/useRunOverview"

export const RUN_ID = "run-1"

export const header = (patch: Partial<RunHeader> = {}): RunHeader => ({
    name: "Capitals check",
    description: null,
    status: "evaluation_finished",
    kind: "auto",
    flags: {isLive: false, isClosed: false, isActive: false},
    createdAt: "2026-10-30T09:00:00Z",
    updatedAt: "2026-10-30T09:30:00Z",
    createdById: "user-1",
    ...patch,
})

export const evaluatorMetric = (
    metricKey: string,
    raw: Record<string, unknown>,
    patch: Partial<OverviewMetric> = {},
): OverviewMetric => ({
    id: `ev-step:${metricKey}`,
    kind: "evaluator",
    stepKey: "ev-step",
    metricKey,
    label: metricKey.replace("attributes.ag.data.outputs.", ""),
    evaluatorId: "ev-1",
    evaluatorSlug: "exact-match",
    evaluatorName: "Exact match",
    stats: normalizeMetricStats(raw),
    temporal: [],
    ...patch,
})

export const invocationMetric = (
    id: "cost" | "duration" | "tokens" | "errors",
    raw: Record<string, unknown> | null,
): OverviewMetric => ({
    id,
    kind: "invocation",
    stepKey: raw ? "app-step" : null,
    metricKey: `attributes.ag.metrics.${id}`,
    label: {cost: "Cost", duration: "Duration", tokens: "Tokens", errors: "Errors"}[id],
    evaluatorId: null,
    evaluatorSlug: null,
    evaluatorName: null,
    stats: raw ? normalizeMetricStats(raw) : null,
    temporal: [],
})

export const BOOLEAN = {
    type: "binary",
    count: 4,
    freq: [
        {value: true, count: 3},
        {value: false, count: 1},
    ],
}
export const NUMERIC = {
    type: "numeric/continuous",
    count: 4,
    mean: 0.75,
    min: 0.5,
    max: 1,
    hist: [
        {count: 2, interval: [0.5, 0.75]},
        {count: 2, interval: [0.75, 1]},
    ],
}
export const CATEGORICAL = {
    type: "categorical/single",
    count: 6,
    freq: [
        {value: "friendly", count: 3},
        {value: "neutral", count: 2},
        {value: "curt", count: 1},
    ],
}
