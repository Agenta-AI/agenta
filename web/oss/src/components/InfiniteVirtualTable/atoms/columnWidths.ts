import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

type ColumnWidthAtom = ReturnType<typeof atomWithStorage<Record<string, number>>>

const DEFAULT_SCOPE = "__default__"
const scopeKey = (scopeId: string | null | undefined) => scopeId ?? DEFAULT_SCOPE
const storageKey = (scopeId: string | null | undefined) =>
    `infinite-table:column-widths:${scopeKey(scopeId)}`

const atomCache = new Map<string, ColumnWidthAtom>()

const createColumnWidthsAtom = (scopeId: string | null | undefined) => {
    const key = scopeKey(scopeId)
    const cached = atomCache.get(key)
    if (cached) {
        return cached
    }

    const safeAtom: ColumnWidthAtom =
        typeof window === "undefined"
            ? (atom<Record<string, number>>({}) as ColumnWidthAtom)
            : atomWithStorage<Record<string, number>>(storageKey(scopeId), {})

    atomCache.set(key, safeAtom)
    return safeAtom
}

export const getColumnWidthsAtom = (scopeId: string | null | undefined) =>
    createColumnWidthsAtom(scopeId)
