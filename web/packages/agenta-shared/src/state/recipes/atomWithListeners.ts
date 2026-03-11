import {useEffect, useRef} from "react"

import {atom, useSetAtom} from "jotai"
import type {Getter, SetStateAction, Setter} from "jotai"

export type AtomListener<Value> = (
    get: Getter,
    set: Setter,
    nextValue: Value,
    previousValue: Value,
    update: SetStateAction<Value>,
) => void

/**
 * Creates a writable atom together with a hook that can subscribe to writes.
 */
export function atomWithListeners<Value>(initialValue: Value) {
    const baseAtom = atom(initialValue)
    const listenersAtom = atom([] as AtomListener<Value>[])

    const observableAtom = atom(
        (get) => get(baseAtom),
        (get, set, update: SetStateAction<Value>) => {
            const previousValue = get(baseAtom)
            const nextValue =
                typeof update === "function"
                    ? (update as (prev: Value) => Value)(previousValue)
                    : update

            set(baseAtom, nextValue)

            for (const listener of get(listenersAtom)) {
                listener(get, set, nextValue, previousValue, update)
            }
        },
    )

    const useListener = (listener: AtomListener<Value>) => {
        const setListeners = useSetAtom(listenersAtom)
        const listenerRef = useRef(listener)

        useEffect(() => {
            listenerRef.current = listener
        }, [listener])

        useEffect(() => {
            const wrappedListener: AtomListener<Value> = (...args) => listenerRef.current(...args)

            setListeners((prev) => [...prev, wrappedListener])

            return () => {
                setListeners((prev) => prev.filter((current) => current !== wrappedListener))
            }
        }, [setListeners])
    }

    return [observableAtom, useListener] as const
}
