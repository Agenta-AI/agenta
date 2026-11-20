import {atom} from "jotai"

/**
 * What runs after a provider connection is saved in a view, when a model picker sent the person
 * to Model providers: the picker switches a new local agent to the new connection's model, as the
 * provider drawer's save does. The first save runs it once; the picker clears it when it shows
 * again without a save.
 */
export type ProviderSaveFollowUp = (savedConnectionId?: string) => void | Promise<void>

export const providerSaveFollowUpAtom = atom<{run: ProviderSaveFollowUp} | null>(null)
