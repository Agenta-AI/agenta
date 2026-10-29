import {atom} from "jotai"

/**
 * Cross-component request to open the chat's provider drawer (the add-your-own-key form).
 * Set by a remote trigger (e.g. the failed-run callout in the transcript) and consumed by
 * `ConnectModelBanner`, which owns that drawer and clears this back to `false`.
 */
export const openProviderDrawerRequestAtom = atom(false)
