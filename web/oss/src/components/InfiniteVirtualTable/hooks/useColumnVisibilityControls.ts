import {useCallback, useMemo} from "react"
import type {Key} from "react"

import type {ColumnVisibilityState} from "../types"

interface ColumnVisibilityHookResult {
    visibleColumns: any[]
    leafKeys: any[]
    allKeys: any[]
    hiddenKeys: any[]
    isHidden: (key: any) => boolean
    showColumn: (key: any) => void
    hideColumn: (key: any) => void
    toggleColumn: (key: any) => void
    toggleTree: (key: any) => void
    reset: () => void
    columnTree: any[]
    setHiddenKeys: (keys: any) => void
    version: number
}

/**
 * Creates normalized column visibility controls that work with React.Key
 */
const useColumnVisibilityControls = <RecordType>(
    hookResult: ColumnVisibilityHookResult,
): ColumnVisibilityState<RecordType> => {
    const {
        visibleColumns,
        leafKeys,
        allKeys,
        hiddenKeys,
        isHidden,
        showColumn,
        hideColumn,
        toggleColumn,
        toggleTree,
        reset,
        columnTree,
        setHiddenKeys,
        version,
    } = hookResult

    const normalizedIsHidden = useCallback((key: Key) => isHidden(String(key)), [isHidden])
    const normalizedShowColumn = useCallback((key: Key) => showColumn(String(key)), [showColumn])
    const normalizedHideColumn = useCallback((key: Key) => hideColumn(String(key)), [hideColumn])
    const normalizedToggleColumn = useCallback(
        (key: Key) => toggleColumn(String(key)),
        [toggleColumn],
    )
    const normalizedToggleTree = useCallback((key: Key) => toggleTree(String(key)), [toggleTree])
    const normalizedSetHiddenKeys = useCallback(
        (keys: Key[]) => setHiddenKeys(keys.map((key) => String(key))),
        [setHiddenKeys],
    )

    const controls = useMemo<ColumnVisibilityState<RecordType>>(
        () => ({
            columnTree,
            leafKeys,
            allKeys,
            hiddenKeys,
            isHidden: normalizedIsHidden,
            showColumn: normalizedShowColumn,
            hideColumn: normalizedHideColumn,
            toggleColumn: normalizedToggleColumn,
            toggleTree: normalizedToggleTree,
            reset,
            setHiddenKeys: normalizedSetHiddenKeys,
            visibleColumns,
            version,
        }),
        [
            columnTree,
            leafKeys,
            allKeys,
            hiddenKeys,
            normalizedIsHidden,
            normalizedShowColumn,
            normalizedHideColumn,
            normalizedToggleColumn,
            normalizedToggleTree,
            reset,
            normalizedSetHiddenKeys,
            visibleColumns,
            version,
        ],
    )

    return controls
}

export default useColumnVisibilityControls
