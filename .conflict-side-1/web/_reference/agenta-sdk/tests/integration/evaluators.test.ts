/**
 * Integration tests for the Evaluators service.
 */

import {describe, it, expect, beforeAll} from "vitest"

import type {Agenta} from "@src/index.js"

import {canRun, createTestClient} from "./setup.js"

describe.skipIf(!canRun)("sdk: evaluators", () => {
    let ag: Agenta

    beforeAll(async () => {
        ag = await createTestClient()
    })

    it("lists evaluator catalog templates", async () => {
        const templates = await ag.evaluators.listTemplates()

        expect(templates.length).toBeGreaterThan(0)
        expect(templates[0].key).toBeTruthy()
        expect(templates[0].name).toBeTruthy()
    })

    it("gets a specific template by key", async () => {
        const templates = await ag.evaluators.listTemplates()
        const firstKey = templates[0].key!

        const template = await ag.evaluators.getTemplate(firstKey)

        expect(template).not.toBeNull()
        expect(template!.key).toBe(firstKey)
    })

    it("queries evaluators", async () => {
        const result = await ag.evaluators.query({windowing: {limit: 5}})

        expect(result.count).toBeGreaterThanOrEqual(0)
        expect(Array.isArray(result.evaluators)).toBe(true)
    })

    it("lists evaluators", async () => {
        const evaluators = await ag.evaluators.list()

        expect(Array.isArray(evaluators)).toBe(true)
    })

    it("gets an evaluator by ID (if evaluators exist)", async () => {
        const evaluators = await ag.evaluators.list()
        if (evaluators.length === 0) return

        const evaluator = await ag.evaluators.get(evaluators[0].id!)

        expect(evaluator).not.toBeNull()
        expect(evaluator!.id).toBe(evaluators[0].id)
    })
})
