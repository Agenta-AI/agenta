import {useCallback, useMemo, useRef} from "react"
import type {ReactNode} from "react"

import type {ColumnsType} from "antd/es/table"
import {useAtomValue} from "jotai"
import {LOW_PRIORITY, useSetAtomWithSchedule} from "jotai-scheduler"

import {getColumnHiddenKeysAtom} from "../atoms/columnHiddenKeys"

type Key = string

interface Options {
    storageKey?: string
    defaultHiddenKeys?: Key[]
}

type ColumnLike<RecordType> = ColumnsType<RecordType>[number] & {
    key?: React.Key
    children?: ColumnLike<RecordType>[]
    columnVisibilityTitle?: ReactNode
    columnVisibilityLabel?: string
    columnVisibilityLocked?: boolean
}

const isColumnLocked = <RecordType>(column: ColumnLike<RecordType> | null | undefined) =>
    Boolean(column?.columnVisibilityLocked)

export interface ColumnTreeNode {
    key: Key
    label: string
    titleNode?: ReactNode
    children: ColumnTreeNode[]
    checked: boolean
    indeterminate: boolean
}

const toKey = (key: React.Key | undefined): Key | null =>
    key === undefined || key === null ? null : String(key)

const collectKeys = <RecordType>(columns: ColumnsType<RecordType>): Key[] => {
    const result: Key[] = []
    const visit = (cols: ColumnLike<RecordType>[]) => {
        cols.forEach((col) => {
            const k = toKey(col.key)
            if (k && !isColumnLocked(col)) result.push(k)
            if (col.children && col.children.length) visit(col.children as any)
        })
    }
    visit(columns as any)
    return Array.from(new Set(result))
}

const collectLeafKeys = <RecordType>(columns: ColumnsType<RecordType>): Key[] => {
    const result: Key[] = []
    const visit = (cols: ColumnLike<RecordType>[]) => {
        cols.forEach((col) => {
            if (col.children && col.children.length) {
                visit(col.children as any)
            } else {
                const k = toKey(col.key)
                if (k && !isColumnLocked(col)) result.push(k)
            }
        })
    }
    visit(columns as any)
    return Array.from(new Set(result))
}

const filterColumnsRecursive = <RecordType>(
    columns: ColumnsType<RecordType>,
    hidden: Set<Key>,
): ColumnsType<RecordType> => {
    const map = (cols: ColumnLike<RecordType>[]): ColumnLike<RecordType>[] =>
        cols
            .map((col) => {
                const k = toKey(col.key)
                if (k && hidden.has(k) && !isColumnLocked(col)) return null
                if (col.children && col.children.length) {
                    const children = map(col.children as any)
                    if (!children.length) return null
                    return {...col, children} as any
                }
                return col as any
            })
            .filter(Boolean) as ColumnLike<RecordType>[]

    return map(columns as any) as any
}

