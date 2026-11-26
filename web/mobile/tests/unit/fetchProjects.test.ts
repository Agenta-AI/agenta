import {beforeEach, describe, expect, it, vi} from "vitest"

const {getProjects, listOrganizations} = vi.hoisted(() => ({
    getProjects: vi.fn(),
    listOrganizations: vi.fn(),
}))

vi.mock("@agenta/sdk/resources", () => ({
    getProjectsClient: () => ({getProjects}),
    getOrganizationsClient: () => ({listOrganizations}),
}))
vi.mock("../../src/lib/auth", () => ({refreshSessionOutcome: vi.fn(async () => "signed-out")}))

import {fetchHasOrganization, fetchProjects} from "../../src/lib/context"

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

describe("fetchHasOrganization", () => {
    beforeEach(() => listOrganizations.mockReset())

    it("is false for a person without an organization, whose list is empty", async () => {
        listOrganizations.mockResolvedValueOnce([])
        expect(await fetchHasOrganization()).toBe(false)
    })

    it("is true for a member of an organization", async () => {
        listOrganizations.mockResolvedValueOnce([{id: "org-1"}])
        expect(await fetchHasOrganization()).toBe(true)
    })
})
