import {
    useCallback,
    useEffect,
    useId,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
} from "react"

/**
 * Keyboard navigation for a `/` palette panel's option list.
 *
 * Every panel the palette drills into must be operable without a mouse — see `AGENTS.md` beside
 * this file. Rather than roving `tabIndex`, focus stays on the panel container and
 * `aria-activedescendant` names the active row: one focus target, so Enter/Escape are handled in
 * one place and the rows stay plain divs that mouse and keyboard drive through the same index.
 *
 * The WAI-ARIA shape mirrors `@agenta/ui`'s `components/ui/combobox.tsx`, which already implements
 * this pattern for the searchable select — including opening on the SELECTED row rather than the
 * first, which is what makes a picker show the value currently in effect.
 */
export interface RovingListOptions<T> {
    items: T[]
    /** Row currently in effect, so the panel opens on it instead of the first. */
    current?: T | null
    /** Compare an item to `current`. Defaults to identity. */
    isEqual?: (item: T, current: T) => boolean
    /** Enter on the active row. Panels apply here — no panel adds a confirmation keystroke. */
    onEnter?: (item: T, index: number) => void
    /** `←` steps back out of the panel: → drills in, ← backs out, all the way to the palette. */
    onBack?: () => void
    /** Rows that cannot be activated: arrows skip them and Enter is a no-op. */
    isDisabled?: (item: T) => boolean
}

/** Next enabled index in a direction, wrapping; returns `from` when nothing else qualifies. */
export function stepIndex<T>(
    items: T[],
    from: number,
    dir: 1 | -1,
    isDisabled?: (item: T) => boolean,
): number {
    if (!items.length) return -1
    let i = from < 0 ? (dir === 1 ? -1 : 0) : from
    let remaining = items.length
    while (remaining-- > 0) {
        i = (i + dir + items.length) % items.length
        const item = items[i]
        if (item !== undefined && !isDisabled?.(item)) return i
    }
    return from
}

/** First enabled index, or -1 when every row is disabled (or there are none). */
export function firstEnabledIndex<T>(items: T[], isDisabled?: (item: T) => boolean): number {
    return items.findIndex((item) => !isDisabled?.(item))
}

/** Where a freshly-opened panel lands: the row in effect, else the first enabled one. */
export function initialIndex<T>(
    items: T[],
    current: T | null | undefined,
    isEqual: (item: T, current: T) => boolean = (a, b) => a === b,
    isDisabled?: (item: T) => boolean,
): number {
    if (current != null) {
        const found = items.findIndex((item) => isEqual(item, current))
        if (found >= 0) return found
    }
    return firstEnabledIndex(items, isDisabled)
}

export function useRovingList<T>({
    items,
    current,
    isEqual = (a, b) => a === b,
    onEnter,
    onBack,
    isDisabled,
}: RovingListOptions<T>) {
    const containerRef = useRef<HTMLDivElement | null>(null)
    const rid = useId()
    const optionId = useCallback((index: number) => `${rid}-opt-${index}`, [rid])

    const [activeIndex, setActiveIndex] = useState(() =>
        initialIndex(items, current, isEqual, isDisabled),
    )

    // A panel can mount before its catalog lands (harnesses arrive with the capability map), so
    // seed once more the first time the list is non-empty.
    const seededRef = useRef(items.length > 0)
    useEffect(() => {
        if (seededRef.current || !items.length) return
        seededRef.current = true
        setActiveIndex(initialIndex(items, current, isEqual, isDisabled))
    }, [current, isDisabled, isEqual, items])

    // The dock blurs the composer when a picker opens, so the panel claims focus itself or the
    // arrow keys have nowhere to land.
    useEffect(() => {
        containerRef.current?.focus({preventScroll: true})
    }, [])

    useEffect(() => {
        containerRef.current
            ?.querySelector("[data-active=true]")
            ?.scrollIntoView({block: "nearest"})
    }, [activeIndex])

    const onKeyDown = useCallback(
        (event: ReactKeyboardEvent<HTMLDivElement>) => {
            if (event.key === "ArrowLeft" && onBack) {
                event.preventDefault()
                onBack()
                return
            }
            if (!items.length) return
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault()
                const dir = event.key === "ArrowDown" ? 1 : -1
                setActiveIndex((i) => stepIndex(items, i, dir, isDisabled))
            } else if (event.key === "Home") {
                event.preventDefault()
                setActiveIndex(firstEnabledIndex(items, isDisabled))
            } else if (event.key === "End") {
                event.preventDefault()
                setActiveIndex(stepIndex(items, 0, -1, isDisabled))
            } else if (event.key === "Enter") {
                event.preventDefault()
                const item = items[activeIndex]
                if (item !== undefined && !isDisabled?.(item)) onEnter?.(item, activeIndex)
            }
        },
        [activeIndex, isDisabled, items, onBack, onEnter],
    )

    return {
        activeIndex,
        setActiveIndex,
        /**
         * Spread on the element wrapping the options — not the panel root, which also holds a
         * header and footer. Add `outline-none`: it is focused programmatically, so the ring
         * would read as a stray artifact.
         */
        containerProps: {
            ref: containerRef,
            tabIndex: 0,
            role: "listbox" as const,
            "aria-activedescendant": activeIndex >= 0 ? optionId(activeIndex) : undefined,
            onKeyDown,
        },
        /**
         * Spread on each row. Deliberately does NOT set `aria-selected` — that marks the value in
         * effect, which is a different thing from the keyboard cursor (`data-active`). The panel
         * owns it, as `combobox.tsx` does.
         */
        optionProps: (index: number) => ({
            id: optionId(index),
            role: "option" as const,
            "data-active": index === activeIndex,
            onMouseEnter: () => setActiveIndex(index),
        }),
    }
}
