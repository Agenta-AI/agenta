import {useCallback, useEffect, useRef, useState} from "react"

/**
 * A search field whose writes reach an atom on a debounce, and which follows that atom when
 * something else writes to it.
 *
 * `initial` is the atom's current value. Search atoms are module-level, so a reader who leaves a
 * narrowed list and comes back would otherwise find an empty box over filtered rows — which reads
 * as broken rather than as filtered.
 *
 * Passing it also means the hook has to tell OUR write landing apart from an outside one. Every
 * keystroke eventually sets the atom, so adopting each new `initial` blindly would overwrite the
 * draft with a value the reader has already typed past. `lastApplied` records what this hook put
 * there; anything else is a reset, a route scope, or another surface, and only that wins.
 */
export function useDebouncedAtomSearch(setAtom: (v: string) => void, delay = 300, initial = "") {
    const [local, setLocal] = useState(initial)
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const lastApplied = useRef(initial)

    const apply = useCallback(
        (v: string) => {
            lastApplied.current = v
            setAtom(v)
        },
        [setAtom],
    )

    // An outside write — `applySessionScopeAtom` landing on a `?mode=` route, a reset, another
    // surface. It cancels a pending write of ours: the reader's half-typed term lost the race the
    // moment the value changed underneath it.
    useEffect(() => {
        if (initial === lastApplied.current) return
        clearTimeout(timerRef.current)
        lastApplied.current = initial
        setLocal(initial)
    }, [initial])

    const onChange = useCallback(
        (v: string) => {
            setLocal(v)
            clearTimeout(timerRef.current)
            // Clearing applies at once: an empty box over filtered rows reads as broken.
            if (v === "") apply(v)
            else timerRef.current = setTimeout(() => apply(v), delay)
        },
        [apply, delay],
    )

    const reset = useCallback(() => {
        clearTimeout(timerRef.current)
        setLocal("")
        apply("")
    }, [apply])

    useEffect(() => () => clearTimeout(timerRef.current), [])

    return {value: local, onChange, reset}
}
