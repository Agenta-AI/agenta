import {type ComponentProps, useEffect, useMemo, useState} from "react"

import {Spin, Table, TableColumnType} from "antd"
import {TableRowSelection} from "antd/es/table/interface"
import {atom, useAtom} from "jotai"

import useURL from "@/oss/hooks/useURL"
import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

import ResizableTitle from "../../ResizableTitle"
import {variantTableSelectionAtomFamily} from "../store/selectionAtoms"

import {getColumns} from "./assets/getVariantColumns"

type VariantsTableProps = {
    showEnvBadges?: boolean
    isLoading: boolean
    rowSelection: TableRowSelection<EnhancedVariant> | undefined
    onRowClick: (variant: EnhancedVariant) => void
    variants: EnhancedVariant[]
    handleOpenDetails?: (record: EnhancedVariant) => void
    handleOpenInPlayground?: (record: EnhancedVariant) => void
    showActionsDropdown?: boolean
    enableColumnResize?: boolean
    showRevisionsAsChildren?: boolean
    selectionScope?: string
    showStableName?: boolean
} & ComponentProps<typeof Table>

const VariantsTable = ({
    isLoading,
    onRowClick,
    variants,
    handleOpenDetails,
    handleOpenInPlayground,
    showEnvBadges = false,
    rowSelection,
    showActionsDropdown = true,
    enableColumnResize = false,
    showRevisionsAsChildren = false,
    selectionScope,
    showStableName = false,
    ...props
}: VariantsTableProps) => {
    const {appURL} = useURL()
    // Always call hooks in a stable order; create a stable atom depending on selectionScope
    const selectionAtom = useMemo(
        () =>
            selectionScope
                ? variantTableSelectionAtomFamily(selectionScope)
                : atom<React.Key[]>([]),
        [selectionScope],
    )
    const [scopedSelectedKeys, setScopedSelectedKeys] = useAtom(selectionAtom)

    const baseColumns = useMemo(
        () =>
            getColumns({
                showEnvBadges,
                handleOpenDetails,
                handleOpenInPlayground,
                showActionsDropdown,
                showStableName,
                appURL,
                selectedRowKeys: selectionScope ? scopedSelectedKeys : undefined,
            }),
        [
            handleOpenDetails,
            handleOpenInPlayground,
            showEnvBadges,
            showActionsDropdown,
            showStableName,
            appURL,
            selectionScope,
            scopedSelectedKeys,
        ],
    )

    const [columns, setColumns] = useState(baseColumns)

    useEffect(() => {
        setColumns((prev) => {
            return baseColumns.map((col) => {
                const prevCol = prev.find((p) => p.key === col.key)
                return prevCol ? {...col, width: prevCol.width ?? col.width} : col
            })
        })
    }, [baseColumns])

    const handleResize =
        (key: string) =>
        (_: any, {size}: {size: {width: number}}) => {
            setColumns((cols) => {
                return cols.map((col) => ({
                    ...col,
                    width: col.key === key ? size.width : col.width,
                }))
            })
        }

    const mergedColumns = useMemo(() => {
        return columns.map((col) => ({
            ...col,
            width: col.width || 200,
            onHeaderCell: (column: TableColumnType<EnhancedVariant>) => ({
                width: column.width,
                onResize: handleResize(column.key?.toString()!),
            }),
        }))
    }, [columns])

    return (
        <Spin spinning={isLoading}>
            <Table
                rowSelection={
                    selectionScope
                        ? {
                              type: "checkbox",
                              columnWidth: 48,
                              checkStrictly: false,
                              selectedRowKeys: scopedSelectedKeys as React.Key[],
                              onChange: (keys) => setScopedSelectedKeys(keys as React.Key[]),
                          }
                        : {
                              type: "checkbox",
                              columnWidth: 48,
                              checkStrictly: false,
                              ...rowSelection,
                          }
                }
                className="ph-no-capture"
                rowKey={(props as any)?.rowKey || "id"}
                columns={(enableColumnResize ? mergedColumns : baseColumns) as any}
                dataSource={variants as EnhancedVariant[]}
                scroll={{x: "max-content"}}
                bordered
                components={{
                    header: {
                        cell: ResizableTitle,
                    },
                }}
                pagination={false}
                onRow={(record: any, index) => ({
                    className: "variant-table-row",
                    style: {cursor: "pointer"},
                    "data-tour": index === 0 ? "version-row" : undefined,
                    onClick: () => {
                        onRowClick(record)
                    },
                })}
                {...props}
            />
        </Spin>
    )
}

export default VariantsTable
