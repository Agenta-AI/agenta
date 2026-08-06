import {useCallback} from "react"

import {useAtom} from "jotai"
import type {PrimitiveAtom} from "jotai"

/**
 * Works like `useReducer`, but reads/writes to a Jotai primitive atom.
 */
export function useReducerAtom<Value, Action>(
    atom: PrimitiveAtom<Value>,
    reducer: (value: Value, action: Action) => Value,
) {
    const [value, setValue] = useAtom(atom)

    const dispatch = useCallback(
        (action: Action) => {
            setValue((previousValue) => reducer(previousValue, action))
        },
        [reducer, setValue],
    )

    return [value, dispatch] as const
}
