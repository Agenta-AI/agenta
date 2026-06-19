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
} from "@/oss/services/webhooks/api"
import {
    WebhookSubscriptionTestRequest,
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
} from "@/oss/services/webhooks/types"
import {projectIdAtom} from "@/oss/state/project"

export const webhooksAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["webhooks", projectId],
        queryFn: async () => {
            const response = await queryWebhookSubscriptions(projectId ?? undefined)
            return response.subscriptions
        },
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        enabled: !!projectId,
    }
})

export const webhookDeliveriesAtomFamily = atomFamily((webhookSubscriptionId: string | null) =>
    atomWithQuery((get) => {
        const projectId = get(projectIdAtom)

        return {
            queryKey: ["webhook-deliveries", projectId, webhookSubscriptionId],
            queryFn: async () => {
                if (!webhookSubscriptionId) {
                    return []
                }

                const response = await queryWebhookDeliveries(
                    {
                        delivery: {
                            subscription_id: webhookSubscriptionId,
                        },
                        windowing: {
                            limit: 25,
                            order: "descending",
                        },
                    },
                    projectId ?? undefined,
                )
                return response.deliveries
            },
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            enabled: !!projectId && !!webhookSubscriptionId,
        }
    }),
)

export const createWebhookAtom = atom(
    null,
    async (get, _set, payload: WebhookSubscriptionCreateRequest) => {
        const projectId = get(projectIdAtom)
        const res = await createWebhookSubscription(payload, projectId ?? undefined)
        await queryClient.invalidateQueries({queryKey: ["webhooks"]})
        return res
    },
)

export const updateWebhookAtom = atom(
    null,
    async (
        get,
        _set,
        {
            webhookSubscriptionId,
            payload,
        }: {webhookSubscriptionId: string; payload: WebhookSubscriptionEditRequest},
    ) => {
        const projectId = get(projectIdAtom)
        const res = await editWebhookSubscription(
            webhookSubscriptionId,
            payload,
            projectId ?? undefined,
        )
        await queryClient.invalidateQueries({queryKey: ["webhooks"]})
        return res
    },
)

export const deleteWebhookAtom = atom(null, async (get, _set, webhookSubscriptionId: string) => {
    const projectId = get(projectIdAtom)
    await deleteWebhookSubscription(webhookSubscriptionId, projectId ?? undefined)
    await queryClient.invalidateQueries({queryKey: ["webhooks"]})
})

export const testWebhookAtom = atom(
    null,
    async (get, _set, payload: WebhookSubscriptionTestRequest) => {
        const projectId = get(projectIdAtom)
        const res = await testWebhookSubscription(payload, projectId ?? undefined)
        await queryClient.invalidateQueries({queryKey: ["webhooks"]})
        await queryClient.invalidateQueries({queryKey: ["webhook-deliveries"]})
        return res
    },
)
