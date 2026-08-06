import {atom} from "jotai"
import type {SetStateAction, WritableAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"

/**
 * Creates a persisted boolean atom with toggle semantics.
 * - No argument: toggles the current value.
 * - Boolean/function argument: behaves like a normal SetStateAction.
 */
export function atomWithToggleAndStorage(
    key: string,
    initialValue = false,
): WritableAtom<boolean, [SetStateAction<boolean>?], void> {
    const persistedAtom = atomWithStorage<boolean>(key, initialValue)

    return atom(
        (get) => get(persistedAtom),
        (get, set, update?: SetStateAction<boolean>) => {
            const currentValue = get(persistedAtom)

            if (update === undefined) {
                set(persistedAtom, !currentValue)
                return
            }

            const nextValue =
                typeof update === "function"
                    ? (update as (previousValue: boolean) => boolean)(currentValue)
                    : update

            set(persistedAtom, nextValue)
        },
    )
}
