import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {queryClient} from "@/oss/lib/api/queryClient"
import {
    createWebhook,
    deleteWebhook,
    listWebhooks,
    testWebhook,
    updateWebhook,
} from "@/oss/services/automations/api"
import {
    WebhookSubscriptionCreateRequest,
    WebhookSubscriptionEditRequest,
} from "@/oss/services/automations/types"
import {projectIdAtom} from "@/oss/state/project"

export const automationsAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["automations", projectId],
        queryFn: async () => {
            const response = await listWebhooks()
            return response.subscriptions
        },
        staleTime: 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        enabled: !!projectId,
    }
})

export const createAutomationAtom = atom(
    null,
    async (_get, _set, payload: WebhookSubscriptionCreateRequest) => {
        const res = await createWebhook(payload)
        await queryClient.invalidateQueries({queryKey: ["automations"]})
        return res
    },
)

export const updateAutomationAtom = atom(
    null,
    async (
        _get,
        _set,
        {webhookId, payload}: {webhookId: string; payload: WebhookSubscriptionEditRequest},
    ) => {
        const res = await updateWebhook(webhookId, payload)
        await queryClient.invalidateQueries({queryKey: ["automations"]})
        return res
    },
)

export const deleteAutomationAtom = atom(null, async (_get, _set, webhookId: string) => {
    await deleteWebhook(webhookId)
    await queryClient.invalidateQueries({queryKey: ["automations"]})
})

export const testAutomationAtom = atom(null, async (_get, _set, webhookId: string) => {
    return await testWebhook(webhookId)
})
