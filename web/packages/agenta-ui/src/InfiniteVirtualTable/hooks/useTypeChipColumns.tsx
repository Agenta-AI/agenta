import {useMemo} from "react"
import type {ReactNode} from "react"

import type {ColumnGroupType, ColumnType, ColumnsType} from "antd/es/table"

import {TypeChip} from "../../type-chip/TypeChip"
import type {ChipVariant} from "../../type-chip/TypeChip"
import type {TypeChipConfig} from "../types"
import {
    defaultHeaderVariant,
    detectColumnTypes,
    type ColumnTypeInfo,
} from "../utils/detectColumnTypes"

function collectLeafKeys<R>(columns: ColumnsType<R>): string[] {
    const keys: string[] = []

    for (const col of columns) {
        const groupColumn = col as ColumnGroupType<R>
        if (Array.isArray(groupColumn.children) && groupColumn.children.length > 0) {
            keys.push(...collectLeafKeys(groupColumn.children as ColumnsType<R>))
            continue
        }

        const key = (col as ColumnType<R>).key
        if (typeof key === "string" && key) keys.push(key)
    }

    return keys
}

function wrapTitleWithChip(original: ReactNode, chip: ReactNode): ReactNode {
    return (
        <div className="flex w-full items-center gap-1 overflow-hidden">
            <div className="min-w-0 flex-1 overflow-hidden">{original}</div>
            <div className="shrink-0">{chip}</div>
        </div>
    )
}

function resolveTitleWithChip<R>(
    title: ColumnType<R>["title"],
    chip: ReactNode,
): ColumnType<R>["title"] {
    if (typeof title === "function") {
        return (props) => wrapTitleWithChip(title(props), chip)
    }

    return wrapTitleWithChip(title as ReactNode, chip)
}

function enhanceLeafColumns<R>(
    columns: ColumnsType<R>,
    columnTypes: Map<string, ColumnTypeInfo>,
    resolveVariant: (key: string, info: ColumnTypeInfo | undefined) => ChipVariant | undefined,
): ColumnsType<R> {
    return columns.map((col) => {
        const groupColumn = col as ColumnGroupType<R>
        if (Array.isArray(groupColumn.children) && groupColumn.children.length > 0) {
            return {
                ...col,
                children: enhanceLeafColumns(
                    groupColumn.children as ColumnsType<R>,
                    columnTypes,
                    resolveVariant,
                ),
            }
        }

        const key = String((col as ColumnType<R>).key ?? "")
        const typeInfo = columnTypes.get(key)

        const variant = resolveVariant(key, typeInfo)
        if (!variant) return col

        return {
            ...col,
            title: resolveTitleWithChip(
                (col as ColumnType<R>).title,
                <TypeChip variant={variant} />,
            ),
        }
    })
}

export function useTypeChipColumns<R extends object>(
    columns: ColumnsType<R>,
    dataSource: R[],
    typeChips: TypeChipConfig<R> | undefined,
): ColumnsType<R> {
    const leafKeys = useMemo(() => collectLeafKeys(columns), [columns])

    const columnTypes = useMemo((): Map<string, ColumnTypeInfo> | null => {
        if (!typeChips?.enabled || !dataSource.length) return null

        const sample = dataSource.slice(0, 30)
        const rows = sample.map((record) => {
            const row: Record<string, unknown> = {}
            for (const key of leafKeys) {
                row[key] = typeChips.getRowValue(record, key)
            }
            return row
        })

        return detectColumnTypes(rows, leafKeys)
    }, [typeChips?.enabled, typeChips?.getRowValue, dataSource, leafKeys])

    return useMemo((): ColumnsType<R> => {
        if (!typeChips?.enabled || !columnTypes) return columns

        const resolveVariant = typeChips.resolveHeaderVariant ?? defaultHeaderVariant
        return enhanceLeafColumns(columns, columnTypes, resolveVariant)
    }, [columns, columnTypes, typeChips?.enabled, typeChips?.resolveHeaderVariant])
}
