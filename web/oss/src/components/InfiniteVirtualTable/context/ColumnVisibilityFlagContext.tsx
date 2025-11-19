import {createContext, useContext, useMemo, type PropsWithChildren} from "react"

import {useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"
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
        // selectAtom(
        //     (state) => state,
        //     (a, b) => a === b,
        // ),
        [scopeId, columnKey],
    )
    return useAtomValue(visibilityAtom) ?? false
    // useAtomValueWithSchedule(visibilityAtom, {priority: IMMEDIATE_PRIORITY})
}

export default ColumnVisibilityFlagContext
