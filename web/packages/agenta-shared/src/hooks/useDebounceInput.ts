import {useEffect, useMemo, useRef} from "react"

import {createStore, useAtomValue, useSetAtom} from "jotai"

import {atomWithDebounce} from "../state/recipes"

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
    const store = useMemo(() => createStore(), [])
    const atomsRef = useRef<{
        delay: number
        atoms: ReturnType<typeof atomWithDebounce<T>>
    } | null>(null)

    if (!atomsRef.current || atomsRef.current.delay !== delay) {
        const nextInitialValue = atomsRef.current
            ? store.get(atomsRef.current.atoms.currentValueAtom)
            : initialValue

        atomsRef.current = {
            delay,
            atoms: atomWithDebounce<T>(nextInitialValue, delay, true),
        }
    }

    const debouncedAtoms = atomsRef.current!.atoms
    const localValue = useAtomValue(debouncedAtoms.currentValueAtom, {store})
    const setLocalValue = useSetAtom(debouncedAtoms.currentValueAtom, {store})
    const debouncedValue = useAtomValue(debouncedAtoms.debouncedValueAtom, {store})
    const clearDebounceTimeout = useSetAtom(debouncedAtoms.clearTimeoutAtom, {store})
    // Initialize lastEmittedRef to the initial value to prevent emitting on mount
    const lastEmittedRef = useRef<T>(initialValue)

    // For immediate mode (delay=0), emit directly when localValue changes
    // For debounced mode, emit when debouncedValue changes
    const valueToEmit = delay === 0 ? localValue : debouncedValue

    // Emit only when value differs from what was last emitted.
    // This prevents update feedback loops while ensuring user changes are always emitted.
    useEffect(() => {
        const shouldEmit = !Object.is(valueToEmit, lastEmittedRef.current)
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
        clearDebounceTimeout()
        setLocalValue((prevValue) => {
            return Object.is(value, prevValue) ? prevValue : value
        })
    }, [value, clearDebounceTimeout, setLocalValue])

    return [localValue, setLocalValue] as const
}
