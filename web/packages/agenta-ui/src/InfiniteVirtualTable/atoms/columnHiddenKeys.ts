import type {Key} from "react"

import {atom, type PrimitiveAtom} from "jotai"
import {atomWithStorage} from "jotai/utils"
import {atomFamily} from "jotai-family"

type HiddenKeysAtom = PrimitiveAtom<Key[]>

interface HiddenKeysParams {
    storageKey: string | null
    defaults: Key[]
    signature: string
    version: number
}

const METADATA_SUFFIX = "__meta"

interface HiddenKeysMeta {
    version: number
    updatedAt: number
}

const arraysEqual = (a: Key[], b: Key[]) => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false
    }
    return true
}

const hiddenKeysAtomFamily = atomFamily(
    ({storageKey, defaults, version}: HiddenKeysParams): HiddenKeysAtom => {
        if (!storageKey) {
            return atom<Key[]>(defaults)
        }
        if (typeof window === "undefined") {
            return atom<Key[]>(defaults)
        }

        const metaStorageKey = `${storageKey}${METADATA_SUFFIX}`
        const metaAtom = atomWithStorage<HiddenKeysMeta>(
            metaStorageKey,
            {version, updatedAt: Date.now()},
            {
                getItem: (key, initialValue) => {
                    try {
                        const raw = window.localStorage.getItem(key)
                        if (!raw) return initialValue
                        const parsed = JSON.parse(raw)
                        if (typeof parsed?.version === "number") {
                            return parsed as HiddenKeysMeta
                        }
                    } catch {
                        // ignore
                    }
                    return initialValue
                },
                setItem: (key, newValue) => {
                    try {
                        window.localStorage.setItem(key, JSON.stringify(newValue))
                    } catch {
                        // ignore
                    }
                },
                removeItem: (key) => {
                    try {
                        window.localStorage.removeItem(key)
                    } catch {
                        // ignore
                    }
                },
            },
        )

        if (!storageKey) {
            return atom<Key[]>(defaults)
        }
        if (typeof window === "undefined") {
            return atom<Key[]>(defaults)
        }
        const storageAtom = atomWithStorage<Key[]>(storageKey, defaults)

        return atom(
            (get) => {
                const meta = get(metaAtom)
                // Version mismatch - return defaults (migration happens on next write)
                if (meta.version !== version) {
                    return defaults
                }
                return get(storageAtom)
            },
            (get, set, next: Key[] | ((prev: Key[]) => Key[])) => {
                const meta = get(metaAtom)
                // If version changed, reset to defaults before applying update
                const current = meta.version !== version ? defaults : get(storageAtom)
                const resolved = typeof next === "function" ? next(current) : next
                set(storageAtom, resolved)
                set(metaAtom, {version, updatedAt: Date.now()})
            },
        ) as HiddenKeysAtom
    },
    (a, b) =>
        (a.storageKey ?? null) === (b.storageKey ?? null) &&
        a.version === b.version &&
        (a.signature === b.signature || arraysEqual(a.defaults, b.defaults)),
)

export const getColumnHiddenKeysAtom = (
    storageKey?: string,
    defaultHiddenKeys: Key[] = [],
): HiddenKeysAtom =>
    hiddenKeysAtomFamily({
        storageKey: storageKey ?? null,
        defaults: defaultHiddenKeys,
        signature: defaultHiddenKeys.join("|"),
        version: defaultHiddenKeys.length,
    })
