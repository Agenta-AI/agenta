import type {SetStateAction} from "jotai"
import {atomWithReducer} from "jotai/utils"

/**
 * Creates an atom that only updates when values are meaningfully different
 * according to the provided comparator.
 */
export function atomWithCompare<Value>(
    initialValue: Value,
    areEqual: (prev: Value, next: Value) => boolean,
) {
    return atomWithReducer(initialValue, (prev: Value, next: SetStateAction<Value>) => {
        const nextValue = typeof next === "function" ? (next as (prev: Value) => Value)(prev) : next
        return areEqual(prev, nextValue) ? prev : nextValue
    })
}
