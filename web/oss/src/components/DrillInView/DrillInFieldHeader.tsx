import {memo, useCallback, useState, type ReactNode} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Input} from "@agenta/primitive-ui/components/input"
import {Popover, PopoverContent, PopoverTrigger} from "@agenta/primitive-ui/components/popover"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {message} from "@agenta/ui/app-message"
import {
    CaretDown,
    CaretRight,
    Check,
    Code,
    Copy,
    MapPin,
    MarkdownLogoIcon,
    TextAa,
    Trash,
    X,
} from "@phosphor-icons/react"

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
    /** Whether markdown toggle should be shown */
    showMarkdownToggle?: boolean
    /** Whether markdown view is active */
    isMarkdownView?: boolean
    /** Callback when markdown view is toggled */
    onToggleMarkdownView?: () => void
    /** Available content view modes for this field */
    viewModeOptions?: {value: string; label: string}[]
    /** Current content view mode */
    viewMode?: string
    /** Callback when content view mode changes */
    onViewModeChange?: (mode: string) => void
    /** Show collapse toggle in the header (default: true) */
    showCollapseToggle?: boolean
    /** Optional chip rendered after the field name. */
    typeChip?: ReactNode
    /** Show drill-in action button in the header (default: true) */
    showDrillInButton?: boolean
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
                        className="justify-start"
                        onClick={handleUnmap}
                        variant="destructive"
                        size="sm"
                    >
                        {<X size={14} />}
                        Remove mapping
                    </Button>
                ) : (
                    <>
                        {showNewColumnInput ? (
                            <div className="flex gap-1">
                                <Input
                                    placeholder="Column name"
                                    value={newColumnName}
                                    onChange={(e) => setNewColumnName(e.target.value)}
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") handleCreateColumn()
                                    }}
                                    className="h-6"
                                />
                                <Button onClick={handleCreateColumn} size="sm">
                                    Add
                                </Button>
                            </div>
                        ) : (
                            <Button
                                className="justify-start text-blue-600 dark:text-[#58a6ff]"
                                onClick={() => setShowNewColumnInput(true)}
                                variant="ghost"
                                size="sm"
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
                                        className="justify-start"
                                        onClick={() => handleSelectColumn(opt.value)}
                                        variant="ghost"
                                        size="sm"
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
                open={open}
                onOpenChange={(visible) => {
                    setOpen(visible)
                    if (!visible) {
                        setShowNewColumnInput(false)
                        setNewColumnName("")
                    }
                }}
            >
                <PopoverTrigger nativeButton={false} render={<span className="inline-flex" />}>
                    <Tooltip>
                        <TooltipTrigger
                            render={
                                <Button
                                    className={`!px-1 !h-6 text-xs ${isMapped ? "text-green-500" : "text-gray-500"}`}
                                    variant="ghost"
                                    size="icon-sm"
                                >
                                    {<MapPin size={12} weight={isMapped ? "fill" : "regular"} />}
                                </Button>
                            }
                        />
                        <TooltipContent>
                            {isMapped ? "Mapping options" : "Map to column"}
                        </TooltipContent>
                    </Tooltip>
                </PopoverTrigger>
                <PopoverContent side="bottom" align="end">
                    {content}
                </PopoverContent>
            </Popover>
        )
    },
)

MappingPopover.displayName = "MappingPopover"

