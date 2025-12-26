import {memo, useCallback, useState} from "react"

import {CaretDown, CaretRight, Check, Code, Copy, MapPin, Trash, X} from "@phosphor-icons/react"
import {Button, Input, Popover, Tooltip} from "antd"

import {message} from "@/oss/components/AppMessageContext"

export interface DrillInFieldHeaderProps {
    /** Field name to display */
    name: string
    /** Field value (for copy functionality) */
    value: unknown
    /** Whether the field is collapsed */
    isCollapsed: boolean
    /** Callback when collapse toggle is clicked */
    onToggleCollapse: () => void
    /** Item count string (e.g., "5 items" or "3 properties") */
    itemCount?: string
    /** Whether the field can be drilled into */
    expandable?: boolean
    /** Callback when drill in is clicked */
    onDrillIn?: () => void
    /** Whether raw mode toggle should be shown */
    showRawToggle?: boolean
    /** Whether raw mode is active */
    isRawMode?: boolean
    /** Callback when raw mode is toggled */
    onToggleRawMode?: () => void
    /** Whether delete button should be shown */
    showDelete?: boolean
    /** Callback when delete is clicked */
    onDelete?: () => void
    /** Whether to always show copy button (vs only when collapsed/expandable) */
    alwaysShowCopy?: boolean
    /** Column options for mapping dropdown */
    columnOptions?: {value: string; label: string}[]
    /** Callback when user selects a column to map to */
    onMapToColumn?: (column: string) => void
    /** Callback when user wants to remove the mapping */
    onUnmap?: () => void
    /** Whether the field is already mapped */
    isMapped?: boolean
    /** The column name this field is mapped to (for display) */
    mappedColumn?: string
    /** Number of nested paths that are mapped (for parent objects) */
    nestedMappingCount?: number
}

/**
 * Popover component for mapping a field to a column
 */
const MappingPopover = memo(
    ({
        columnOptions,
        onMapToColumn,
        onUnmap,
        isMapped,
    }: {
        columnOptions?: {value: string; label: string}[]
        onMapToColumn: (column: string) => void
        onUnmap?: () => void
        isMapped: boolean
    }) => {
        const [open, setOpen] = useState(false)
        const [newColumnName, setNewColumnName] = useState("")
        const [showNewColumnInput, setShowNewColumnInput] = useState(false)

        const handleSelectColumn = useCallback(
            (column: string) => {
                onMapToColumn(column)
                setOpen(false)
            },
            [onMapToColumn],
        )

        const handleCreateColumn = useCallback(() => {
            if (newColumnName.trim()) {
                onMapToColumn(newColumnName.trim())
                setNewColumnName("")
                setShowNewColumnInput(false)
                setOpen(false)
            }
        }, [newColumnName, onMapToColumn])

        const handleUnmap = useCallback(() => {
            onUnmap?.()
            setOpen(false)
        }, [onUnmap])

        const content = (
            <div className="flex flex-col gap-1 min-w-[180px]">
                {isMapped ? (
                    <Button
                        type="text"
                        danger
                        size="small"
                        className="justify-start"
                        icon={<X size={14} />}
                        onClick={handleUnmap}
                    >
                        Remove mapping
                    </Button>
                ) : (
                    <>
                        {showNewColumnInput ? (
                            <div className="flex gap-1">
                                <Input
                                    size="small"
                                    placeholder="Column name"
                                    value={newColumnName}
                                    onChange={(e) => setNewColumnName(e.target.value)}
                                    onPressEnter={handleCreateColumn}
                                    autoFocus
                                />
                                <Button size="small" type="primary" onClick={handleCreateColumn}>
                                    Add
                                </Button>
                            </div>
                        ) : (
                            <Button
                                type="text"
                                size="small"
                                className="justify-start text-blue-600"
                                onClick={() => setShowNewColumnInput(true)}
                            >
                                + Create new column
                            </Button>
                        )}
                        {columnOptions && columnOptions.length > 0 && (
                            <>
                                <div className="border-t border-gray-200 my-1" />
                                {columnOptions.map((opt) => (
                                    <Button
                                        key={opt.value}
                                        type="text"
                                        size="small"
                                        className="justify-start"
                                        onClick={() => handleSelectColumn(opt.value)}
                                    >
                                        {opt.label}
                                    </Button>
                                ))}
                            </>
                        )}
                    </>
                )}
            </div>
        )

        return (
            <Popover
                content={content}
                trigger="click"
                open={open}
                onOpenChange={(visible) => {
                    setOpen(visible)
                    if (!visible) {
                        setShowNewColumnInput(false)
                        setNewColumnName("")
                    }
                }}
                placement="bottomRight"
            >
                <Tooltip title={isMapped ? "Mapping options" : "Map to column"}>
                    <Button
                        type="text"
                        size="small"
                        className={`!px-1 !h-6 text-xs ${isMapped ? "text-green-500" : "text-gray-500"}`}
                        icon={<MapPin size={12} weight={isMapped ? "fill" : "regular"} />}
                    />
                </Tooltip>
            </Popover>
        )
    },
)

