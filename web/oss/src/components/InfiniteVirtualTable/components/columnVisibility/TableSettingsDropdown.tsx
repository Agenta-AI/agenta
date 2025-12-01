import {type ReactNode, useState, useMemo, useCallback} from "react"

import {DownloadSimple, Eye, GearSix, Trash} from "@phosphor-icons/react"
import {Button, Dropdown, Popover, Tooltip} from "antd"
import type {MenuProps} from "antd"

import type {ColumnVisibilityState} from "../../types"

export interface TableSettingsDropdownProps<RowType extends object> {
    controls: ColumnVisibilityState<RowType>
    onExport?: () => void
    isExporting?: boolean
    onDelete?: () => void
    deleteDisabled?: boolean
    deleteLabel?: string
    renderColumnVisibilityContent: (
        controls: ColumnVisibilityState<RowType>,
        close: () => void,
    ) => ReactNode
}

/**
 * A dropdown menu triggered by a gear icon that provides table settings actions.
 * Opens a dropdown with options like "Export" and "Column Visibility".
 * Column visibility opens a nested popover with the full column visibility UI.
 */
const TableSettingsDropdown = <RowType extends object>({
    controls,
    onExport,
    isExporting,
    onDelete,
    deleteDisabled,
    deleteLabel = "Delete",
    renderColumnVisibilityContent,
}: TableSettingsDropdownProps<RowType>) => {
    const [dropdownOpen, setDropdownOpen] = useState(false)
    const [columnVisibilityOpen, setColumnVisibilityOpen] = useState(false)

    const handleCloseColumnVisibility = useCallback(() => {
        setColumnVisibilityOpen(false)
    }, [])

    const handleOpenColumnVisibility = useCallback(() => {
        setDropdownOpen(false)
        // Small delay to let dropdown close before opening popover
        setTimeout(() => {
            setColumnVisibilityOpen(true)
        }, 100)
    }, [])

    const menuItems = useMemo(() => {
        const items: MenuProps["items"] = []

        // Column Visibility option
        items.push({
            key: "column-visibility",
            label: "Column visibility",
            icon: <Eye size={16} />,
            onClick: (e) => {
                e.domEvent.stopPropagation()
                handleOpenColumnVisibility()
            },
        })

        // Export option (if enabled)
        if (onExport) {
            items.push({type: "divider"})
            items.push({
                key: "export",
                label: isExporting ? "Exporting..." : "Export to CSV",
                icon: <DownloadSimple size={16} />,
                disabled: isExporting,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    onExport()
                    setDropdownOpen(false)
                },
            })
        }

        // Delete option (if enabled)
        if (onDelete) {
            items.push({type: "divider"})
            items.push({
                key: "delete",
                label: deleteLabel,
                icon: <Trash size={16} />,
                disabled: deleteDisabled,
                danger: true,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                    onDelete()
                    setDropdownOpen(false)
                },
            })
        }

        return items
    }, [deleteDisabled, deleteLabel, handleOpenColumnVisibility, isExporting, onDelete, onExport])

    return (
        <Popover
            trigger={[]}
            placement="bottomRight"
            open={columnVisibilityOpen}
            onOpenChange={setColumnVisibilityOpen}
            content={renderColumnVisibilityContent(controls, handleCloseColumnVisibility)}
            destroyOnHidden
        >
            <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                open={dropdownOpen}
                onOpenChange={(open) => {
                    // Don't open dropdown if column visibility popover is open
                    if (columnVisibilityOpen && open) return
                    setDropdownOpen(open)
                }}
                menu={{items: menuItems}}
                overlayStyle={{minWidth: 180}}
            >
                <Tooltip title="Table settings">
                    <Button
                        type="text"
                        shape="circle"
                        size="small"
                        onClick={(e) => e.stopPropagation()}
                        icon={<GearSix size={16} weight="bold" />}
                    />
                </Tooltip>
            </Dropdown>
        </Popover>
    )
}

export default TableSettingsDropdown
