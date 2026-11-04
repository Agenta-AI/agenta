import {beforeEach, describe, expect, it, vi} from "vitest"

const {postMock, putMock} = vi.hoisted(() => ({postMock: vi.fn(), putMock: vi.fn()}))

vi.mock("@agenta/shared/api", async (original) => ({
    ...(await original<object>()),
    axios: {post: postMock, put: putMock},
    getAgentaApiUrl: () => "https://agenta.test/api",
}))

import {updateWorkflow} from "../../src/workflow/api/api"

const REVISION = {id: "rev-1", workflow_id: "app-1", version: "3", name: "default"}

beforeEach(() => {
    postMock.mockReset()
    putMock.mockReset().mockResolvedValue({data: {}})
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.spyOn(console, "warn").mockImplementation(() => undefined)
})

describe("updateWorkflow read-back", () => {
    it("returns the revision when the metadata write and the read both work", async () => {
        postMock.mockResolvedValue({data: {count: 1, workflow_revisions: [REVISION]}})
        const result = await updateWorkflow("pr", {id: "app-1", name: "New"})
        expect(result?.id).toBe("rev-1")
    })

    it("does not throw when the metadata write worked and the read fails", async () => {
        postMock.mockRejectedValue(new Error("read failed"))
        const result = await updateWorkflow("pr", {id: "app-1", name: "New"})
        expect(putMock).toHaveBeenCalledTimes(1)
        expect(putMock.mock.calls[0][1].workflow).toMatchObject({id: "app-1", name: "New"})
        expect(result).toBeNull()
    })

    it("does not throw when the read finds no revision after a write", async () => {
        postMock.mockResolvedValue({data: {count: 0, workflow_revisions: []}})
        await expect(updateWorkflow("pr", {id: "app-1", name: "New"})).resolves.toBeNull()
    })

    it("still throws when the metadata write fails", async () => {
        putMock.mockRejectedValue(new Error("server said no"))
        await expect(updateWorkflow("pr", {id: "app-1", name: "New"})).rejects.toThrow(
            "server said no",
        )
        expect(postMock).not.toHaveBeenCalled()
    })
})
