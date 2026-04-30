/**
 * Integration tests for the Projects service.
 */

import {describe, it, expect, beforeAll} from "vitest"

import type {Agenta} from "@src/index.js"

import {canRun, createTestClient} from "./setup.js"

describe.skipIf(!canRun)("sdk: projects", () => {
    let ag: Agenta

    beforeAll(async () => {
        ag = await createTestClient()
    })

    it("lists projects", async () => {
        const projects = await ag.projects.list()

        expect(projects.length).toBeGreaterThan(0)
        expect(projects[0].project_id).toBeTruthy()
        expect(projects[0].project_name).toBeTruthy()
    })

    it("gets a project by ID", async () => {
        const projects = await ag.projects.list()
        const project = await ag.projects.get(projects[0].project_id)

        expect(project.project_id).toBe(projects[0].project_id)
        expect(project.project_name).toBeTruthy()
    })
})
