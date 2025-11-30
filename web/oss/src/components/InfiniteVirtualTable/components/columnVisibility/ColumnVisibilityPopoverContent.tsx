import {useCallback, useEffect, useMemo, useState} from "react"

import {FolderOpenOutlined, FileOutlined} from "@ant-design/icons"
import {ArrowCounterClockwise} from "@phosphor-icons/react"
import {Button, Input, Space, Tree, Typography} from "antd"
import type {DataNode} from "antd/es/tree"
import {LOW_PRIORITY, useSetAtomWithSchedule} from "jotai-scheduler"

import {getColumnWidthsAtom} from "../../atoms/columnWidths"
import {useColumnVisibilityControls, type ColumnVisibilityState} from "../../InfiniteVirtualTable"
import type {
    ColumnTreeNode,
    ColumnVisibilityNodeMeta,
    ColumnVisibilityNodeMetaResolver,
} from "../../types"

export interface ColumnVisibilityPopoverContentProps<RowType extends object> {
    onClose: () => void
    controls?: ColumnVisibilityState<RowType>
    scopeId?: string | null
    resolveNodeMeta?: ColumnVisibilityNodeMetaResolver
}

type VisibilityTreeNode = DataNode & {searchLabel: string}

const ColumnVisibilityPopoverContent = <RowType extends object>({
    onClose,
    controls,
    scopeId = null,
    resolveNodeMeta,
}: ColumnVisibilityPopoverContentProps<RowType>) => {
    const fallbackControls = useColumnVisibilityControls<RowType>()
    const visibilityControls = controls ?? fallbackControls
    const {columnTree, leafKeys, toggleColumn, toggleTree, reset, setHiddenKeys} =
        visibilityControls

    const columnWidthsAtom = useMemo(() => getColumnWidthsAtom(scopeId), [scopeId])
    const setColumnWidths = useSetAtomWithSchedule(columnWidthsAtom, {
        priority: LOW_PRIORITY,
    })

    const [search, setSearch] = useState("")
    const allTreeKeys = useMemo(() => {
        const keys: string[] = []
        const walk = (nodes: typeof columnTree) => {
            nodes.forEach((node) => {
                keys.push(String(node.key))
                if (node.children?.length) {
                    walk(node.children)
                }
            })
        }
        walk(columnTree)
        return keys
    }, [columnTree])
    const [expandedKeys, setExpandedKeys] = useState<string[]>(allTreeKeys)

    useEffect(() => {
        setExpandedKeys(allTreeKeys)
    }, [allTreeKeys])

    const allNodes = useMemo(() => {
        const nodes: ColumnTreeNode[] = []
        const walk = (items: typeof columnTree) => {
            items.forEach((node) => {
                nodes.push(node)
                if (node.children?.length) {
                    walk(node.children)
                }
            })
        }
        walk(columnTree)
        return nodes
    }, [columnTree])

    const [resolvedNodeMetaMap, setResolvedNodeMetaMap] = useState(
        () => new Map<string, ColumnVisibilityNodeMeta>(),
    )

    useEffect(() => {
        if (!resolveNodeMeta) {
            setResolvedNodeMetaMap(new Map())
            return
        }
        let active = true
        setResolvedNodeMetaMap(new Map())

        allNodes.forEach((node) => {
            const key = String(node.key)
            Promise.resolve(resolveNodeMeta(node)).then((meta) => {
                if (!active || !meta) return
                setResolvedNodeMetaMap((prev) => {
                    const existing = prev.get(key)
                    if (existing === meta) return prev
                    const next = new Map(prev)
                    next.set(key, meta)
                    return next
                })
            })
        })

        return () => {
            active = false
        }
    }, [allNodes, resolveNodeMeta])

    const defaultNodeMeta = useCallback(
        (node: ColumnTreeNode, hasChildren: boolean): ColumnVisibilityNodeMeta => {
            const key = String(node.key)
            const label = node.titleNode ?? node.label ?? key
            return {
                title:
                    typeof label === "string" ? (
                        <Typography.Text className={hasChildren ? "font-semibold" : ""} ellipsis>
                            {label}
                        </Typography.Text>
                    ) : (
                        label
                    ),
                searchValues: [typeof label === "string" ? label : undefined, key],
                icon: hasChildren ? <FolderOpenOutlined /> : <FileOutlined />,
            }
        },
        [],
    )

    const treeData = useMemo<VisibilityTreeNode[]>(() => {
        const mapNodes = (nodes: typeof columnTree): VisibilityTreeNode[] =>
            nodes.map((node) => {
                const hasChildren = Boolean(node.children?.length)
                const key = String(node.key)
                const customMeta = resolvedNodeMetaMap.get(key)
                const defaultMeta = defaultNodeMeta(node, hasChildren)
                const meta = customMeta ?? defaultMeta
                const title = meta.title ?? defaultMeta.title
                const icon =
                    meta.icon ??
                    defaultMeta.icon ??
                    (hasChildren ? <FolderOpenOutlined /> : <FileOutlined />)
                const searchValues = meta.searchValues ??
                    defaultMeta.searchValues ?? [
                        node.label ?? undefined,
                        typeof node.key === "string" ? node.key : key,
                    ]
                const searchLabel = searchValues
                    .filter((segment): segment is string => Boolean(segment))
                    .join(" ")

                const children = hasChildren ? mapNodes(node.children) : undefined

                return {
                    key,
                    title,
                    icon,
                    children,
                    selectable: false,
                    searchLabel,
                    checked: node.checked,
                    indeterminate: node.indeterminate,
                } as VisibilityTreeNode
            })

        return mapNodes(columnTree)
    }, [columnTree, defaultNodeMeta, resolvedNodeMetaMap])

    const filterTreeData = useCallback(
        (nodes: VisibilityTreeNode[], query: string): VisibilityTreeNode[] =>
            nodes
                .map((node) => {
                    const children = Array.isArray(node.children)
                        ? filterTreeData(node.children as VisibilityTreeNode[], query)
                        : undefined
                    const matches = node.searchLabel.toLowerCase().includes(query)
                    if (matches || (children && children.length)) {
                        return {...node, children}
                    }
                    return null
                })
                .filter(Boolean) as VisibilityTreeNode[],
        [],
    )

    const filteredTreeData = useMemo(() => {
        const query = search.trim().toLowerCase()
        if (!query) return treeData
        return filterTreeData(treeData, query)
    }, [filterTreeData, search, treeData])

    const checkedKeys = useMemo(() => {
        const keys: string[] = []
        const gather = (nodes: typeof columnTree) => {
            nodes.forEach((node) => {
                if (node.checked) keys.push(String(node.key))
                if (node.children?.length) gather(node.children)
            })
        }
        gather(columnTree)
        return keys
    }, [columnTree])

    const halfCheckedKeys = useMemo(() => {
        const keys: string[] = []
        const gather = (nodes: typeof columnTree) => {
            nodes.forEach((node) => {
                if (node.indeterminate) keys.push(String(node.key))
                if (node.children?.length) gather(node.children)
            })
        }
        gather(columnTree)
        return keys
    }, [columnTree])

    const handleExpandAll = useCallback(() => {
        setExpandedKeys(allTreeKeys)
    }, [allTreeKeys])

    const handleCollapseAll = useCallback(() => {
        setExpandedKeys([])
    }, [])

    const handleShowAll = useCallback(() => {
        setHiddenKeys([])
    }, [setHiddenKeys])

    const handleHideAll = useCallback(() => {
        setHiddenKeys(leafKeys)
    }, [leafKeys, setHiddenKeys])

    const handleResetLayout = useCallback(() => {
        reset()
        setColumnWidths(() => ({}))
        setSearch("")
        setExpandedKeys(allTreeKeys)
    }, [allTreeKeys, reset, setColumnWidths])

    return (
        <div className="flex flex-col gap-3 min-w-[360px] max-w-[420px]">
            <Input
                allowClear
                placeholder="Search columns"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
            />

            <div className="flex flex-col gap-1">
                <Typography.Text className="text-xs font-medium uppercase text-gray-500">
                    Visibility
                </Typography.Text>
                <Space size={[6, 6]} wrap>
                    <Button size="small" onClick={handleExpandAll}>
                        Expand all
                    </Button>
                    <Button size="small" onClick={handleCollapseAll}>
                        Collapse all
                    </Button>
                    <Button size="small" onClick={handleShowAll}>
                        Show all
                    </Button>
                    <Button size="small" onClick={handleHideAll}>
                        Hide all
                    </Button>
                </Space>
            </div>
            <div className="rounded-md border border-gray-100 bg-white shadow-inner">
                <div className="max-h-[320px] overflow-auto px-1 py-2">
                    <Tree
                        checkable
                        blockNode
                        draggable
                        selectable={false}
                        showLine
                        height={300}
                        checkedKeys={{checked: checkedKeys, halfChecked: halfCheckedKeys}}
                        expandedKeys={expandedKeys}
                        onExpand={(keys) => setExpandedKeys(keys as string[])}
                        treeData={filteredTreeData}
                        onCheck={(_, info) => {
                            const key = String(info.node.key)
                            const nodeItem = info.node as VisibilityTreeNode
                            const hasNestedChildren =
                                Array.isArray(nodeItem.children) && nodeItem.children.length > 0
                            if (hasNestedChildren) {
                                toggleTree(key)
                            } else {
                                toggleColumn(key)
                            }
                        }}
                    />
                </div>
            </div>

            <div className="flex justify-between items-center pt-1">
                <Button
                    size="small"
                    type="text"
                    icon={<ArrowCounterClockwise size={14} weight="bold" />}
                    onClick={handleResetLayout}
                >
                    Reset layout
                </Button>
                <Button size="small" type="text" onClick={onClose}>
                    Close
                </Button>
            </div>
        </div>
    )
}

export default ColumnVisibilityPopoverContent

export type {ColumnVisibilityNodeMeta, ColumnVisibilityNodeMetaResolver}
