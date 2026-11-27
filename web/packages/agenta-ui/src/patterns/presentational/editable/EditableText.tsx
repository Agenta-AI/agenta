/**
 * EditableText Component
 *
 * An inline editable text component that switches between display and edit mode.
 * Useful for renaming items, editing labels, and other inline text editing scenarios.
 *
 * Features:
 * - Click to edit
 * - Enter to save
 * - Escape to cancel
 * - Blur to save
 * - Validation (disallow empty values by default)
 *
 * @example
 * ```tsx
 * import {EditableText} from '@agenta/ui'
 *
 * <EditableText
 *   value={name}
 *   onChange={setName}
 *   placeholder="Enter name..."
 * />
 * ```
 *
 * antd → @agenta/ui mapping (pre-migration body: antd `Tooltip` + `Typography.Text`, NOT
 * `Typography.Text editable` — this control has never had antd's pencil button + textarea):
 * `Tooltip` → Radix `Tooltip`, `Typography.Text` → plain `<span>`, `Input size="small"` →
 * `Input size="sm"`. Geometry, the click-to-edit affordance (`cursor-pointer` +
 * hover colour/underline), the "Click to edit" tooltip, the italic placeholder, and the
 * fixed `w-32` edit input are all carried over unchanged.
 * Two deliberate deviations from the pre-migration render:
 *  - text is `text-label` (13px), the default for single-line UI.
 *  - hover goes from `muted-foreground` to `foreground`, so both themes are covered.
 */

import {useState, useEffect, useCallback} from "react"

import {useT} from "@agenta/i18n"
import uiControlsCatalog from "@agenta/i18n/catalogs/ui.controls"

import {Input} from "../../../primitives/input"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../../../primitives/tooltip"

export interface EditableTextProps {
    /** Current value */
    value: string
    /** Callback when value changes */
    onChange: (newValue: string) => void
    /** Placeholder text when in edit mode */
    placeholder?: string
    /** Additional CSS classes for the text display */
    className?: string
    /** Tooltip text shown when hovering */
    tooltip?: string
    /** Callback when editing state changes */
    onEditingChange?: (isEditing: boolean) => void
    /** Whether to allow empty values (default: false) */
    allowEmpty?: boolean
    /** Input width class (default: "w-32") */
    inputWidth?: string
    /** Whether the text is monospace (default: true) */
    monospace?: boolean
}

/**
 * EditableText - Inline editable text component
 *
 * Provides a clean UX for inline text editing with keyboard support.
 * - Click text to enter edit mode
 * - Press Enter or blur to save
 * - Press Escape to cancel
 * - Empty values are rejected by default
 */
export function EditableText({
    value,
    onChange,
    placeholder: placeholderProp,
    className = "",
    tooltip: tooltipProp,
    onEditingChange,
    allowEmpty = false,
    inputWidth = "w-32",
    monospace = true,
}: EditableTextProps) {
    const t = useT(uiControlsCatalog)
    const placeholder = placeholderProp ?? t("ui.controls.enterValue")
    const tooltip = tooltipProp ?? t("ui.controls.clickToEdit")
    const [isEditing, setIsEditing] = useState(false)
    const [editValue, setEditValue] = useState(value)

    // Sync editValue when value prop changes from outside
    useEffect(() => {
        if (!isEditing) {
            setEditValue(value)
        }
    }, [value, isEditing])

    const handleStartEdit = useCallback(() => {
        setIsEditing(true)
        onEditingChange?.(true)
    }, [onEditingChange])

    const handleSave = useCallback(() => {
        setIsEditing(false)
        onEditingChange?.(false)

        const trimmed = editValue.trim()
        const isValid = allowEmpty || trimmed.length > 0

        if (isValid && trimmed !== value) {
            onChange(trimmed)
        } else {
            // Reset if invalid or unchanged
            setEditValue(value)
        }
    }, [editValue, value, onChange, onEditingChange, allowEmpty])

    const handleCancel = useCallback(() => {
        setEditValue(value)
        setIsEditing(false)
        onEditingChange?.(false)
    }, [value, onEditingChange])

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault()
                handleSave()
            } else if (e.key === "Escape") {
                e.preventDefault()
                handleCancel()
            }
        },
        [handleSave, handleCancel],
    )

    if (isEditing) {
        return (
            <Input
                size="sm"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                placeholder={placeholder}
                autoFocus
                className={`${inputWidth} ${monospace ? "text-code-sm" : "text-label"}`}
            />
        )
    }

    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        className={`text-label cursor-pointer hover:text-foreground hover:underline ${
                            monospace ? "font-mono" : ""
                        } ${className}`}
                        onClick={handleStartEdit}
                    >
                        {value || (
                            <span className="text-muted-foreground italic">{placeholder}</span>
                        )}
                    </span>
                </TooltipTrigger>
                <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

export default EditableText
