import {beforeEach, describe, expect, it, vi} from "vitest"

const {getProjects} = vi.hoisted(() => ({getProjects: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({getProjectsClient: () => ({getProjects})}))
vi.mock("../../src/lib/auth", () => ({refreshSessionOutcome: vi.fn(async () => "signed-out")}))

import {fetchProjects} from "../../src/lib/context"

const failWith = (statusCode: number) =>
    getProjects.mockRejectedValueOnce(Object.assign(new Error("request failed"), {statusCode}))

describe("fetchProjects", () => {
    beforeEach(() => getProjects.mockReset())

    it("reads a 404 as no project, so a person without an organization is signed in", async () => {
        failWith(404)
        expect(await fetchProjects()).toEqual({kind: "ok", projects: []})
    })

    it("still reads a 401 as signed out", async () => {
        failWith(401)
        expect(await fetchProjects()).toEqual({kind: "unauthenticated"})
    })

    it("reads any other failure as an error", async () => {
        failWith(500)
        expect(await fetchProjects()).toEqual({kind: "error"})
    })
})
