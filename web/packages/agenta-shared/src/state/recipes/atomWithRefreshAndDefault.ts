import {atom} from "jotai"
import type {Atom, Getter, SetStateAction, WritableAtom} from "jotai"

type OverwrittenState<Value> = {
    refreshEpoch: unknown
    value: Value
}

/**
 * Creates a writable atom with manual overrides that reset whenever refresh atom changes.
 */
export function atomWithRefreshAndDefault<Value>(
    refreshAtom: Atom<unknown>,
    getDefaultValue: (get: Getter) => Value,
): WritableAtom<Value, [SetStateAction<Value>], void> {
    const overwrittenAtom = atom<OverwrittenState<Value> | null>(null)

    return atom(
        (get) => {
            const refreshEpoch = get(refreshAtom)
            const overwritten = get(overwrittenAtom)

            if (overwritten && Object.is(overwritten.refreshEpoch, refreshEpoch)) {
                return overwritten.value
            }

            return getDefaultValue(get)
        },
        (get, set, update: SetStateAction<Value>) => {
            const refreshEpoch = get(refreshAtom)
            const overwritten = get(overwrittenAtom)
            const baseValue =
                overwritten && Object.is(overwritten.refreshEpoch, refreshEpoch)
                    ? overwritten.value
                    : getDefaultValue(get)
            const nextValue =
                typeof update === "function"
                    ? (update as (currentValue: Value) => Value)(baseValue)
                    : update

            set(overwrittenAtom, {
                refreshEpoch,
                value: nextValue,
            })
        },
    )
}
