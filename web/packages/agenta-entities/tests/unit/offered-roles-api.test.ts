import {beforeEach, describe, expect, it, vi} from "vitest"

const {axiosGetMock} = vi.hoisted(() => ({axiosGetMock: vi.fn()}))

vi.mock("@agenta/shared/api", () => ({
    axios: {get: axiosGetMock},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {fetchOfferedRoles} from "../../src/organization/workspaceApi"

const entry = (role: string, description = `${role} text`) => ({
    role,
    description,
    permissions: [],
})

describe("fetchOfferedRoles", () => {
    beforeEach(() => axiosGetMock.mockReset())

    it("lists the offered roles from the project catalog, not the workspace one", async () => {
        axiosGetMock.mockResolvedValue({
            data: {
                organization: [entry("owner")],
                workspace: [entry("admin", "workspace admin"), entry("reviewer")],
                project: [entry("owner"), entry("admin"), entry("member"), entry("viewer")],
                offered: {roles: ["admin", "member"], floor_role: "member"},
            },
        })

        const roles = await fetchOfferedRoles("project-1")

        expect(axiosGetMock).toHaveBeenCalledWith("https://agenta.test/api/access/roles", {
            params: {project_id: "project-1"},
            _ignoreError: false,
        })
        expect(roles).toEqual([
            {role_name: "admin", role_description: "admin text"},
            {role_name: "member", role_description: "member text"},
        ])
    })

    it("lists nothing when the answer offers nothing", async () => {
        axiosGetMock.mockResolvedValue({data: {project: [entry("admin")]}})

        expect(await fetchOfferedRoles()).toEqual([])
    })
})
