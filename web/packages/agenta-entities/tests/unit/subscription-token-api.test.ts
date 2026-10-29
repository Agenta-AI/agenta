import {beforeEach, describe, expect, it, vi} from "vitest"

const {client} = vi.hoisted(() => ({client: {setSubscriptionToken: vi.fn()}}))

vi.mock("@agenta/sdk/resources", () => ({getSecretsClient: () => client}))

import {setSubscriptionToken} from "../../src/secret/api"

describe("setSubscriptionToken", () => {
    beforeEach(() => {
        client.setSubscriptionToken.mockReset().mockResolvedValue({id: "claude-1"})
    })

    it("sends the token in the body of the connection's route, scoped to the project", async () => {
        const result = await setSubscriptionToken({
            projectId: "project-1",
            secretId: "claude-1",
            token: "sk-ant-oat01-abc",
        })

        expect(client.setSubscriptionToken).toHaveBeenCalledWith(
            {secret_id: "claude-1", token: "sk-ant-oat01-abc"},
            {queryParams: {project_id: "project-1"}},
        )
        expect(result).toEqual({id: "claude-1"})
    })

    it("lets the API's refusal through to the caller", async () => {
        const refusal = Object.assign(new Error("Status code: 422"), {
            body: {detail: {code: "subscription_token_rejected"}},
        })
        client.setSubscriptionToken.mockRejectedValue(refusal)

        await expect(
            setSubscriptionToken({projectId: "project-1", secretId: "claude-1", token: "x"}),
        ).rejects.toBe(refusal)
    })
})
