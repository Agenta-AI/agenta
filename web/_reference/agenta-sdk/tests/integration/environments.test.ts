/**
 * Integration tests for the Environments service.
 */

import {describe, it, expect, beforeAll} from "vitest"

import type {Agenta} from "@src/index.js"

import {canRun, createTestClient} from "./setup.js"

describe.skipIf(!canRun)("sdk: environments", () => {
    let ag: Agenta

    beforeAll(async () => {
        ag = await createTestClient()
    })

    it("queries environments", async () => {
        const result = await ag.environments.query({windowing: {limit: 10}})

        expect(result.count).toBeGreaterThanOrEqual(0)
        expect(Array.isArray(result.environments)).toBe(true)
    })

    it("lists environments", async () => {
        const envs = await ag.environments.list()

        expect(Array.isArray(envs)).toBe(true)
    })

    it("gets an environment by ID (if environments exist)", async () => {
        const envs = await ag.environments.list()
        if (envs.length === 0) return

        const env = await ag.environments.get(envs[0].id!)

        expect(env).not.toBeNull()
        expect(env!.id).toBe(envs[0].id)
    })
})
