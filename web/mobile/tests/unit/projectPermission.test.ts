// The fetcher lives in `@agenta/entities/access`, so the packages gate on the same answer.
import {fetchProjectPermission} from "@agenta/entities/access"
import {beforeEach, describe, expect, it, vi} from "vitest"

const checkPermissions = vi.fn()

vi.mock("@agenta/sdk/resources", () => ({
    getAccessClient: () => ({checkPermissions}),
}))

describe("mobile project permissions", () => {
    beforeEach(() => checkPermissions.mockReset())

    it("asks the backend for the effective project permission", async () => {
        checkPermissions.mockResolvedValue({effect: "allow"})

        await expect(fetchProjectPermission("project-1", "edit_secret")).resolves.toBe(true)
        expect(checkPermissions).toHaveBeenCalledWith(
            {
                action: "edit_secret",
                scope_type: "project",
                scope_id: "project-1",
                resource_type: "service",
            },
            {queryParams: {project_id: "project-1"}},
        )
    })
})