function ViewModeDropdown({
    value,
    options,
    onChange,
}: {
    value: string
    options: {value: string; label: string}[]
    onChange: (mode: string) => void
}) {
    const selectedOption = options.find((option) => option.value === value)

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                className="inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 h-6 gap-1 px-2"
                onClick={(e) => e.stopPropagation()}
            >
                <span className="text-[12px] text-[var(--ag-rgba-051729-55)]">
                    View as{" "}
                    <span className="font-semibold text-[var(--ag-c-051729)]">
                        {selectedOption?.label ?? value}
                    </span>
                </span>
                <CaretDown size={12} className="text-[var(--ag-rgba-051729-55)]" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
                <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
                    {options.map((option) => (
                        <DropdownMenuRadioItem key={option.value} value={option.value} closeOnClick>
                            <div className="flex min-h-[34px] items-center justify-between gap-4 rounded-lg px-1.5 py-1 w-full">
                                <span className="text-[13px] font-medium text-[var(--ag-c-051729)]">
                                    {option.label}
                                </span>
                                {option.value === value ? (
                                    <span className="text-[11px] text-[var(--ag-rgba-051729-55)]">
                                        default
                                    </span>
                                ) : null}
                            </div>
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

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
        showMarkdownToggle = false,
        isMarkdownView = false,
        onToggleMarkdownView,
        viewModeOptions,
        viewMode,
        onViewModeChange,
        showCollapseToggle = true,
        typeChip,
        showDrillInButton = true,
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
            <div className="drill-in-field-header flex items-center justify-between py-2 px-3 bg-[var(--ag-c-FAFAFA)] rounded-md border-solid border-[1px] border-[var(--ag-rgba-051729-06)]">
                <div className="flex items-center gap-2">
                    {showCollapseToggle ? (
                        <>
                            <button
                                type="button"
                                onClick={onToggleCollapse}
                                className="flex items-center hover:text-gray-700 transition-colors bg-transparent border-none p-0 cursor-pointer"
                            >
                                {isCollapsed ? <CaretRight size={14} /> : <CaretDown size={14} />}
                            </button>
                            <span className="text-gray-700 font-medium">{name}</span>
                            {typeChip}
                        </>
                    ) : (
                        <>
                            <span className="text-gray-700 font-medium">{name}</span>
                            {typeChip}
                        </>
                    )}
                    {mappedColumn ? (
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                            mapped to {mappedColumn}
                        </span>
                    ) : nestedMappingCount > 0 ? (
                        <span className="text-xs text-green-600 dark:text-green-400 font-medium">
                            contains {nestedMappingCount} mapping
                            {nestedMappingCount > 1 ? "s" : ""}
                        </span>
                    ) : null}
                    {/* itemCount && <span className="text-xs text-gray-400">[{itemCount}]</span> */}
                </div>
                <div className="flex items-center gap-2">
                    {viewModeOptions &&
                        viewModeOptions.length > 1 &&
                        viewMode &&
                        onViewModeChange && (
                            <ViewModeDropdown
                                value={viewMode}
                                options={viewModeOptions}
                                onChange={onViewModeChange}
                            />
                        )}
                    {showCopyButton && (
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        className="!px-1 !h-6 text-xs text-gray-500"
                                        onClick={handleCopy}
                                        variant="ghost"
                                        size="icon-sm"
                                    >
                                        {copiedField === name ? (
                                            <Check size={12} />
                                        ) : (
                                            <Copy size={12} />
                                        )}
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {copiedField === name ? "Copied" : "Copy"}
                            </TooltipContent>
                        </Tooltip>
                    )}
                    {showRawToggle && onToggleRawMode && (
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        className={`!px-1 !h-6 text-xs ${isRawMode ? "text-blue-500 dark:text-[#58a6ff]" : "text-gray-500"}`}
                                        onClick={onToggleRawMode}
                                        variant="ghost"
                                        size="icon-sm"
                                    >
                                        {<Code size={12} />}
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {isRawMode ? "Show formatted" : "Show raw"}
                            </TooltipContent>
                        </Tooltip>
                    )}
                    {showMarkdownToggle && onToggleMarkdownView && (
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        className={`!px-1 !h-6 text-xs ${isMarkdownView ? "text-blue-500 dark:text-[#58a6ff]" : "text-gray-500"}`}
                                        onClick={onToggleMarkdownView}
                                        variant="ghost"
                                        size="icon-sm"
                                    >
                                        {isMarkdownView ? (
                                            <TextAa size={12} />
                                        ) : (
                                            <MarkdownLogoIcon size={12} />
                                        )}
                                    </Button>
                                }
                            />
                            <TooltipContent>
                                {isMarkdownView ? "Preview text" : "Preview markdown"}
                            </TooltipContent>
                        </Tooltip>
                    )}
                    {showDrillInButton && expandable && onDrillIn && (
                        <Button
                            onClick={onDrillIn}
                            className="!px-2 !h-6 text-xs text-gray-500"
                            variant="ghost"
                            size="sm"
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
                        <Button onClick={onDelete} variant="destructive" size="icon-sm">
                            {<Trash size={12} />}
                        </Button>
                    )}
                </div>
            </div>
        )
    },
)

DrillInFieldHeader.displayName = "DrillInFieldHeader"

export default DrillInFieldHeader
