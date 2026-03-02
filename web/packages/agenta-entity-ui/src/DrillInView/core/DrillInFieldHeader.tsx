/**
 * DrillInFieldHeader
 *
 * Reusable field header component for drill-in views.
 * Displays field name, controls for collapse/expand, raw mode toggle,
 * copy, delete, and column mapping.
 *
 * The showMessage function is injectable for clipboard notifications.
 */

import {memo, useCallback, useState, type ReactNode} from "react"

import {
    CaretDown,
    CaretRight,
    Check,
    Code,
    Copy,
    MapPin,
    MapPinSimple,
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
    /** Whether to show collapse toggle (default: true) */
    showCollapse?: boolean
    /** Injectable message display function (for clipboard notifications) */
    showMessage?: (content: string, type?: "success" | "error" | "info") => void

    // Icon slots - allow custom icons to be passed in
    /** Caret down icon */
    caretDownIcon?: ReactNode
    /** Caret right icon */
    caretRightIcon?: ReactNode
    /** Check icon */
    checkIcon?: ReactNode
    /** Copy icon */
    copyIcon?: ReactNode
    /** Code icon */
    codeIcon?: ReactNode
    /** Markdown icon */
    markdownIcon?: ReactNode
    /** Text icon */
    textIcon?: ReactNode
    /** Delete/trash icon */
    deleteIcon?: ReactNode
    /** Map pin icon */
    mapPinIcon?: ReactNode
    /** Map pin filled icon */
    mapPinFilledIcon?: ReactNode
    /** Close icon */
    closeIcon?: ReactNode

    // Component slots - allow custom components to be passed in
    /** Custom button component */
    Button?: React.ComponentType<{
        type?: "text" | "primary"
        size?: "small"
        danger?: boolean
        className?: string
        icon?: ReactNode
        onClick?: () => void
        children?: ReactNode
    }>
    /** Custom tooltip component */
    Tooltip?: React.ComponentType<{
        title?: string
        children: ReactNode
    }>
    /** Custom popover component */
    Popover?: React.ComponentType<{
        content?: ReactNode
        trigger?: "click" | "hover"
        open?: boolean
        onOpenChange?: (visible: boolean) => void
        placement?: string
        children: ReactNode
    }>
    /** Custom input component */
    Input?: React.ComponentType<{
        size?: "small"
        placeholder?: string
        value?: string
        onChange?: (e: {target: {value: string}}) => void
        onPressEnter?: () => void
        autoFocus?: boolean
    }>
}

/**
 * Default button implementation using native HTML
 */
const DefaultButton = ({
    type,
    size: _size,
    danger,
    className,
    icon,
    onClick,
    children,
}: {
    type?: "text" | "primary"
    size?: "small"
    danger?: boolean
    className?: string
    icon?: ReactNode
    onClick?: () => void
    children?: ReactNode
}) => (
    <button
        type="button"
        className={`inline-flex items-center justify-center gap-1 px-2 py-1 text-xs rounded border-none cursor-pointer ${
            type === "text"
                ? "bg-transparent hover:bg-gray-100"
                : "bg-blue-500 text-white hover:bg-blue-600"
        } ${danger ? "text-red-500 hover:text-red-600" : ""} ${className ?? ""}`}
        onClick={onClick}
    >
        {icon}
        {children}
    </button>
)

/**
 * Default tooltip implementation (no-op, just renders children)
 */
const DefaultTooltip = ({children}: {title?: string; children: ReactNode}) => <>{children}</>

/**
 * Default icons using Phosphor icons
 */
const defaultIcons = {
    caretDown: <CaretDown size={14} />,
    caretRight: <CaretRight size={14} />,
    check: <Check size={14} />,
    copy: <Copy size={14} />,
    code: <Code size={14} />,
    markdown: <span className="text-xs font-medium">M↓</span>,
    text: <TextAa size={14} />,
    delete: <Trash size={14} />,
    mapPin: <MapPinSimple size={14} />,
    mapPinFilled: <MapPin size={14} weight="fill" />,
    close: <X size={14} />,
}

