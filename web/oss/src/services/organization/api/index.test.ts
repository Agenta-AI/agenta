import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

import {fetchJson} from "../../../lib/api/assets/fetchClient"

import {fetchAllOrgsList, fetchSingleOrg} from "."

vi.mock("@/oss/lib/api/assets/axiosConfig", () => ({
    default: {},
}))

vi.mock("@/oss/lib/helpers/api", () => ({
    getAgentaApiUrl: vi.fn(() => "https://api.example.test"),
}))

vi.mock("../../../lib/api/assets/fetchClient", () => ({
    fetchJson: vi.fn(),
    getBaseUrl: vi.fn(() => "https://api.example.test/"),
}))

describe("organization fetchers", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("fetches organizations without routine console logging", async () => {
        const log = vi.spyOn(console, "log").mockImplementation(() => undefined)
        const organizations = [{id: "org-1", name: "Organization"}]
        const organization = organizations[0]
        vi.mocked(fetchJson)
            .mockResolvedValueOnce(organizations)
            .mockResolvedValueOnce(organization)

        await expect(fetchAllOrgsList()).resolves.toBe(organizations)
        await expect(fetchSingleOrg({organizationId: "org-1"})).resolves.toBe(organization)

        expect(log).not.toHaveBeenCalled()
    })
})