export const useColumnVisibility = <RecordType>(
    columns: ColumnsType<RecordType>,
    {storageKey, defaultHiddenKeys = []}: Options = {},
) => {
    const allKeys = useMemo(() => collectKeys(columns), [columns])
    const leafKeys = useMemo(() => collectLeafKeys(columns), [columns])

    const defaultHiddenSignature = useMemo(
        () => (defaultHiddenKeys.length ? defaultHiddenKeys.join("|") : "__none__"),
        [defaultHiddenKeys],
    )
    const defaultHiddenSnapshot = useMemo(() => [...defaultHiddenKeys], [defaultHiddenSignature])
    const hiddenKeysAtom = useMemo(
        () => getColumnHiddenKeysAtom(storageKey, defaultHiddenSnapshot),
        [defaultHiddenSnapshot, storageKey],
    )
    const hiddenKeys = useAtomValue(hiddenKeysAtom)
    const setHiddenKeys = useSetAtomWithSchedule(hiddenKeysAtom, {
        priority: LOW_PRIORITY,
    })

    const hiddenSet = useMemo(
        () => new Set(hiddenKeys.map((key) => String(key))) as Set<Key>,
        [hiddenKeys],
    )

    const visibleColumns = useMemo(
        () => filterColumnsRecursive(columns, hiddenSet),
        [columns, hiddenSet],
    )

    const isHidden = useCallback((key: Key) => hiddenSet.has(key), [hiddenSet])

    const showColumn = useCallback(
        (key: Key) => {
            setHiddenKeys((prev) => prev.filter((k) => k !== key))
        },
        [setHiddenKeys],
    )

    const hideColumn = useCallback(
        (key: Key) => {
            setHiddenKeys((prev) => (prev.includes(key) ? prev : [...prev, key]))
        },
        [setHiddenKeys],
    )

    const toggleColumn = useCallback(
        (key: Key) => (hiddenSet.has(key) ? showColumn(key) : hideColumn(key)),
        [hideColumn, hiddenSet, showColumn],
    )

    const reset = useCallback(
        () => setHiddenKeys(defaultHiddenKeys),
        [defaultHiddenKeys, setHiddenKeys],
    )

    const collectDescendantKeys = useCallback(
        (cols: ColumnsType<RecordType>, target: Key): Key[] => {
            const keys: Key[] = []
            const visit = (items: ColumnLike<RecordType>[]) => {
                items.forEach((col) => {
                    const k = toKey(col.key)
                    if (k === target) {
                        // include self and all descendants
                        const gather = (node: ColumnLike<RecordType>) => {
                            const nk = toKey(node.key)
                            if (nk && !isColumnLocked(node)) keys.push(nk)
                            if (node.children && node.children.length) {
                                node.children.forEach((child) => gather(child as any))
                            }
                        }
                        gather(col)
                    } else if (col.children && col.children.length) {
                        visit(col.children as any)
                    }
                })
            }
            visit(cols as any)
            return Array.from(new Set(keys))
        },
        [],
    )

    const toggleTree = useCallback(
        (groupKey: Key) => {
            const keys = collectDescendantKeys(columns, groupKey)
            if (!keys.length) {
                toggleColumn(groupKey)
                return
            }
            const anyVisible = keys.some((k) => !hiddenSet.has(k))
            setHiddenKeys((prev) => {
                const base = new Set(prev)
                if (anyVisible) {
                    keys.forEach((k) => base.add(k))
                } else {
                    keys.forEach((k) => base.delete(k))
                }
                return Array.from(base)
            })
        },
        [collectDescendantKeys, columns, hiddenSet, setHiddenKeys, toggleColumn],
    )

    const getLabel = (col: ColumnLike<RecordType>): string => {
        if (typeof col.columnVisibilityLabel === "string" && col.columnVisibilityLabel.length) {
            return col.columnVisibilityLabel
        }
        const title = (col as any)?.title
        const label = typeof title === "string" ? title : toKey(col.key)
        return label ?? ""
    }

    const buildTree = useCallback(
        (cols: ColumnsType<RecordType>): ColumnTreeNode[] => {
            const map = (items: ColumnLike<RecordType>[]): ColumnTreeNode[] => {
                const nodes: ColumnTreeNode[] = []
                items.forEach((col) => {
                    const k = toKey(col.key)
                    const children =
                        col.children && col.children.length ? map(col.children as any) : []
                    if (!k || isColumnLocked(col)) {
                        nodes.push(...children)
                        return
                    }
                    const subtreeKeys: Key[] = [
                        k,
                        ...collectDescendantKeys([col] as any, k).filter((x) => x !== k),
                    ]
                    const hiddenCount = subtreeKeys.filter((x) => hiddenSet.has(x)).length
                    const allHidden = hiddenCount === subtreeKeys.length
                    const noneHidden = hiddenCount === 0
                    nodes.push({
                        key: k,
                        label: getLabel(col),
                        titleNode: col.columnVisibilityTitle,
                        children,
                        checked: noneHidden,
                        indeterminate: !noneHidden && !allHidden,
                    })
                })
                return nodes
            }
            return map(cols as any)
        },
        [collectDescendantKeys, hiddenSet],
    )

    const columnTree = useMemo(() => buildTree(columns), [buildTree, columns])

    const columnTreeStructureSignature = useMemo(() => {
        const serialize = (nodes: ColumnTreeNode[]): any =>
            nodes.map((node) => ({
                key: node.key,
                children: serialize(node.children),
            }))
        return JSON.stringify(serialize(columnTree))
    }, [columnTree])

    const visibilitySignature = useMemo(() => {
        const normalizedHidden = [...hiddenKeys].sort().join("|")
        const normalizedLeaf = leafKeys.join("|")
        const normalizedAll = allKeys.join("|")
        return `${normalizedAll}__${normalizedLeaf}__${normalizedHidden}__${columnTreeStructureSignature}`
    }, [allKeys, columnTreeStructureSignature, hiddenKeys, leafKeys])

    const visibilitySignatureRef = useRef<string | null>(null)
    const versionRef = useRef(0)

    const version = useMemo(() => {
        if (!visibilitySignature) {
            return versionRef.current
        }
        if (visibilitySignatureRef.current !== visibilitySignature) {
            visibilitySignatureRef.current = visibilitySignature
            versionRef.current += 1
        }
        return versionRef.current
    }, [visibilitySignature])

    return {
        allKeys,
        leafKeys,
        hiddenKeys,
        setHiddenKeys,
        isHidden,
        showColumn,
        hideColumn,
        toggleColumn,
        toggleTree,
        reset,
        visibleColumns,
        columnTree,
        version,
    }
}

export default useColumnVisibility
