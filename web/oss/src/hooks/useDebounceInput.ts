import {useState, useEffect, useRef} from "react"

import {useDebounceValue} from "usehooks-ts"

import useLazyEffect from "./useLazyEffect"

/**
 * A custom hook that provides debounced input handling with synchronized local and parent state.
 *
 * @description
 * This hook manages the local state of an input while providing debounced updates to the parent component.
 * It handles the common pattern of maintaining responsive UI feedback while preventing excessive updates.
 *
 * @template T - The type of the input value (e.g., string, number, etc.)
 *
 * @param value - The controlled value from the parent component
 * @param onChange - Callback function to update the parent state
 * @param delay - Debounce delay in milliseconds (default: 300)
 * @param defaultValue - Default value to use when the input value is undefined or null
 *
 * @returns A tuple containing:
 * - localValue: The current local state value
 * - setLocalValue: Function to update the local state
 *
 * @example
 * ```tsx
 * // Using with a text input
 * const TextInput = ({ value, onChange }) => {
 *   const [localValue, setLocalValue] = useDebounceInput<string>(value, onChange, 300, "");
 *
 *   return (
 *     <input
 *       value={localValue}
 *       onChange={(e) => setLocalValue(e.target.value)}
 *     />
 *   );
 * };
 *
 * // Using with a numeric input
 * const NumberInput = ({ value, onChange }) => {
 *   const [localValue, setLocalValue] = useDebounceInput<number>(value, onChange, 300, 0);
 *
 *   return (
 *     <input
 *       type="number"
 *       value={localValue}
 *       onChange={(e) => setLocalValue(Number(e.target.value))}
 *     />
 *   );
 * };
 * ```
 */
export function useDebounceInput<T>(
    value: T,
    onChange: (value: T) => void,
    delay = 300,
    defaultValue: T,
) {
    const [localValue, setLocalValue] = useState<T>(value ?? defaultValue)
    const [query, setQuery] = useDebounceValue(localValue, delay)
    const lastEmittedRef = useRef<T | undefined>(undefined)

    // Emit only when debounced value differs from the latest controlled value
    // and hasn't been emitted already. This prevents update feedback loops.
    useLazyEffect(() => {
        const controlled = value ?? defaultValue
        const shouldEmit = query !== controlled && query !== lastEmittedRef.current
        if (shouldEmit) {
            lastEmittedRef.current = query
            onChange?.(query)
        }
    }, [query, value, defaultValue])

    // Sync down stream changes from the controlled value but avoid wiping user input
    // when value is temporarily undefined/null during upstream recalculations.
    useEffect(() => {
        if (value === undefined || value === null) return
        setQuery(value)
        setLocalValue((prevValue) => {
            return value !== prevValue ? value : prevValue
        })
    }, [value])

    // // Immediate emit on clears to avoid stale values when users submit quickly after deleting
    // useEffect(() => {
    //     const controlled = value ?? defaultValue
    //     const isCleared = (localValue as any) === ""
    //     if (isCleared && localValue !== controlled && localValue !== lastEmittedRef.current) {
    //         lastEmittedRef.current = localValue
    //         onChange?.(localValue)
    //     }
    //     // eslint-disable-next-line react-hooks/exhaustive-deps
    // }, [localValue])

    return [localValue, setLocalValue] as const
}
