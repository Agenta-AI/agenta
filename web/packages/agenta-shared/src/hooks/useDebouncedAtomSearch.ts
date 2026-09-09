import {useCallback, useEffect, useRef, useState} from "react"

/**
 * `initial` seeds the field from an atom that outlives the mount. Search atoms are module-level,
 * so a reader who leaves a narrowed list and comes back would otherwise find an empty box over
 * filtered rows — which reads as broken rather than as filtered.
 */
export function useDebouncedAtomSearch(setAtom: (v: string) => void, delay = 300, initial = "") {
    const [local, setLocal] = useState(initial)
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

    const onChange = useCallback(
        (v: string) => {
            setLocal(v)
            clearTimeout(timerRef.current)
            timerRef.current = setTimeout(() => setAtom(v), delay)
        },
        [setAtom, delay],
    )

    const reset = useCallback(() => {
        clearTimeout(timerRef.current)
        setLocal("")
        setAtom("")
    }, [setAtom])

    useEffect(() => () => clearTimeout(timerRef.current), [])

    return {value: local, onChange, reset}
}
