import {atomWithStorage} from "jotai/utils"

import {STRIP_HIDDEN_STORAGE_KEY} from "./assets/constants"

/** One shared hidden flag across BOTH playground surfaces (onboarding + agent empty chat).
 * Home ignores it (the strip is always visible there). */
export const stripHiddenAtom = atomWithStorage<boolean>(STRIP_HIDDEN_STORAGE_KEY, false)
