import {useSyncExternalStore} from "react"

import type {Atom} from "jotai"
import {getDefaultStore} from "jotai/vanilla"

/**
 * Reads an atom from Jotai's default store, bypassing any Provider scope.
 *
 * Needed because IVT cell renderers run inside an isolated Jotai Provider,
 * but entity atoms (sessionAtom, projectIdAtom, molecules) live in the default store.
 */
export function useDefaultStoreAtomValue<T>(atom: Atom<T>): T {
    const store = getDefaultStore()
    return useSyncExternalStore(
        (cb) => store.sub(atom, cb),
        () => store.get(atom),
        () => store.get(atom),
    )
}
