import {atom} from "jotai"

import {AutomationProvider, WebhookSubscription} from "@/oss/services/automations/types"

export const isAutomationDrawerOpenAtom = atom<boolean>(false)
export const editingAutomationAtom = atom<WebhookSubscription | undefined>(undefined)
export const createdWebhookSecretAtom = atom<string | null>(null)
export const selectedProviderAtom = atom<AutomationProvider>("webhook")
