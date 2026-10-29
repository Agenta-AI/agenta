import {beforeEach, describe, expect, it, vi} from "vitest"

const fernFetchDelivery = vi.fn()

vi.mock("@agenta/sdk/resources", () => ({
    getTriggersClient: () => ({fetchTriggerDelivery: fernFetchDelivery}),
}))

import {fetchTriggerDelivery} from "../../src/gatewayTrigger/api/api"

beforeEach(() => {
    fernFetchDelivery.mockReset()
})

describe("fetchTriggerDelivery", () => {
    it("sends the exact delivery ID and project scope through Fern", async () => {
        fernFetchDelivery.mockResolvedValueOnce({
            count: 1,
            delivery: {
                id: "delivery-1",
                event_id: "event-1",
                status: {type: "success"},
                data: {session_id: "session-1"},
            },
        })

        const response = await fetchTriggerDelivery({
            projectId: "project-42",
            deliveryId: "delivery-1",
        })

        expect(fernFetchDelivery).toHaveBeenCalledTimes(1)
        expect(fernFetchDelivery).toHaveBeenCalledWith(
            {delivery_id: "delivery-1"},
            {queryParams: {project_id: "project-42"}},
        )
        expect(response.delivery?.data?.session_id).toBe("session-1")
    })

    it("does not issue a request without both IDs", async () => {
        await expect(
            fetchTriggerDelivery({projectId: "", deliveryId: "delivery-1"}),
        ).resolves.toEqual({count: 0, delivery: null})
        await expect(
            fetchTriggerDelivery({projectId: "project-42", deliveryId: ""}),
        ).resolves.toEqual({count: 0, delivery: null})
        expect(fernFetchDelivery).not.toHaveBeenCalled()
    })
})
