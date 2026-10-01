import {beforeEach, describe, expect, it, vi} from "vitest"

// The permission probe must pin the request's auth scope to the project it asks about.
// Without `project_id` in the query, the auth middleware resolves the DEFAULT project and
// the backend's scope check denies every permission on a non-default project.
const checkPermissions = vi.fn()

vi.mock("@agenta/sdk/resources", () => ({
    getAccessClient: () => ({checkPermissions}),
}))

import {fetchProjectPermission} from "@/features/context/useProjectPermission"

describe("fetchProjectPermission", () => {
    beforeEach(() => {
        checkPermissions.mockReset()
    })

    it("scopes the auth context to the project it checks", async () => {
        checkPermissions.mockResolvedValueOnce({})

        const allowed = await fetchProjectPermission("proj-123", "edit_secret")

        expect(allowed).toBe(true)
        expect(checkPermissions).toHaveBeenCalledWith(
            {
                action: "edit_secret",
                scope_type: "project",
                scope_id: "proj-123",
                resource_type: "service",
            },
            {queryParams: {project_id: "proj-123"}},
        )
    })

    it("returns false when the backend denies", async () => {
        checkPermissions.mockRejectedValueOnce(
            Object.assign(new Error("Forbidden"), {statusCode: 403}),
        )

        await expect(fetchProjectPermission("proj-123", "edit_secret")).resolves.toBe(false)
    })

    it("leaves the permission unknown when the check itself fails", async () => {
        checkPermissions.mockRejectedValueOnce(
            Object.assign(new Error("Bad gateway"), {statusCode: 502}),
        )

        await expect(fetchProjectPermission("proj-123", "edit_secret")).rejects.toThrow(
            "Bad gateway",
        )
    })
})