/**
 * Mapping popover component for mapping a field to a column
 */
const MappingPopoverContent = memo(
    ({
        columnOptions,
        onMapToColumn,
        onUnmap,
        isMapped,
        onClose,
        Button,
        Input,
        closeIcon,
    }: {
        columnOptions?: {value: string; label: string}[]
        onMapToColumn: (column: string) => void
        onUnmap?: () => void
        isMapped: boolean
        onClose: () => void
        Button: NonNullable<DrillInFieldHeaderProps["Button"]>
        Input?: DrillInFieldHeaderProps["Input"]
        closeIcon: ReactNode
    }) => {
        const [newColumnName, setNewColumnName] = useState("")
        const [showNewColumnInput, setShowNewColumnInput] = useState(false)

        const handleSelectColumn = useCallback(
            (column: string) => {
                onMapToColumn(column)
                onClose()
            },
            [onMapToColumn, onClose],
        )

        const handleCreateColumn = useCallback(() => {
            if (newColumnName.trim()) {
                onMapToColumn(newColumnName.trim())
                setNewColumnName("")
                setShowNewColumnInput(false)
                onClose()
            }
        }, [newColumnName, onMapToColumn, onClose])

        const handleUnmap = useCallback(() => {
            onUnmap?.()
            onClose()
        }, [onUnmap, onClose])

        if (isMapped) {
            return (
                <div className="flex flex-col gap-1 min-w-[180px]">
                    <Button
                        type="text"
                        danger
                        size="small"
                        className="justify-start"
                        icon={closeIcon}
                        onClick={handleUnmap}
                    >
                        Remove mapping
                    </Button>
                </div>
            )
        }

        return (
            <div className="flex flex-col gap-1 min-w-[180px]">
                {showNewColumnInput ? (
                    <div className="flex gap-1">
                        {Input ? (
                            <Input
                                size="small"
                                placeholder="Column name"
                                value={newColumnName}
                                onChange={(e) => setNewColumnName(e.target.value)}
                                onPressEnter={handleCreateColumn}
                                autoFocus
                            />
                        ) : (
                            <input
                                type="text"
                                placeholder="Column name"
                                value={newColumnName}
                                onChange={(e) => setNewColumnName(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleCreateColumn()}
                                autoFocus
                                className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                            />
                        )}
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
            </div>
        )
    },
)

MappingPopoverContent.displayName = "MappingPopoverContent"

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
        showMarkdownToggle = false,
        isMarkdownView = false,
        onToggleMarkdownView,
        showCollapse = true,
        showMessage,
        // Icons
        caretDownIcon = defaultIcons.caretDown,
        caretRightIcon = defaultIcons.caretRight,
        checkIcon = defaultIcons.check,
        copyIcon = defaultIcons.copy,
        codeIcon = defaultIcons.code,
        markdownIcon = defaultIcons.markdown,
        textIcon = defaultIcons.text,
        deleteIcon = defaultIcons.delete,
        mapPinIcon = defaultIcons.mapPin,
        mapPinFilledIcon = defaultIcons.mapPinFilled,
        closeIcon = defaultIcons.close,
        // Components
        Button = DefaultButton,
        Tooltip = DefaultTooltip,
        Popover,
        Input,
    }: DrillInFieldHeaderProps) => {
        const [copiedField, setCopiedField] = useState<string | null>(null)
        const [popoverOpen, setPopoverOpen] = useState(false)

        const handleCopy = useCallback(() => {
            const valueToCopy = typeof value === "string" ? value : JSON.stringify(value, null, 2)
            navigator.clipboard.writeText(valueToCopy)
            setCopiedField(name)
            showMessage?.("Copied to clipboard", "success")
            setTimeout(() => setCopiedField(null), 1000)
        }, [value, name, showMessage])

        const showCopyButton = alwaysShowCopy || isCollapsed || expandable

        // Mapping popover content
        const mappingContent = onMapToColumn && (
            <MappingPopoverContent
                columnOptions={columnOptions}
                onMapToColumn={onMapToColumn}
                onUnmap={onUnmap}
                isMapped={isMapped}
                onClose={() => setPopoverOpen(false)}
                Button={Button}
                Input={Input}
                closeIcon={closeIcon}
            />
        )

        return (
            <div className="flex items-center justify-between py-2 px-3 bg-[#FAFAFA] rounded-md border-solid border-[1px] border-[rgba(5,23,41,0.06)]">
                <div className="flex items-center gap-2">
                    {showCollapse ? (
                        <button
                            type="button"
                            onClick={onToggleCollapse}
                            className="flex items-center gap-2 text-left hover:text-gray-700 transition-colors bg-transparent border-none p-0 cursor-pointer"
                        >
                            {isCollapsed ? caretRightIcon : caretDownIcon}
                            <span className="text-gray-700 font-medium">{name}</span>
                        </button>
                    ) : (
                        <span className="text-gray-700 font-medium">{name}</span>
                    )}
                    {mappedColumn ? (
                        <span className="text-xs text-green-600 font-medium">
                            mapped to {mappedColumn}
                        </span>
                    ) : nestedMappingCount > 0 ? (
                        <span className="text-xs text-green-600 font-medium">
                            contains {nestedMappingCount} mapping
                            {nestedMappingCount > 1 ? "s" : ""}
                        </span>
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
                                icon={copiedField === name ? checkIcon : copyIcon}
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
                                icon={codeIcon}
                                onClick={onToggleRawMode}
                            />
                        </Tooltip>
                    )}
                    {showMarkdownToggle && onToggleMarkdownView && (
                        <Tooltip title={isMarkdownView ? "Preview text" : "Preview markdown"}>
                            <Button
                                type="text"
                                size="small"
                                className={`!px-1 !h-6 text-xs ${isMarkdownView ? "text-blue-500" : "text-gray-500"}`}
                                icon={isMarkdownView ? textIcon : markdownIcon}
                                onClick={onToggleMarkdownView}
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
                            {caretRightIcon}
                            <span className="ml-1">Drill In</span>
                        </Button>
                    )}
                    {onMapToColumn &&
                        (Popover ? (
                            <Popover
                                content={mappingContent}
                                trigger="click"
                                open={popoverOpen}
                                onOpenChange={setPopoverOpen}
                                placement="bottomRight"
                            >
                                <Tooltip title={isMapped ? "Mapping options" : "Map to column"}>
                                    <Button
                                        type="text"
                                        size="small"
                                        className={`!px-1 !h-6 text-xs ${isMapped ? "text-green-500" : "text-gray-500"}`}
                                        icon={isMapped ? mapPinFilledIcon : mapPinIcon}
                                    />
                                </Tooltip>
                            </Popover>
                        ) : (
                            <div className="relative">
                                <Tooltip title={isMapped ? "Mapping options" : "Map to column"}>
                                    <Button
                                        type="text"
                                        size="small"
                                        className={`!px-1 !h-6 text-xs ${isMapped ? "text-green-500" : "text-gray-500"}`}
                                        icon={isMapped ? mapPinFilledIcon : mapPinIcon}
                                        onClick={() => setPopoverOpen(!popoverOpen)}
                                    />
                                </Tooltip>
                                {popoverOpen && (
                                    <div className="absolute right-0 top-full mt-1 bg-white rounded-md shadow-lg border border-gray-200 z-50">
                                        {mappingContent}
                                    </div>
                                )}
                            </div>
                        ))}
                    {showDelete && onDelete && (
                        <Button
                            type="text"
                            size="small"
                            danger
                            icon={deleteIcon}
                            onClick={onDelete}
                        />
                    )}
                </div>
            </div>
        )
    },
)

DrillInFieldHeader.displayName = "DrillInFieldHeader"

export {DrillInFieldHeader}
