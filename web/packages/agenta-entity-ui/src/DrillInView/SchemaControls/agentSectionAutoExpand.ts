import {useEffect, useRef} from "react"

export type SectionCounts = Record<string, number>
export interface SectionCrossing {
    key: string
    open: boolean
}

/** Sections whose count crossed the 0 boundary since `prev`: 0→>0 opens, >0→0 closes. */
export function computeSectionCrossings(
    prev: SectionCounts,
    next: SectionCounts,
): SectionCrossing[] {
    const crossings: SectionCrossing[] = []
    for (const key of Object.keys(next)) {
        const before = prev[key] ?? 0
        const now = next[key] ?? 0
        if (before === 0 && now > 0) crossings.push({key, open: true})
        else if (before > 0 && now === 0) crossings.push({key, open: false})
    }
    return crossings
}

/**
 * Auto-open a list section when it goes from empty to populated (and close it when it
 * empties). Edge-triggered against the previous counts, so a manual collapse of a populated
 * section is never overridden by an unrelated re-render.
 */
export function useAutoExpandOnPopulate(
    counts: SectionCounts,
    setOpen: (key: string, open: boolean) => void,
): void {
    const prev = useRef(counts)
    useEffect(() => {
        for (const {key, open} of computeSectionCrossings(prev.current, counts)) {
            setOpen(key, open)
        }
        prev.current = counts
    }, [counts, setOpen])
}
