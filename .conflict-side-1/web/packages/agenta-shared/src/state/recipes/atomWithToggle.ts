import {atom} from "jotai"
import type {SetStateAction, WritableAtom} from "jotai"

/**
 * Creates a writable boolean atom with convenient toggle semantics.
 * - No argument: toggles the current value.
 * - Boolean/function argument: behaves like a normal SetStateAction.
 */
export function atomWithToggle(
    initialValue = false,
): WritableAtom<boolean, [SetStateAction<boolean>?], void> {
    const baseAtom = atom(initialValue)

    return atom(
        (get) => get(baseAtom),
        (get, set, update?: SetStateAction<boolean>) => {
            const currentValue = get(baseAtom)

            if (update === undefined) {
                set(baseAtom, !currentValue)
                return
            }

            const nextValue =
                typeof update === "function"
                    ? (update as (previousValue: boolean) => boolean)(currentValue)
                    : update

            set(baseAtom, nextValue)
        },
    )
}
