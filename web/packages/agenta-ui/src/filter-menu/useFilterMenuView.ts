import {useCallback, useEffect, useRef, useState} from "react"

/**
 * A filter menu's view state, with the parts worth remembering kept in `localStorage`.
 *
 * Which parts is the consumer's call, because the two halves are not the same kind of thing: how
 * a list is CUT is a display preference a reader sets once and expects to find again, while what
 * it is FILTERED to is a question they were asking at the time. A list that reopens already
 * narrowed looks broken — the rows are missing and the reason is a menu away — so `persist` names
 * the keys that survive and everything else starts from `fallback`.
 *
 * Read after mount rather than during render: the server has no `localStorage`, and seeding state
 * from it would hydrate a different tree than the one that was sent.
 */
export const useFilterMenuView = <View extends Record<string, unknown>>({
    key,
    fallback,
    persist,
}: {
    /** `localStorage` key. Prefix it with `agenta:` and name the surface — `agenta:automations:view`. */
    key: string
    fallback: View
    /** The keys of `View` to remember. Anything else resets each visit. */
    persist: (keyof View)[]
}): [View, (next: View) => void] => {
    const [view, setViewState] = useState<View>(fallback)
    // The stored value is applied once, and only over keys `persist` names — a later write must
    // not be undone by the read that was still catching up.
    const applied = useRef(false)

    useEffect(() => {
        if (applied.current) return
        applied.current = true
        try {
            const raw = window.localStorage.getItem(key)
            if (!raw) return
            const stored = JSON.parse(raw) as Partial<View>
            const kept: Partial<View> = {}
            for (const field of persist) {
                // A key the stored object does not carry is one this surface gained since it was
                // written; it takes the fallback rather than `undefined`.
                if (stored[field] !== undefined) kept[field] = stored[field]
            }
            if (Object.keys(kept).length) setViewState((current) => ({...current, ...kept}))
        } catch {
            // A private window, a full quota, or a value someone else wrote: the view is still
            // usable at its defaults, and a broken preference is not worth a broken screen.
        }
        // Mount only: `persist` is a literal at every call site, and re-reading would fight writes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key])

    const setView = useCallback(
        (next: View) => {
            setViewState(next)
            try {
                const kept: Partial<View> = {}
                for (const field of persist) kept[field] = next[field]
                window.localStorage.setItem(key, JSON.stringify(kept))
            } catch {
                // Storage refused. The view still changed; only the memory of it is lost.
            }
            // eslint-disable-next-line react-hooks/exhaustive-deps
        },
        [key],
    )

    return [view, setView]
}
