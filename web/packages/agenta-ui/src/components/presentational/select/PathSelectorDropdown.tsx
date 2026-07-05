/**
 * PathSelectorDropdown Component
 *
 * A dropdown selector for paths with source grouping and type indicators.
 * Shows icons for different source types (output, testcase, etc.).
 *
 * @example
 * ```tsx
 * import { PathSelectorDropdown } from '@agenta/ui'
 *
 * const paths = [
 *   { path: 'output.text', label: 'text', valueType: 'string', source: 'output' },
 *   { path: 'testcase.prompt', label: 'prompt', valueType: 'string', source: 'testcase' },
 * ]
 *
 * <PathSelectorDropdown
 *   value={selectedPath}
 *   paths={paths}
 *   onChange={(path) => setSelectedPath(path)}
 * />
 * ```
 */

import {memo} from "react"

import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxTrigger,
    ComboboxValue,
} from "@agenta/primitive-ui/components/combobox"
import {Lightning, Table, Database} from "@phosphor-icons/react"

import {cn} from "../../../utils/styles"

// ============================================================================
// TYPES
// ============================================================================

/**
 * Path item for selection - extends TypedPathInfo with optional additional properties
 */
export interface PathSelectorItem {
    /** The path string (used as value) */
    path: string
    /** Alternative path string representation */
    pathString?: string
    /** Display label */
    label: string
    /** Value type for display */
    valueType?: string
    /** Legacy type field */
    type?: string
    /** Source category for grouping/icons */
    source?: string
}

export interface PathSelectorDropdownProps {
    /** Currently selected path */
    value: string | undefined
    /** Callback when path changes */
    onChange: (value: string) => void
    /** Available paths to select from */
    paths: PathSelectorItem[]
    /** Placeholder text */
    placeholder?: string
    /** Allow clearing selection */
    allowClear?: boolean
    /** Size variant */
    size?: "small" | "middle" | "large"
    /** Additional CSS class */
    className?: string
    /** Whether the selector is disabled */
    disabled?: boolean
    /** Custom source icon renderer */
    renderSourceIcon?: (source: string) => React.ReactNode
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Default icon renderer based on source type
 */
function defaultSourceIcon(source: string | undefined, size: number): React.ReactNode {
    switch (source) {
        case "testcase":
            return <Table size={size} className="text-green-600 flex-shrink-0" />
        case "output":
            return <Lightning size={size} className="text-blue-500 flex-shrink-0" />
        default:
            return <Database size={size} className="text-gray-400 flex-shrink-0" />
    }
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Dropdown selector for paths with source icons and type indicators
 */
export const PathSelectorDropdown = memo(function PathSelectorDropdown({
    value,
    onChange,
    paths,
    placeholder = "Select source...",
    allowClear = false,
    size = "small",
    className,
    disabled = false,
    renderSourceIcon,
}: PathSelectorDropdownProps) {
    const iconSize = size === "small" ? 12 : 14

    return (
        <Combobox value={value || undefined} onValueChange={onChange}>
            <ComboboxTrigger
                className={cn("w-full", className)}
                size={size === "small" ? "sm" : undefined}
            >
                <ComboboxValue placeholder={placeholder} />
            </ComboboxTrigger>
            <ComboboxContent>
                <ComboboxInput placeholder="Search..." />
                <ComboboxEmpty>No results found</ComboboxEmpty>
                {paths.map((p) => (
                    <ComboboxItem key={p.pathString || p.path} value={p.pathString || p.path}>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1">
                                {renderSourceIcon
                                    ? renderSourceIcon(p.source || "unknown")
                                    : defaultSourceIcon(p.source, iconSize)}
                                <span className="truncate">{p.label}</span>
                            </div>
                            <span className="text-xs ml-2 text-muted-foreground">
                                {p.valueType || p.type || ""}
                            </span>
                        </div>
                    </ComboboxItem>
                ))}
            </ComboboxContent>
        </Combobox>
    )
})

export default PathSelectorDropdown
