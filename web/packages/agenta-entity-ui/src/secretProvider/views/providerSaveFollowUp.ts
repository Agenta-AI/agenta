import type {ViewStack} from "@agenta/ui/view-stack"
import {atom} from "jotai"

/**
 * What runs after a provider connection is saved, when a model picker sent the person to Model
 * providers in its view stack: the picker switches a new local agent to the new connection's
 * model. Only a save in that same stack runs it, once. The list clears it when it closes.
 */
export interface ProviderSaveFollowUp {
    /** The stack the picker opened Model providers in, known by its `open`, which is stable. */
    host: ViewStack["open"]
    run: (savedConnectionId?: string) => void | Promise<void>
}

export const providerSaveFollowUpAtom = atom<ProviderSaveFollowUp | null>(null)
