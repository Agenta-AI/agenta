import type {Key, ReactNode} from "react"
import {useCallback, useMemo, useRef, useState} from "react"

import {MinusCircleOutlined, PlusCircleOutlined, LoadingOutlined} from "@ant-design/icons"
import type {TableProps} from "antd/es/table"

import type {ExpandableRowConfig} from "../types"

interface ExpandedRowState<ChildType> {
    loading: boolean
    error: Error | null
    children: ChildType[] | null
}

interface UseExpandableRowsConfig<RecordType, ChildType> {
    config: ExpandableRowConfig<RecordType, ChildType> | undefined
    rowKey: TableProps<RecordType>["rowKey"]
    // dataSource is available for future use (e.g., clearing cache on data change)
    _dataSource?: RecordType[]
}

interface UseExpandableRowsReturn<RecordType, _ChildType> {
    expandedRowKeys: Key[]
    expandedRowRender: ((record: RecordType) => ReactNode) | undefined
    onExpand: (expanded: boolean, record: RecordType) => void
    expandIcon:
        | ((props: {
              expanded: boolean
              onExpand: (record: RecordType, e: React.MouseEvent<HTMLElement>) => void
              record: RecordType
          }) => ReactNode)
        | undefined
    rowExpandable: ((record: RecordType) => boolean) | undefined
    expandColumnWidth: number | undefined
    expandFixed: "left" | "right" | undefined
    /**
     * Render function for the expand icon that can be used within a cell.
     * Use this when showExpandIconInCell is true.
     */
    renderExpandIcon: (record: RecordType) => ReactNode
    /**
     * Check if a specific row is expanded
     */
    isExpanded: (record: RecordType) => boolean
}

/**
 * Hook to manage expandable row state and behavior for InfiniteVirtualTable.
 * Handles async data fetching, caching, and rendering of expanded content.
 */
