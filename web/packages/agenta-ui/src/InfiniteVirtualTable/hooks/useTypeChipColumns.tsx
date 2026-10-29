import {useMemo} from "react"
import type {ReactNode} from "react"

import {TypeChip} from "../../type-chip/TypeChip"
import type {ChipVariant} from "../../type-chip/TypeChip"
import type {ColumnDef, ColumnDefs, ColumnGroupDef} from "../columnDef"
import type {TypeChipConfig} from "../types"
import {
    defaultHeaderVariant,
    detectColumnTypes,
    type ColumnTypeInfo,
} from "../utils/detectColumnTypes"

function collectLeafKeys<R>(columns: ColumnDefs<R>): string[] {
    const keys: string[] = []

    for (const col of columns) {
        const groupColumn = col as ColumnGroupDef<R>
        if (Array.isArray(groupColumn.children) && groupColumn.children.length > 0) {
            keys.push(...collectLeafKeys(groupColumn.children as ColumnDefs<R>))
            continue
        }

        const key = (col as ColumnDef<R>).key
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
    title: ColumnDef<R>["title"],
    chip: ReactNode,
): ColumnDef<R>["title"] {
    if (typeof title === "function") {
        return (props) => wrapTitleWithChip(title(props), chip)
    }

    return wrapTitleWithChip(title as ReactNode, chip)
}

function enhanceLeafColumns<R>(
    columns: ColumnDefs<R>,
    columnTypes: Map<string, ColumnTypeInfo>,
    resolveVariant: (key: string, info: ColumnTypeInfo | undefined) => ChipVariant | undefined,
): ColumnDefs<R> {
    return columns.map((col) => {
        const groupColumn = col as ColumnGroupDef<R>
        if (Array.isArray(groupColumn.children) && groupColumn.children.length > 0) {
            return {
                ...col,
                children: enhanceLeafColumns(
                    groupColumn.children as ColumnDefs<R>,
                    columnTypes,
                    resolveVariant,
                ),
            }
        }

        const key = String((col as ColumnDef<R>).key ?? "")
        const typeInfo = columnTypes.get(key)

        const variant = resolveVariant(key, typeInfo)
        if (!variant) return col

        return {
            ...col,
            title: resolveTitleWithChip(
                (col as ColumnDef<R>).title,
                <TypeChip variant={variant} />,
            ),
        }
    })
}

export function useTypeChipColumns<R extends object>(
    columns: ColumnDefs<R>,
    dataSource: R[],
    typeChips: TypeChipConfig<R> | undefined,
): ColumnDefs<R> {
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

    return useMemo((): ColumnDefs<R> => {
        if (!typeChips?.enabled || !columnTypes) return columns

        const resolveVariant = typeChips.resolveHeaderVariant ?? defaultHeaderVariant
        return enhanceLeafColumns(columns, columnTypes, resolveVariant)
    }, [columns, columnTypes, typeChips?.enabled, typeChips?.resolveHeaderVariant])
}
