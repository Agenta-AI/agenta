/**
 * Webhook state management using Jotai atoms
 */

import {atomWithMutation, atomWithQuery} from "jotai-tanstack-query"

import {message} from "@/oss/components/AppMessageContext"
import {queryClient} from "@/oss/lib/api/queryClient"

import {webhookService} from "@/oss/services/webhooks/api"
import type {CreateWebhookPayload, UpdateWebhookPayload} from "@/oss/services/webhooks/types"

/**
 * Query atom for fetching webhooks for an app
 */
export const webhooksQueryAtom = (appId: string) =>
    atomWithQuery(() => ({
        queryKey: ["webhooks", appId],
        queryFn: () => webhookService.listWebhooks(appId),
        staleTime: 30_000, // 30 seconds
    }))

/**
 * Mutation atom for creating a webhook
 */
export const createWebhookMutationAtom = atomWithMutation(() => ({
    mutationFn: async (payload: {appId: string; data: CreateWebhookPayload}) => {
        return await webhookService.createWebhook(payload.data)
    },
    onSuccess: (_, payload) => {
        queryClient.invalidateQueries({queryKey: ["webhooks", payload.appId]})
        message.success("Webhook created successfully")
    },
    onError: (error: Error) => {
        message.error(`Failed to create webhook: ${error.message}`)
    },
}))

/**
 * Mutation atom for updating a webhook
 */
export const updateWebhookMutationAtom = atomWithMutation(() => ({
    mutationFn: async (payload: {webhookId: string; data: UpdateWebhookPayload; appId: string}) => {
        return await webhookService.updateWebhook(payload.webhookId, payload.data)
    },
    onSuccess: (_, payload) => {
        queryClient.invalidateQueries({queryKey: ["webhooks", payload.appId]})
        message.success("Webhook updated successfully")
    },
    onError: (error: Error) => {
        message.error(`Failed to update webhook: ${error.message}`)
    },
}))

/**
 * Mutation atom for deleting a webhook
 */
export const deleteWebhookMutationAtom = atomWithMutation(() => ({
    mutationFn: async (payload: {webhookId: string; appId: string}) => {
        await webhookService.deleteWebhook(payload.webhookId)
    },
    onSuccess: (_, payload) => {
        queryClient.invalidateQueries({queryKey: ["webhooks", payload.appId]})
        message.success("Webhook deleted successfully")
    },
    onError: (error: Error) => {
        message.error(`Failed to delete webhook: ${error.message}`)
    },
}))

/**
 * Query atom for fetching webhook executions
 */
export const webhookExecutionsQueryAtom = (webhookId: string, limit = 50, offset = 0) =>
    atomWithQuery(() => ({
        queryKey: ["webhookExecutions", webhookId, limit, offset],
        queryFn: () => webhookService.listExecutions(webhookId, limit, offset),
        staleTime: 10_000, // 10 seconds
    }))
