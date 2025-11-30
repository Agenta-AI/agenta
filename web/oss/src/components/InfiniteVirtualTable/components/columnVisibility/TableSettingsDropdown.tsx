import {type ReactNode, useState, useMemo, useCallback} from "react"

import {DownloadSimple, Eye, GearSix} from "@phosphor-icons/react"
import {Button, Dropdown, Popover, Tooltip} from "antd"
import type {MenuProps} from "antd"

import type {ColumnVisibilityState} from "../../types"

export interface TableSettingsDropdownProps<RowType extends object> {
    controls: ColumnVisibilityState<RowType>
    onExport?: () => void
    isExporting?: boolean
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

        return items
    }, [handleOpenColumnVisibility, isExporting, onExport])

    return (
        <Popover
            trigger={[]}
            placement="bottomRight"
            open={columnVisibilityOpen}
            onOpenChange={setColumnVisibilityOpen}
            content={renderColumnVisibilityContent(controls, handleCloseColumnVisibility)}
            destroyTooltipOnHide
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
