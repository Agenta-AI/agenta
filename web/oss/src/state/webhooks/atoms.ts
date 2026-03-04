import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryClient} from "@/oss/lib/api/queryClient"
import {
    createWebhook,
    deleteWebhook,
    listWebhooks,
    testWebhook,
    updateWebhook,
} from "@/oss/services/webhooks/api"
import {
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
} from "@/oss/services/webhooks/types"
import {projectIdAtom} from "@/oss/state/project"

export const webhooksAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["webhooks", projectId],
        queryFn: async () => {
            const response = await listWebhooks()
            return response.subscriptions
        },
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        enabled: !!projectId,
    }
})

export const createWebhookAtom = atom(
    null,
    async (_get, _set, payload: WebhookSubscriptionCreateRequest) => {
        const res = await createWebhook(payload)
        await queryClient.invalidateQueries({queryKey: ["webhooks"]})
        return res
    },
)

export const updateWebhookAtom = atom(
    null,
    async (
        _get,
        _set,
        {webhookId, payload}: {webhookId: string; payload: WebhookSubscriptionEditRequest},
    ) => {
        const res = await updateWebhook(webhookId, payload)
        await queryClient.invalidateQueries({queryKey: ["webhooks"]})
        return res
    },
)

export const deleteWebhookAtom = atom(null, async (_get, _set, webhookId: string) => {
    await deleteWebhook(webhookId)
    await queryClient.invalidateQueries({queryKey: ["webhooks"]})
})

export const testWebhookAtom = atom(null, async (_get, _set, webhookId: string) => {
    return await testWebhook(webhookId)
})
