/**
 * Integration tests for the TestSets service.
 * Creates real testsets and verifies round-trip data integrity.
 */

import {describe, it, expect, beforeAll} from "vitest"

import type {Agenta} from "@src/index.js"

import {canRun, createTestClient} from "./setup.js"

describe.skipIf(!canRun)("sdk: testsets", () => {
    let ag: Agenta

    beforeAll(async () => {
        ag = await createTestClient()
    })

    it("queries testsets", async () => {
        const result = await ag.testsets.query({windowing: {limit: 5}})

        expect(result.count).toBeGreaterThanOrEqual(0)
        expect(Array.isArray(result.testsets)).toBe(true)
    })

    describe("create → get → list round-trip", () => {
        let testsetId: string | undefined

        it("creates a testset with inline testcases", async () => {
            const testset = await ag.testsets.create({
                slug: `sdk-int-test-${Date.now()}`,
                name: "SDK Integration Test",
                description: "Created by SDK integration tests — safe to delete",
                testcases: [
                    {question: "What is 2+2?", answer: "4"},
                    {question: "Capital of France?", answer: "Paris"},
                ],
            })

            expect(testset.id).toBeTruthy()
            expect(testset.name).toBe("SDK Integration Test")
            testsetId = testset.id!
        })

        it("gets the testset back with testcases", async () => {
            if (!testsetId) return

            const testset = await ag.testsets.get(testsetId)

            expect(testset.id).toBe(testsetId)
            expect(testset.data?.testcases).toHaveLength(2)
            expect(testset.data?.testcases?.[0]?.data?.question).toBe("What is 2+2?")
        })

        it("appears in query results", async () => {
            if (!testsetId) return

            const result = await ag.testsets.query({windowing: {limit: 100}})
            const found = result.testsets.find((ts) => ts.id === testsetId)

            expect(found).toBeDefined()
            expect(found?.name).toBe("SDK Integration Test")
        })
    })
})
