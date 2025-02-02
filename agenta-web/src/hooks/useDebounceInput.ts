import {useState, useEffect} from "react"
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
    delay: number = 300,
    defaultValue: T,
) {
    const [localValue, setLocalValue] = useState<T>(value ?? defaultValue)
    const [query, setQuery] = useDebounceValue(localValue, delay)

    useLazyEffect(() => {
        onChange?.(query)
    }, [query])

    useEffect(() => {
        setQuery(value)
        setLocalValue((prevValue) => {
            const newValue = value ?? defaultValue
            if (newValue !== prevValue) {
                return newValue
            }
            return prevValue
        })
    }, [value, defaultValue])

    return [localValue, setLocalValue] as const
}
