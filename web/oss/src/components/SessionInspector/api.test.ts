import {beforeEach, describe, expect, it, vi} from "vitest"

import axios from "@/oss/lib/api/assets/axiosConfig"
import {getAgentaApiUrl} from "@/oss/lib/helpers/api"

import {fetchAgentMount} from "./api"

vi.mock("@/oss/lib/api/assets/axiosConfig", () => ({
    default: {post: vi.fn()},
}))

vi.mock("@/oss/lib/helpers/api", () => ({
    getAgentaApiUrl: vi.fn(() => "https://api.example.test"),
}))

describe("fetchAgentMount", () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it("posts the artifact id and returns the found mount", async () => {
        const mount = {id: "mount-id", name: "default"}
        vi.mocked(axios.post).mockResolvedValue({data: {count: 1, mounts: [mount]}})

        await expect(fetchAgentMount("artifact-id", "project-id")).resolves.toEqual(mount)
        expect(getAgentaApiUrl).toHaveBeenCalled()
        expect(axios.post).toHaveBeenCalledWith(
            "https://api.example.test/mounts/agents/query",
            {artifact_id: "artifact-id"},
            {params: {project_id: "project-id"}, _ignoreError: true},
        )
    })

    it("omits the project id when it is absent", async () => {
        vi.mocked(axios.post).mockResolvedValue({data: {count: 0, mounts: []}})

        await fetchAgentMount("artifact-id")

        expect(axios.post).toHaveBeenCalledWith(
            "https://api.example.test/mounts/agents/query",
            {artifact_id: "artifact-id"},
            {params: {project_id: undefined}, _ignoreError: true},
        )
    })

    it("returns null when the query envelope is empty", async () => {
        vi.mocked(axios.post).mockResolvedValue({data: {count: 0, mounts: []}})

        await expect(fetchAgentMount("artifact-id")).resolves.toBeNull()
    })
})
