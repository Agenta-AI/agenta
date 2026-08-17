/**
 * Which of a subscription pair's models show in the model picker.
 *
 * A subscription has no vault record — nothing was added, so there is nothing to store server-side.
 * The plan fixes the model list; the only choice the user makes is which of those fixed ids they
 * want to see, which is a local display preference and is kept as one.
 *
 * Keyed by the PAIR (`anthropic:claude`), because the pair is the unit models are configured for:
 * the same ChatGPT plan read by Codex and by Pi is two rows and two selections.
 *
 * `undefined` for a pair means "not chosen yet" — the plan's recommended set applies until the
 * user touches the list, exactly as an untouched connection follows Agenta's defaults.
 */

import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

/** The pair key `subscriptionPairsFrom` assigns: `${provider}:${harness}`. */
export type SubscriptionPairKey = string

const STORAGE_KEY = "agenta:subscription-pair-models"

const subscriptionPairModelsByPairAtom = atomWithStorage<
    Record<SubscriptionPairKey, string[] | undefined>
>(STORAGE_KEY, {})

/** The saved model selection for one pair, or `undefined` while the plan's defaults still apply. */
export const subscriptionPairModelsAtom = atom(
    (get) => get(subscriptionPairModelsByPairAtom),
    (get, set, next: {pairKey: SubscriptionPairKey; models: string[]}) => {
        set(subscriptionPairModelsByPairAtom, {
            ...get(subscriptionPairModelsByPairAtom),
            [next.pairKey]: next.models,
        })
    },
)
