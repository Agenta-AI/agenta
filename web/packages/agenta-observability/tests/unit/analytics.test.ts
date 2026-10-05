import type {MetricsBucket, TraceSpan} from "@agenta/entities/trace"
import {describe, expect, it} from "vitest"

import {categorizeFailure} from "../../src/analytics/failureReasons"
import {formatMetric, niceMax} from "../../src/analytics/format"
import {filterConditions} from "../../src/analytics/queries"
import {defaultRange, planRetention} from "../../src/analytics/ranges"
import {
    OTHER_KEY,
    bucketWindow,
    keyedSeries,
    rangeWindow,
    toOverview,
    toAnalyticsRun,
    toolsByRun,
    topSeries,
} from "../../src/analytics/transform"

const DAY = 86_400_000
const window = {oldest: Date.UTC(2026, 9, 1), newest: Date.UTC(2026, 9, 4), interval: 1440}
const at = (day: number) => new Date(window.oldest + day * DAY).toISOString()

describe("rangeWindow", () => {
    it("ends 24h at the next full hour, in hourly buckets", () => {
        const now = Date.UTC(2026, 9, 2, 12, 40)
        expect(rangeWindow("24h", now)).toEqual({
            oldest: Date.UTC(2026, 9, 1, 13),
            newest: Date.UTC(2026, 9, 2, 13),
            interval: 60,
        })
    })

    it("spans whole local days ending after today", () => {
        const w = rangeWindow("7d", new Date(2026, 9, 2, 12, 40).getTime())
        expect(w.newest).toBe(new Date(2026, 9, 3).getTime())
        expect(w.oldest).toBe(new Date(2026, 8, 26).getTime())
        expect(w.interval).toBe(1440)
    })

    it("splits a day bucket by hour and an hour bucket by five minutes", () => {
        expect(bucketWindow(window, 1)).toEqual({
            oldest: window.oldest + DAY,
            newest: window.oldest + 2 * DAY,
            interval: 60,
        })
        expect(bucketWindow({oldest: 0, newest: 3_600_000, interval: 60}, 0).interval).toBe(5)
    })
})

describe("toOverview", () => {
    const overview: MetricsBucket[] = [
        {
            timestamp: at(0),
            interval: 1440,
            metrics: {
                "attributes.ag.metrics.costs.cumulative.total": {count: 2, sum: 1.5},
                "attributes.ag.metrics.tokens.cumulative.prompt": {count: 2, sum: 100},
                "attributes.ag.metrics.tokens.cumulative.total": {count: 2, sum: 160},
                "attributes.ag.type.trace": {count: 3, freq: [{value: "invocation", count: 3}]},
            },
        },
        {timestamp: at(2), interval: 1440, metrics: {"attributes.ag.type.trace": {count: 1}}},
    ]
    const failed: MetricsBucket[] = [
        {timestamp: at(0), interval: 1440, metrics: {"attributes.ag.type.trace": {count: 1}}},
    ]

    it("fills every bucket and totals runs, failures, cost and tokens", () => {
        const result = toOverview(window, overview, failed)
        expect(result.points.map((p) => p.runs)).toEqual([3, 0, 1])
        expect(result.points.map((p) => p.failed)).toEqual([1, 0, 0])
        expect(result.totals).toEqual({
            cost: 1.5,
            runs: 4,
            failed: 1,
            input: 100,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            tokens: 160,
        })
    })
})

describe("keyedSeries and topSeries", () => {
    const buckets: MetricsBucket[] = [
        {
            timestamp: at(0),
            interval: 1440,
            metrics: {
                "attributes.ag.references.application.id": {
                    freq: [
                        {value: "a", count: 5},
                        {value: "b", count: 2},
                    ],
                },
                "attributes.ag.references.workflow.id": {freq: [{value: "a", count: 1}]},
            },
        },
        {
            timestamp: at(1),
            interval: 1440,
            metrics: {
                "attributes.ag.references.application.id": {freq: [{value: "c", count: 4}]},
            },
        },
    ]
    const paths = [
        "attributes.ag.references.application.id",
        "attributes.ag.references.workflow.id",
    ]

    it("merges both reference keys into one count per agent per bucket", () => {
        expect(keyedSeries(window, buckets, paths)).toEqual({
            a: [6, 0, 0],
            b: [2, 0, 0],
            c: [0, 4, 0],
        })
    })

    it("keeps the top keys and folds the rest into other", () => {
        const series = keyedSeries(window, buckets, paths)
        expect(topSeries(series, ["a", "c", "b"], 2)).toEqual([
            {key: "a", values: [6, 0, 0]},
            {key: "c", values: [0, 4, 0]},
            {key: OTHER_KEY, values: [2, 0, 0], other: true},
        ])
    })

    it("derives other from a known total when the keyed series are partial", () => {
        expect(topSeries({a: [1, 2, 0]}, ["a"], 4, [3, 2, 1])).toEqual([
            {key: "a", values: [1, 2, 0]},
            {key: OTHER_KEY, values: [2, 0, 1], other: true},
        ])
    })
})

