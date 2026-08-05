import {useCallback, useMemo} from "react"
import type {Key} from "react"

import type {ColumnsType} from "antd/es/table"

import type {ColumnTreeNode, ColumnVisibilityState} from "../types"

/**
 * Return type of useColumnVisibility hook
 * Note: The hook uses string internally for keys but the atom uses React.Key
 */
interface ColumnVisibilityHookResult<RecordType> {
    visibleColumns: ColumnsType<RecordType>
    leafKeys: string[]
    allKeys: string[]
    hiddenKeys: Key[]
    isHidden: (key: string) => boolean
    showColumn: (key: string) => void
    hideColumn: (key: string) => void
    toggleColumn: (key: string) => void
    toggleTree: (key: string) => void
    reset: () => void
    columnTree: ColumnTreeNode[]
    setHiddenKeys: (keys: Key[] | ((prev: Key[]) => Key[])) => void
    version: number
}

/**
 * Creates normalized column visibility controls that work with React.Key
 */
const useColumnVisibilityControls = <RecordType>(
    hookResult: ColumnVisibilityHookResult<RecordType>,
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