MappingPopover.displayName = "MappingPopover"

/**
 * Reusable field header component for drill-in views
 * Used by TestcaseEditDrawer and TraceDataDrillIn
 */
const DrillInFieldHeader = memo(
    ({
        name,
        value,
        isCollapsed,
        onToggleCollapse,
        itemCount,
        expandable = false,
        onDrillIn,
        showRawToggle = false,
        isRawMode = false,
        onToggleRawMode,
        showDelete = false,
        onDelete,
        alwaysShowCopy = false,
        columnOptions,
        onMapToColumn,
        onUnmap,
        isMapped = false,
        mappedColumn,
        nestedMappingCount = 0,
    }: DrillInFieldHeaderProps) => {
        const [copiedField, setCopiedField] = useState<string | null>(null)

        const handleCopy = useCallback(() => {
            const valueToCopy = typeof value === "string" ? value : JSON.stringify(value, null, 2)
            navigator.clipboard.writeText(valueToCopy)
            setCopiedField(name)
            message.success("Copied to clipboard")
            setTimeout(() => setCopiedField(null), 1000)
        }, [value, name])

        const showCopyButton = alwaysShowCopy || isCollapsed || expandable

        return (
            <div className="flex items-center justify-between py-2 px-3 bg-[#FAFAFA] rounded-md border-solid border-[1px] border-[rgba(5,23,41,0.06)]">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={onToggleCollapse}
                        className="flex items-center gap-2 text-left hover:text-gray-700 transition-colors bg-transparent border-none p-0 cursor-pointer"
                    >
                        {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
                        <span className="text-gray-700 font-medium">{name}</span>
                    </button>
                    {mappedColumn ? (
                        <span className="text-xs text-green-600 font-medium">
                            mapped to {mappedColumn}
                        </span>
                    ) : nestedMappingCount > 0 ? (
                        <>
                            {itemCount && (
                                <span className="text-xs text-gray-400">[{itemCount}]</span>
                            )}
                            <span className="text-xs text-green-600 font-medium">
                                contains {nestedMappingCount} mapping
                                {nestedMappingCount > 1 ? "s" : ""}
                            </span>
                        </>
                    ) : (
                        itemCount && <span className="text-xs text-gray-400">[{itemCount}]</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {showCopyButton && (
                        <Tooltip title={copiedField === name ? "Copied" : "Copy"}>
                            <Button
                                type="text"
                                size="small"
                                className="!px-1 !h-6 text-xs text-gray-500"
                                icon={
                                    copiedField === name ? <Check size={12} /> : <Copy size={12} />
                                }
                                onClick={handleCopy}
                            />
                        </Tooltip>
                    )}
                    {showRawToggle && onToggleRawMode && (
                        <Tooltip title={isRawMode ? "Show formatted" : "Show raw"}>
                            <Button
                                type="text"
                                size="small"
                                className={`!px-1 !h-6 text-xs ${isRawMode ? "text-blue-500" : "text-gray-500"}`}
                                icon={<Code size={12} />}
                                onClick={onToggleRawMode}
                            />
                        </Tooltip>
                    )}
                    {expandable && onDrillIn && (
                        <Button
                            type="text"
                            size="small"
                            onClick={onDrillIn}
                            className="!px-2 !h-6 text-xs text-gray-500"
                        >
                            <CaretRight size={12} className="mr-1" />
                            Drill In
                        </Button>
                    )}
                    {onMapToColumn && (
                        <MappingPopover
                            columnOptions={columnOptions}
                            onMapToColumn={onMapToColumn}
                            onUnmap={onUnmap}
                            isMapped={isMapped}
                        />
                    )}
                    {showDelete && onDelete && (
                        <Button
                            type="text"
                            size="small"
                            danger
                            icon={<Trash size={12} />}
                            onClick={onDelete}
                        />
                    )}
                </div>
            </div>
        )
    },
)

DrillInFieldHeader.displayName = "DrillInFieldHeader"

export default DrillInFieldHeader
