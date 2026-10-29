import {beforeEach, describe, expect, it, vi} from "vitest"

const get = vi.fn()

vi.mock("@agenta/shared/api", () => ({
    axios: {get},
    getAgentaApiUrl: () => "https://api.example.test",
}))

const {fetchAllOrgsList, fetchSingleOrg} = await import("../../src/organization/api")

describe("organization fetchers", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("fetches organizations without routine console logging", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
        const organizations = [{id: "org-1", name: "Organization"}]
        const organization = organizations[0]
        get.mockResolvedValueOnce({data: organizations}).mockResolvedValueOnce({data: organization})

        await expect(fetchAllOrgsList()).resolves.toBe(organizations)
        await expect(fetchSingleOrg({organizationId: "org-1"})).resolves.toBe(organization)

        expect(log).not.toHaveBeenCalled()
        log.mockRestore()
    })

    it("answers empty on an unauthenticated read rather than throwing", async () => {
        get.mockRejectedValue({response: {status: 401}})

        await expect(fetchAllOrgsList()).resolves.toEqual([])
        await expect(fetchSingleOrg({organizationId: "org-1"})).resolves.toBeNull()
    })
})
