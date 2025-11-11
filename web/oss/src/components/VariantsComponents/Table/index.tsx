import {type ComponentProps, useMemo, useState} from "react"

import {Spin, Table, TableColumnType} from "antd"
import {TableRowSelection} from "antd/es/table/interface"

import {EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"

import ResizableTitle from "../../ResizableTitle"

import {getColumns} from "./assets/getVariantColumns"

type VariantsTableProps = {
    showEnvBadges?: boolean
    isLoading: boolean
    rowSelection: TableRowSelection<EnhancedVariant> | undefined
    onRowClick: (variant: EnhancedVariant) => void
    variants: EnhancedVariant[]
    handleOpenDetails?: (record: EnhancedVariant) => void
    handleOpenInPlayground?: (record: EnhancedVariant) => void
    handleDeploy?: (record: EnhancedVariant) => void
    handleDeleteVariant?: (record: EnhancedVariant) => void
    showActionsDropdown?: boolean
    enableColumnResize?: boolean
} & ComponentProps<typeof Table>

const VariantsTable = ({
    isLoading,
    onRowClick,
    variants,
    handleOpenDetails,
    handleOpenInPlayground,
    handleDeploy,
    handleDeleteVariant,
    showEnvBadges = false,
    rowSelection,
    showActionsDropdown = true,
    enableColumnResize = false,
    ...props
}: VariantsTableProps) => {
    const initialColumns = useMemo(
        () =>
            getColumns({
                showEnvBadges,
                handleOpenDetails,
                handleOpenInPlayground,
                handleDeploy,
                handleDeleteVariant,
                showActionsDropdown,
            }),
        [handleOpenDetails, handleOpenInPlayground, handleDeploy, handleDeleteVariant],
    )

    const [columns, setColumns] = useState(initialColumns)

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
                rowSelection={{
                    type: "checkbox",
                    columnWidth: 48,
                    checkStrictly: false,
                    ...rowSelection,
                }}
                className="ph-no-capture"
                rowKey={"id"}
                columns={(enableColumnResize ? mergedColumns : initialColumns) as any}
                dataSource={variants as EnhancedVariant[]}
                scroll={{x: "max-content"}}
                bordered
                components={{
                    header: {
                        cell: ResizableTitle,
                    },
                }}
                pagination={false}
                onRow={(record: any) => ({
                    className: "variant-table-row",
                    style: {cursor: "pointer"},
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
