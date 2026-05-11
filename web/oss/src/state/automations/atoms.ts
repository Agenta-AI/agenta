import {atom} from "jotai"
import {atomFamily} from "jotai/utils"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryClient} from "@/oss/lib/api/queryClient"
import {
    createWebhookSubscription,
    deleteWebhookSubscription,
    queryWebhookDeliveries,
    queryWebhookSubscriptions,
    testWebhookSubscription,
    editWebhookSubscription,
} from "@/oss/services/automations/api"
import {
    WebhookSubscriptionTestRequest,
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
} from "@/oss/services/automations/types"
import {projectIdAtom} from "@/oss/state/project"

export const automationsAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["automations", projectId],
        queryFn: async () => {
            const response = await queryWebhookSubscriptions()
            return response.subscriptions
        },
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        enabled: !!projectId,
    }
})

export const automationDeliveriesAtomFamily = atomFamily((webhookSubscriptionId: string | null) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)

        return {
            queryKey: ["automation-deliveries", projectId, webhookSubscriptionId],
            queryFn: async () => {
                if (!webhookSubscriptionId) {
                    return []
                }

                const response = await queryWebhookDeliveries({
                    delivery: {
                        subscription_id: webhookSubscriptionId,
                    },
                    windowing: {
                        limit: 25,
                        order: "descending",
                    },
                })
                return response.deliveries
            },
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            enabled: !!projectId && !!webhookSubscriptionId,
        }
    }),
)

export const createAutomationAtom = atom(
    null,
    async (_get, _set, payload: WebhookSubscriptionCreateRequest) => {
        const res = await createWebhookSubscription(payload)
        await queryClient.invalidateQueries({queryKey: ["automations"]})
        return res
    },
)

export const updateAutomationAtom = atom(
    null,
    async (
        _get,
        _set,
        {
            webhookSubscriptionId,
            payload,
        }: {webhookSubscriptionId: string; payload: WebhookSubscriptionEditRequest},
    ) => {
        const res = await editWebhookSubscription(webhookSubscriptionId, payload)
        await queryClient.invalidateQueries({queryKey: ["automations"]})
        return res
    },
)

export const deleteAutomationAtom = atom(
    null,
    async (_get, _set, webhookSubscriptionId: string) => {
        await deleteWebhookSubscription(webhookSubscriptionId)
        await queryClient.invalidateQueries({queryKey: ["automations"]})
    },
)

export const testAutomationAtom = atom(
    null,
    async (_get, _set, payload: WebhookSubscriptionTestRequest) => {
        const res = await testWebhookSubscription(payload)
        await queryClient.invalidateQueries({queryKey: ["automations"]})
        await queryClient.invalidateQueries({queryKey: ["automation-deliveries"]})
        return res
    },
)
