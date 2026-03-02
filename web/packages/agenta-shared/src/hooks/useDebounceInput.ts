import {useState, useEffect, useRef, useCallback} from "react"

/**
 * Local implementation of debounce value hook to avoid dependency issues.
 */
function useDebounceValue<T>(value: T, delay: number): [T, (value: T) => void] {
    const [debouncedValue, setDebouncedValue] = useState(value)

    useEffect(() => {
        if (delay <= 0) {
            setDebouncedValue(value)
            return
        }

        const timer = setTimeout(() => {
            setDebouncedValue(value)
        }, delay)

        return () => {
            clearTimeout(timer)
        }
    }, [value, delay])

    const setValue = useCallback((newValue: T) => {
        setDebouncedValue(newValue)
    }, [])

    return [debouncedValue, setValue]
}

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
 * ```
 */
export function useDebounceInput<T>(
    value: T,
    onChange: (value: T) => void,
    delay = 300,
    defaultValue: T,
) {
    const initialValue = value ?? defaultValue
    const [localValue, setLocalValue] = useState<T>(initialValue)
    const [debouncedValue, setDebouncedValue] = useDebounceValue(localValue, delay)
    // Initialize lastEmittedRef to the initial value to prevent emitting on mount
    const lastEmittedRef = useRef<T>(initialValue)

    // For immediate mode (delay=0), emit directly when localValue changes
    // For debounced mode, emit when debouncedValue changes
    const valueToEmit = delay === 0 ? localValue : debouncedValue

    // Emit only when value differs from what was last emitted.
    // This prevents update feedback loops while ensuring user changes are always emitted.
    useEffect(() => {
        const shouldEmit = valueToEmit !== lastEmittedRef.current
        if (shouldEmit) {
            lastEmittedRef.current = valueToEmit
            onChange?.(valueToEmit)
        }
    }, [valueToEmit, onChange])

    // Sync down stream changes from the controlled value but avoid wiping user input
    // when value is temporarily undefined/null during upstream recalculations.
    useEffect(() => {
        if (value === undefined || value === null) return
        // Update lastEmittedRef to prevent re-emitting the same value we just received
        lastEmittedRef.current = value
        setDebouncedValue(value)
        setLocalValue((prevValue) => {
            return value !== prevValue ? value : prevValue
        })
    }, [value, setDebouncedValue])

    return [localValue, setLocalValue] as const
}
