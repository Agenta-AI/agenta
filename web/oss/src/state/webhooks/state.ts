import {atom} from "jotai"

import {WebhookProvider, WebhookSubscription} from "@/oss/services/webhooks/types"

export const isWebhookDrawerOpenAtom = atom<boolean>(false)
export const editingWebhookAtom = atom<WebhookSubscription | undefined>(undefined)
export const createdWebhookSecretAtom = atom<string | null>(null)
export const selectedProviderAtom = atom<WebhookProvider>("webhook")
export const webhookToDeleteAtom = atom<WebhookSubscription | null>(null)
