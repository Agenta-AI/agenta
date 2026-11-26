import {beforeEach, describe, expect, it, vi} from "vitest"

const {fetchAccessRolesMock} = vi.hoisted(() => ({fetchAccessRolesMock: vi.fn()}))

vi.mock("@agenta/sdk/resources", () => ({
    getAccessClient: () => ({fetchAccessRoles: fetchAccessRolesMock}),
}))

import {fetchOfferedRoles} from "../../src/organization/workspaceApi"

const entry = (role: string, description = `${role} text`) => ({
    role,
    description,
    permissions: [],
})

describe("fetchOfferedRoles", () => {
    beforeEach(() => fetchAccessRolesMock.mockReset())

    it("lists the offered roles from the project catalog, not the workspace one", async () => {
        fetchAccessRolesMock.mockResolvedValue({
            organization: [entry("owner")],
            workspace: [entry("admin", "workspace admin"), entry("reviewer")],
            project: [entry("owner"), entry("admin"), entry("member"), entry("viewer")],
            offered: {roles: ["admin", "member"], floor_role: "member"},
        })

        const roles = await fetchOfferedRoles("project-1")

        expect(fetchAccessRolesMock).toHaveBeenCalledWith({
            queryParams: {project_id: "project-1"},
        })
        expect(roles).toEqual([
            {role_name: "admin", role_description: "admin text"},
            {role_name: "member", role_description: "member text"},
        ])
    })

    it("asks for the default project when none is named", async () => {
        fetchAccessRolesMock.mockResolvedValue({
            project: [entry("admin")],
            offered: {roles: [], floor_role: "member"},
        })

        expect(await fetchOfferedRoles()).toEqual([])
        expect(fetchAccessRolesMock).toHaveBeenCalledWith({queryParams: undefined})
    })

    it.each([
        {project: "not a list", offered: {roles: [], floor_role: "member"}},
        {project: [entry("admin")]},
        {offered: {roles: ["admin"], floor_role: "member"}},
    ])("fails on an answer that does not validate: %j", async (answer) => {
        fetchAccessRolesMock.mockResolvedValue(answer)

        await expect(fetchOfferedRoles("project-1")).rejects.toThrow()
    })
})
