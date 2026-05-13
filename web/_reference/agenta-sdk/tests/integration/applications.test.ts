/**
 * Integration tests for the Applications service.
 */

import {describe, it, expect, beforeAll} from "vitest"

import type {Agenta} from "@src/index.js"

import {canRun, createTestClient} from "./setup.js"

describe.skipIf(!canRun)("sdk: applications", () => {
    let ag: Agenta

    beforeAll(async () => {
        ag = await createTestClient()
    })

    it("lists applications", async () => {
        const apps = await ag.applications.list()

        expect(Array.isArray(apps)).toBe(true)
        // May be empty on fresh instance — that's OK
    })

    it("queries applications with pagination", async () => {
        const result = await ag.applications.query({windowing: {limit: 5}})

        expect(result.count).toBeGreaterThanOrEqual(0)
        expect(Array.isArray(result.applications)).toBe(true)
    })

    it("gets an application by ID (if apps exist)", async () => {
        const apps = await ag.applications.list()
        if (apps.length === 0) return

        const app = await ag.applications.get(apps[0].id!)

        expect(app).not.toBeNull()
        expect(app!.id).toBe(apps[0].id)
        expect(app!.name).toBeTruthy()
    })

    it("finds an application by slug (if apps exist)", async () => {
        const apps = await ag.applications.list()
        if (apps.length === 0) return

        const found = await ag.applications.findBySlug(apps[0].slug!)

        expect(found).not.toBeNull()
        expect(found!.slug).toBe(apps[0].slug)
    })
})