describe("runs", () => {
    const root = {
        trace_id: "t1",
        span_id: "s1",
        start_time: "2026-10-01T10:00:00Z",
        status_code: "STATUS_CODE_ERROR",
        status_message: "ConnectError: All connection attempts failed",
        attributes: {
            ag: {
                references: {workflow: {id: "agent-1"}},
                data: {
                    parameters: {
                        agent: {llm: {model: "sonnet", connection: {mode: "self_managed"}}},
                    },
                },
                metrics: {tokens: {cumulative: {total: 900}}},
            },
        },
    } as unknown as TraceSpan

    it("reads a root span into a run", () => {
        expect(toAnalyticsRun(root)).toEqual({
            traceId: "t1",
            agentId: "agent-1",
            model: "sonnet",
            startedAt: Date.parse("2026-10-01T10:00:00Z"),
            tokens: 900,
            cost: null,
            failed: true,
            reason: "ConnectError: All connection attempts failed",
            subscription: true,
        })
    })

    it("counts tool calls and names the failed ones per run", () => {
        const tool = (status: string, name: string) =>
            ({
                trace_id: "t1",
                span_id: name,
                status_code: status,
                attributes: {ag: {meta: {tool: {name}}}},
            }) as unknown as TraceSpan
        expect(
            toolsByRun([tool("STATUS_CODE_UNSET", "Read"), tool("STATUS_CODE_ERROR", "Terminal")]),
        ).toEqual({t1: {calls: 2, failed: ["Terminal"]}})
    })
})

describe("filters, reasons, ranges, format", () => {
    it("ORs model picks because `in` on an attribute matches nothing", () => {
        expect(filterConditions({agent: ["a1"], model: ["sonnet", "haiku"]})).toEqual([
            {field: "references", operator: "in", value: [{id: "a1"}]},
            {
                operator: "or",
                conditions: [
                    {
                        field: "attributes",
                        key: "ag.data.parameters.agent.llm.model",
                        operator: "is",
                        value: "sonnet",
                    },
                    {
                        field: "attributes",
                        key: "ag.data.parameters.agent.llm.model",
                        operator: "is",
                        value: "haiku",
                    },
                ],
            },
        ])
    })

    it("maps raw run errors to readable reasons", () => {
        expect(categorizeFailure("ConnectError: All connection attempts failed").label).toBe(
            "Could not reach the model",
        )
        expect(categorizeFailure("AgentRunFailed: Sandbox acquisition was aborted.").label).toBe(
            "Sandbox did not start",
        )
        expect(
            categorizeFailure("ConnectionNotFoundError: connection 'x' not found for provider")
                .label,
        ).toBe("Missing API key / connection")
        expect(categorizeFailure("boom").label).toBe("Other error")
    })

    it("opens on the widest range the plan keeps, up to 30 days", () => {
        expect(defaultRange(planRetention("cloud_v0_hobby"))).toBe("7d")
        expect(defaultRange(planRetention("cloud_v0_business"))).toBe("7d")
        expect(defaultRange(null)).toBe("7d")
    })

    it("formats metrics for headlines and axis ticks", () => {
        expect(formatMetric("cost", 250.88)).toBe("$250.88")
        expect(formatMetric("cost", 0.0123)).toBe("$0.012")
        expect(formatMetric("tokens", 225_400_000)).toBe("225.4M")
        expect(formatMetric("success", 94.2)).toBe("94.2%")
        expect(formatMetric("runs", 3060)).toBe("3,060")
        expect(niceMax(13)).toBe(20)
        expect(formatMetric("runs", 2.5, true)).toBe("2.5")
    })
})
