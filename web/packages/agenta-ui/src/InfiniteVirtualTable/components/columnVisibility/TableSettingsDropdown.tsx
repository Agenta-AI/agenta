import {type ReactNode, useState, useMemo, useCallback} from "react"

import {DownloadSimple, Eye, GearSix, Trash} from "@phosphor-icons/react"

import {Button} from "../../../components/ui/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import {Popover, PopoverAnchor, PopoverContent} from "../../../components/ui/popover"
import {SimpleTooltip} from "../../../components/ui/tooltip-composed"
import {renderTableMenuItems, type TableMenuItem} from "../../tableMenu"
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
    /** Additional menu items to render after Column visibility */
    additionalMenuItems?: TableMenuItem[]
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
    additionalMenuItems,
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
        const items: TableMenuItem[] = []

        // Column Visibility option
        items.push({
            key: "column-visibility",
            label: "Column visibility",
            icon: <Eye size={16} />,
            onClick: handleOpenColumnVisibility,
        })

        // Additional menu items (e.g., Row height)
        if (additionalMenuItems?.length) {
            items.push({type: "divider"})
            items.push(...additionalMenuItems)
        }

        // Export option (if enabled)
        if (onExport) {
            items.push({type: "divider"})
            items.push({
                key: "export",
                label: isExporting ? "Exporting..." : "Export to CSV",
                icon: <DownloadSimple size={16} />,
                disabled: isExporting,
                onClick: () => {
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
                onClick: () => {
                    onDelete()
                    setDropdownOpen(false)
                },
            })
        }

        return items
    }, [
        additionalMenuItems,
        deleteDisabled,
        deleteLabel,
        handleOpenColumnVisibility,
        isExporting,
        onDelete,
        onExport,
    ])

    return (
        // The column-visibility popover is anchored to the same gear, so it wraps the menu and
        // opens with no trigger of its own.
        <Popover open={columnVisibilityOpen} onOpenChange={setColumnVisibilityOpen}>
            <PopoverAnchor>
                <DropdownMenu
                    open={dropdownOpen}
                    onOpenChange={(open) => {
                        // Don't open dropdown if column visibility popover is open
                        if (columnVisibilityOpen && open) return
                        setDropdownOpen(open)
                    }}
                >
                    <SimpleTooltip title="Table settings">
                        <DropdownMenuTrigger asChild>
                            <Button
                                className="rounded-control-round"
                                size="icon"
                                variant="ghost"
                                aria-label="Table settings"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <GearSix size={16} weight="bold" />
                            </Button>
                        </DropdownMenuTrigger>
                    </SimpleTooltip>
                    <DropdownMenuContent align="end" className="min-w-[180px]">
                        {renderTableMenuItems(menuItems)}
                    </DropdownMenuContent>
                </DropdownMenu>
            </PopoverAnchor>
            <PopoverContent align="end" className="w-auto p-3">
                {renderColumnVisibilityContent(controls, handleCloseColumnVisibility)}
            </PopoverContent>
        </Popover>
    )
}

export default TableSettingsDropdown
