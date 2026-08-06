/**
 * Integration tests for the Tracing service.
 */

import {describe, it, expect, beforeAll} from "vitest"

import type {Agenta} from "@src/index.js"

import {canRun, createTestClient} from "./setup.js"

describe.skipIf(!canRun)("sdk: tracing", () => {
    let ag: Agenta

    beforeAll(async () => {
        ag = await createTestClient()
    })

    it("queries spans", async () => {
        const result = await ag.tracing.querySpans({
            windowing: {limit: 5, order: "descending"},
        })

        expect(result.count).toBeGreaterThanOrEqual(0)
        expect(Array.isArray(result.spans)).toBe(true)
    })

    it("queries spans filtered by app (if apps exist)", async () => {
        const apps = await ag.applications.list()
        if (apps.length === 0) return

        const result = await ag.tracing.queryByApplication(apps[0].id!, {limit: 3})

        expect(result.count).toBeGreaterThanOrEqual(0)
        expect(Array.isArray(result.spans)).toBe(true)
    })

    it("gets a trace by ID (if traces exist)", async () => {
        const spans = await ag.tracing.querySpans({
            windowing: {limit: 1, order: "descending"},
        })
        if (spans.spans.length === 0) return

        const traceId = spans.spans[0].trace_id
        if (!traceId) return

        const trace = await ag.tracing.getTrace(traceId)

        expect(trace).toBeDefined()
    })
})
