import {type ReactNode, useState, useMemo, useCallback} from "react"

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Popover, PopoverContent} from "@agenta/primitive-ui/components/popover"
import {DownloadSimple, Eye, GearSix, Trash} from "@phosphor-icons/react"

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
    additionalMenuItems?: ReactNode
}

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
        setTimeout(() => {
            setColumnVisibilityOpen(true)
        }, 100)
    }, [])

    const menuItems = useMemo(() => {
        const items: ReactNode[] = []

        items.push(
            <DropdownMenuItem
                key="column-visibility"
                onClick={(e) => {
                    e.stopPropagation()
                    handleOpenColumnVisibility()
                }}
            >
                <Eye size={16} />
                Column visibility
            </DropdownMenuItem>,
        )

        if (additionalMenuItems) {
            items.push(<DropdownMenuSeparator key="sep-additional" />)
            items.push(additionalMenuItems)
        }

        if (onExport) {
            items.push(<DropdownMenuSeparator key="sep-export" />)
            items.push(
                <DropdownMenuItem
                    key="export"
                    disabled={isExporting}
                    onClick={(e) => {
                        e.stopPropagation()
                        onExport()
                        setDropdownOpen(false)
                    }}
                >
                    <DownloadSimple size={16} />
                    {isExporting ? "Exporting..." : "Export to CSV"}
                </DropdownMenuItem>,
            )
        }

        if (onDelete) {
            items.push(<DropdownMenuSeparator key="sep-delete" />)
            items.push(
                <DropdownMenuItem
                    key="delete"
                    variant="destructive"
                    disabled={deleteDisabled}
                    onClick={(e) => {
                        e.stopPropagation()
                        onDelete()
                        setDropdownOpen(false)
                    }}
                >
                    <Trash size={16} />
                    {deleteLabel}
                </DropdownMenuItem>,
            )
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
        <Popover
            open={columnVisibilityOpen}
            onOpenChange={(open, eventDetails) => {
                if (eventDetails.reason !== "trigger-press") setColumnVisibilityOpen(open)
            }}
        >
            <DropdownMenu
                open={dropdownOpen}
                onOpenChange={(open) => {
                    if (columnVisibilityOpen && open) return
                    setDropdownOpen(open)
                }}
            >
                <DropdownMenuTrigger
                    title="Table settings"
                    className="inline-flex shrink-0 items-center justify-center rounded-full border border-transparent size-7 text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                    onClick={(e) => e.stopPropagation()}
                >
                    <GearSix size={16} weight="bold" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" style={{minWidth: 180}}>
                    {menuItems}
                </DropdownMenuContent>
            </DropdownMenu>
            <PopoverContent side="bottom" align="end" className="w-auto">
                {renderColumnVisibilityContent(controls, handleCloseColumnVisibility)}
            </PopoverContent>
        </Popover>
    )
}

export default TableSettingsDropdown
