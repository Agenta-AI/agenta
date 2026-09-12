import {useCallback, useEffect, useMemo, useRef, useState} from "react"

/**
 * Identifies ONE live mount, so an asynchronous chain can prove the mount that started it is still
 * the one that owns the write it is about to make.
 *
 * A boolean "am I mounted" ref is not enough here, for two reasons.
 *
 * The session registry deliberately preserves the same `Chat` instance across a remount, so an old
 * adopter that outlived its mount still holds a working `setMessages` and a working persistence
 * atom. It writes into the CURRENT transcript with a snapshot from before the remount, and it
 * passes its own watermark guard while doing so, because it kept the old mount's watermark refs.
 * Keying on the session id cannot separate the two mounts; they share it.
 *
 * A boolean also fails OPEN across React StrictMode effect generations. StrictMode runs
 * setup, cleanup, setup on one component instance, and a boolean re-armed by the second setup
 * lets work captured before the cleanup complete as though nothing happened. A monotonic number
 * cannot be re-armed to a value anyone captured earlier, so every setup gets an identity of its
 * own.
 *
 * Usage: capture at the START of an asynchronous chain, then check immediately before every
 * adoption or persistence write in it, including after each await.
 */

/** Never handed out, so no captured generation can ever equal it. */
const DEAD = 0

let nextGeneration = 1

export interface MountGeneration {
    /** The generation this mount owns right now, or `DEAD` once it has unmounted. */
    capture: () => number
    /** True only for a generation this mount still owns. A `DEAD` capture is never current. */
    isCurrent: (generation: number) => boolean
}

/**
 * Call this FIRST in a hook or component, before any effect that starts asynchronous work.
 * Effects run in hook order, so declaring it first is what guarantees a later effect re-arms
 * against a live generation rather than capturing `DEAD` on a StrictMode replay.
 */
export const useMountGeneration = (): MountGeneration => {
    // Allocated in a lazy `useState` initializer rather than during render: an abandoned render
    // burns a number (harmless, they are monotonic) but never mutates a ref React would not roll
    // back. The first mount therefore already owns a real generation before ANY effect runs, so
    // hook order only matters for the StrictMode replay below.
    const [firstGeneration] = useState(() => nextGeneration++)
    const generationRef = useRef(firstGeneration)
    useEffect(() => {
        // Only after a cleanup: a re-setup is a new mount as far as anything still in flight is
        // concerned, and it must not be able to re-arm a generation that was already captured.
        if (generationRef.current === DEAD) generationRef.current = nextGeneration++
        return () => {
            generationRef.current = DEAD
        }
    }, [])
    const capture = useCallback(() => generationRef.current, [])
    const isCurrent = useCallback(
        (generation: number) => generation !== DEAD && generation === generationRef.current,
        [],
    )
    return useMemo(() => ({capture, isCurrent}), [capture, isCurrent])
}
