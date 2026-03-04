import {atom} from "jotai"

import {WebhookSubscription} from "@/oss/services/webhooks/types"

export const isCreateWebhookModalOpenAtom = atom<boolean>(false)
export const editingWebhookAtom = atom<WebhookSubscription | undefined>(undefined)
export const createdWebhookSecretAtom = atom<string | null>(null)
