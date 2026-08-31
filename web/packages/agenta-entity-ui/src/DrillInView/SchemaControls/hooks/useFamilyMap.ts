import {useMemo} from "react"

import {atom, useAtomValue, type Atom} from "jotai"

/** Read one atom-family entry per key in one subscription. Keys join into a string so the
 *  memo has one stable dependency; an array would rebuild the atom every render. */
export function useFamilyMap<T>(keysKey: string, family: (key: string) => Atom<T>): Map<string, T> {
    const derived = useMemo(() => {
        const keys = keysKey ? keysKey.split("\n") : []
        return atom((get) => keys.map((key) => [key, get(family(key))] as const))
    }, [keysKey, family])
    const pairs = useAtomValue(derived)
    return useMemo(() => new Map(pairs), [pairs])
}
