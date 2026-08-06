/**
 * Integration tests for the Annotations service.
 * Tests create/query/get round-trip.
 */

import {describe, it, expect, beforeAll} from "vitest"

import type {Agenta} from "@src/index.js"

import {canRun, createTestClient} from "./setup.js"

describe.skipIf(!canRun)("sdk: annotations", () => {
    let ag: Agenta

    beforeAll(async () => {
        ag = await createTestClient()
    })

    it("queries annotations", async () => {
        const result = await ag.annotations.query({
            windowing: {limit: 5},
        })

        expect(result.count).toBeGreaterThanOrEqual(0)
        expect(Array.isArray(result.annotations)).toBe(true)
    })

    describe("create → query round-trip (requires traces)", () => {
        it("creates and retrieves an annotation if traces exist", async () => {
            // Find a trace to annotate
            const spans = await ag.tracing.querySpans({
                windowing: {limit: 1, order: "descending"},
            })

            if (spans.spans.length === 0) {
                // No traces on this instance — skip gracefully
                return
            }

            const traceId = spans.spans[0].trace_id!
            const spanId = spans.spans[0].span_id

            // Create an annotation (data, references, and links are all required)
            const created = await ag.annotations.create({
                origin: "human",
                kind: "adhoc",
                channel: "sdk",
                data: {
                    outputs: {score: 0.9, feedback: "Good response"},
                },
                references: {},
                links: {
                    invocation: {trace_id: traceId, span_id: spanId},
                },
                meta: {
                    name: "SDK Integration Test Annotation",
                    tags: ["score", "feedback"],
                },
            })

            expect(created.count).toBeGreaterThanOrEqual(1)
            expect(created.annotation).toBeDefined()

            // Query back
            const queried = await ag.annotations.query({
                annotationLinks: [{trace_id: traceId}],
            })

            expect(queried.count).toBeGreaterThanOrEqual(1)
            expect(queried.annotations.length).toBeGreaterThanOrEqual(1)
        })
    })

    it("getForTraces returns annotations for multiple traces", async () => {
        const spans = await ag.tracing.querySpans({
            windowing: {limit: 3, order: "descending"},
        })

        if (spans.spans.length === 0) return

        const traceIds = [...new Set(spans.spans.map((s) => s.trace_id!).filter(Boolean))]
        const annotations = await ag.annotations.getForTraces(traceIds)

        // May be empty if no annotations exist — that's fine, just shouldn't error
        expect(Array.isArray(annotations)).toBe(true)
    })
})
