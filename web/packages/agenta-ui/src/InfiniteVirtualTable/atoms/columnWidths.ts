import {atom, type PrimitiveAtom} from "jotai"

type ColumnWidthAtom = PrimitiveAtom<Record<string, number>>

const DEFAULT_SCOPE = "__default__"
const scopeKey = (scopeId: string | null | undefined) => scopeId ?? DEFAULT_SCOPE

const atomCache = new Map<string, ColumnWidthAtom>()

const createColumnWidthsAtom = (scopeId: string | null | undefined) => {
    const key = scopeKey(scopeId)
    const cached = atomCache.get(key)
    if (cached) {
        return cached
    }

    // Use simple atom without storage - widths are session-only and reset on navigation
    const safeAtom: ColumnWidthAtom = atom<Record<string, number>>({})

    atomCache.set(key, safeAtom)
    return safeAtom
}

export const getColumnWidthsAtom = (scopeId: string | null | undefined) =>
    createColumnWidthsAtom(scopeId)
