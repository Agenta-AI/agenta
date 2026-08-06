import {atom} from "jotai"
import type {Atom, SetStateAction, WritableAtom} from "jotai"

export interface DebouncedAtomBundle<Value> {
    currentValueAtom: WritableAtom<Value, [SetStateAction<Value>], void>
    isDebouncingAtom: Atom<boolean>
    clearTimeoutAtom: WritableAtom<null, [], void>
    debouncedValueAtom: Atom<Value>
}

/**
 * Creates a pair of current/debounced atoms with explicit timeout control.
 */
export function atomWithDebounce<Value>(
    initialValue: Value,
    delayMilliseconds = 500,
    shouldDebounceOnReset = false,
): DebouncedAtomBundle<Value> {
    if (delayMilliseconds < 0) {
        throw new Error("delayMilliseconds must be a non-negative number")
    }

    if (!Number.isFinite(delayMilliseconds)) {
        throw new Error("delayMilliseconds must be finite")
    }

    if (delayMilliseconds > 2_147_483_647) {
        throw new Error("delayMilliseconds must be less than or equal to 2147483647")
    }

    type DebounceTimeout = ReturnType<typeof setTimeout>

    const currentTimeoutAtom = atom<DebounceTimeout | undefined>(undefined)
    const isDebouncingAtom = atom(false)
    const debouncedValueAtom = atom(initialValue)
    const currentValueAtom = atom(initialValue)

    const clearTimeoutAtom = atom(null, (get, set) => {
        const currentTimeout = get(currentTimeoutAtom)
        if (currentTimeout) {
            clearTimeout(currentTimeout)
        }

        set(currentTimeoutAtom, undefined)
        set(isDebouncingAtom, false)
    })

    const observableAtom = atom(
        (get) => get(currentValueAtom),
        (get, set, update: SetStateAction<Value>) => {
            const currentValue = get(currentValueAtom)
            const nextValue =
                typeof update === "function"
                    ? (update as (currentValue: Value) => Value)(currentValue)
                    : update

            set(clearTimeoutAtom)
            set(currentValueAtom, nextValue)

            const shouldSetImmediately =
                delayMilliseconds === 0 ||
                (!shouldDebounceOnReset && Object.is(nextValue, initialValue))

            if (shouldSetImmediately) {
                set(debouncedValueAtom, nextValue)
                return
            }

            set(isDebouncingAtom, true)

            const timeout = setTimeout(() => {
                set(debouncedValueAtom, nextValue)
                set(isDebouncingAtom, false)
                set(currentTimeoutAtom, undefined)
            }, delayMilliseconds)

            set(currentTimeoutAtom, timeout)
        },
    )

    return {
        currentValueAtom: observableAtom,
        isDebouncingAtom,
        clearTimeoutAtom,
        debouncedValueAtom,
    }
}