export function useExpandableRows<RecordType extends object, ChildType = unknown>({
    config,
    rowKey,
    dataSource,
}: UseExpandableRowsConfig<RecordType, ChildType>): UseExpandableRowsReturn<RecordType, ChildType> {
    const [expandedRowKeys, setExpandedRowKeys] = useState<Key[]>([])
    const [expandedStates, setExpandedStates] = useState<Map<Key, ExpandedRowState<ChildType>>>(
        new Map(),
    )
    const childrenCacheRef = useRef<Map<Key, ChildType[]>>(new Map())

    // Helper to get row key from record
    const getRowKey = useCallback(
        (record: RecordType): Key => {
            if (typeof rowKey === "function") {
                return rowKey(record)
            }
            return (record as Record<string, unknown>)[rowKey as string] as Key
        },
        [rowKey],
    )

    // Handle row expand/collapse
    const onExpand = useCallback(
        async (expanded: boolean, record: RecordType) => {
            if (!config) return

            const key = getRowKey(record)
            const cacheChildren = config.cacheChildren !== false

            if (expanded) {
                // Accordion mode: collapse other rows
                if (config.accordion) {
                    setExpandedRowKeys([key])
                } else {
                    setExpandedRowKeys((prev) => [...prev, key])
                }

                // Check cache first
                if (cacheChildren && childrenCacheRef.current.has(key)) {
                    setExpandedStates((prev) => {
                        const next = new Map(prev)
                        next.set(key, {
                            loading: false,
                            error: null,
                            children: childrenCacheRef.current.get(key) ?? null,
                        })
                        return next
                    })
                    return
                }

                // Set loading state
                setExpandedStates((prev) => {
                    const next = new Map(prev)
                    next.set(key, {loading: true, error: null, children: null})
                    return next
                })

                // Fetch children
                try {
                    const children = await config.fetchChildren(record)
                    if (cacheChildren) {
                        childrenCacheRef.current.set(key, children)
                    }
                    setExpandedStates((prev) => {
                        const next = new Map(prev)
                        next.set(key, {loading: false, error: null, children})
                        return next
                    })
                } catch (error) {
                    setExpandedStates((prev) => {
                        const next = new Map(prev)
                        next.set(key, {
                            loading: false,
                            error: error instanceof Error ? error : new Error(String(error)),
                            children: null,
                        })
                        return next
                    })
                }
            } else {
                // Collapse
                setExpandedRowKeys((prev) => prev.filter((k) => k !== key))
            }
        },
        [config, getRowKey],
    )

    // Render expanded row content
    const expandedRowRender = useMemo(() => {
        if (!config) return undefined

        return (record: RecordType) => {
            const key = getRowKey(record)
            const state = expandedStates.get(key)
            const loading = state?.loading ?? false
            const error = state?.error ?? null
            const children = state?.children ?? []

            return config.renderExpanded(record, children, loading, error)
        }
    }, [config, expandedStates, getRowKey])

    // Custom expand icon
    const expandIcon = useMemo(() => {
        if (!config) return undefined

        return ({
            expanded,
            onExpand: triggerExpand,
            record,
        }: {
            expanded: boolean
            onExpand: (record: RecordType, e: React.MouseEvent<HTMLElement>) => void
            record: RecordType
        }) => {
            const key = getRowKey(record)
            const state = expandedStates.get(key)
            const loading = state?.loading ?? false

            // Check if row is expandable
            if (config.isExpandable && !config.isExpandable(record)) {
                return <span className="w-4" />
            }

            // Custom icon renderer
            if (config.expandIcon) {
                return config.expandIcon({
                    expanded,
                    onExpand: () => triggerExpand(record, {} as React.MouseEvent<HTMLElement>),
                    record,
                    loading,
                })
            }

            // Default icon - circle style matching app registry
            return (
                <span
                    className="cursor-pointer text-gray-400 hover:text-gray-600 transition-colors"
                    onClick={(e) => {
                        e.stopPropagation()
                        triggerExpand(record, e)
                    }}
                >
                    {loading ? (
                        <LoadingOutlined style={{fontSize: 14}} />
                    ) : expanded ? (
                        <MinusCircleOutlined style={{fontSize: 14}} />
                    ) : (
                        <PlusCircleOutlined style={{fontSize: 14}} />
                    )}
                </span>
            )
        }
    }, [config, expandedStates, getRowKey])

    // Row expandable check
    const rowExpandable = useMemo(() => {
        if (!config) return undefined
        if (!config.isExpandable) return undefined
        return config.isExpandable
    }, [config])

    // Check if a record is expanded
    const isExpanded = useCallback(
        (record: RecordType): boolean => {
            const key = getRowKey(record)
            return expandedRowKeys.includes(key)
        },
        [expandedRowKeys, getRowKey],
    )

    // Render expand icon for use within a cell (when showExpandIconInCell is true)
    const renderExpandIcon = useCallback(
        (record: RecordType): ReactNode => {
            if (!config) return null

            // Check if row is expandable
            if (config.isExpandable && !config.isExpandable(record)) {
                return <span className="w-[14px] inline-block" />
            }

            const key = getRowKey(record)
            const expanded = expandedRowKeys.includes(key)
            const state = expandedStates.get(key)
            const loading = state?.loading ?? false

            // Custom icon renderer
            if (config.expandIcon) {
                return config.expandIcon({
                    expanded,
                    onExpand: () => onExpand(!expanded, record),
                    record,
                    loading,
                })
            }

            // Default circle icon
            return (
                <span
                    className="cursor-pointer text-gray-400 hover:text-gray-600 transition-colors inline-flex items-center"
                    onClick={(e) => {
                        e.stopPropagation()
                        onExpand(!expanded, record)
                    }}
                >
                    {loading ? (
                        <LoadingOutlined style={{fontSize: 14}} />
                    ) : expanded ? (
                        <MinusCircleOutlined style={{fontSize: 14}} />
                    ) : (
                        <PlusCircleOutlined style={{fontSize: 14}} />
                    )}
                </span>
            )
        },
        [config, expandedRowKeys, expandedStates, getRowKey, onExpand],
    )

    return {
        expandedRowKeys,
        expandedRowRender,
        onExpand,
        expandIcon,
        rowExpandable,
        expandColumnWidth: config?.showExpandIconInCell ? 0 : (config?.columnWidth ?? 48),
        expandFixed: config?.fixed,
        renderExpandIcon,
        isExpanded,
    }
}

export default useExpandableRows
