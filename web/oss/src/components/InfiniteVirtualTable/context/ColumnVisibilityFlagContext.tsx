import {createContext, useContext, useMemo, type PropsWithChildren} from "react"

import {IMMEDIATE_PRIORITY, useAtomValueWithSchedule} from "jotai-scheduler"

import {
    // getScopedColumnVisibilityAtom,
    scopedColumnVisibilityAtomFamily,
} from "../atoms/columnVisibility"

interface ColumnVisibilityFlagContextValue {
    scopeId: string | null
}

const ColumnVisibilityFlagContext = createContext<ColumnVisibilityFlagContextValue | null>(null)

export const ColumnVisibilityFlagProvider = ({
    scopeId,
    children,
}: PropsWithChildren<{scopeId: string | null}>) => {
    const value = useMemo<ColumnVisibilityFlagContextValue>(() => ({scopeId}), [scopeId])
    return (
        <ColumnVisibilityFlagContext.Provider value={value}>
            {children}
        </ColumnVisibilityFlagContext.Provider>
    )
}

const useColumnVisibilityFlagContext = () => useContext(ColumnVisibilityFlagContext)

export const useColumnVisibilityFlag = (columnKey?: string): boolean => {
    const ctx = useColumnVisibilityFlagContext()
    const scopeId = ctx?.scopeId ?? null
    const visibilityAtom = useMemo(
        () => scopedColumnVisibilityAtomFamily({scopeId, columnKey: columnKey ?? ""}),
        [scopeId, columnKey],
    )
    // Use IMMEDIATE_PRIORITY to ensure visibility updates don't lag behind scroll
    // but still allow batching with other updates
    const isVisible =
        useAtomValueWithSchedule(visibilityAtom, {priority: IMMEDIATE_PRIORITY}) ?? false

    return isVisible
}

export default ColumnVisibilityFlagContext
