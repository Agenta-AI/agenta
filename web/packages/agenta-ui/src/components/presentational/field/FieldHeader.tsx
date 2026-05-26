/**
 * FieldHeader
 *
 * A header component for text fields with copy and markdown toggle functionality.
 * Used in table cells, form fields, and drill-in views.
 *
 * @example
 * ```tsx
 * <FieldHeader
 *   id="field-123"
 *   value="Some text content"
 *   hideMarkdownToggle={false}
 * />
 * ```
 */

import {memo, useCallback, useState} from "react"

import {Check, Copy} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"

import {copyToClipboard} from "../../../utils/copyToClipboard"
import {cn, flexLayouts, gapClasses, justifyClasses} from "../../../utils/styles"

export interface FieldHeaderProps {
    /** Unique identifier for the field. Retained for backwards compatibility. */
    id?: string
    /** The text value to copy when clicking the copy button */
    value?: string
    /**
     * Deprecated: markdown switching has moved to the shared viewMode dropdown
     * (ChatMessageViewModeDropdown / DrillInFieldHeader). The inline button is
     * no longer rendered regardless of this flag — kept to preserve the
     * existing prop shape for current callers.
     */
    hideMarkdownToggle?: boolean
}

/**
 * Field header with a copy button. The legacy markdown toggle that lived here
 * has been replaced by the shared viewMode dropdown surfaced by chat messages
 * and drill-in field headers — see ChatMessageViewModeDropdown.
 */
const FieldHeader = ({value = ""}: FieldHeaderProps) => {
    const [isCopied, setIsCopied] = useState(false)

    const onCopyText = useCallback(async () => {
        if (value) {
            const success = await copyToClipboard(value)
            if (success) {
                setIsCopied(true)
                setTimeout(() => {
                    setIsCopied(false)
                }, 1000)
            }
        }
    }, [value])

    return (
        <div className={cn(flexLayouts.rowCenter, justifyClasses.end, gapClasses.xs, "w-full")}>
            <Tooltip title={isCopied ? "Copied" : "Copy"}>
                <Button
                    type="text"
                    size="small"
                    icon={isCopied ? <Check size={14} /> : <Copy size={14} />}
                    onClick={onCopyText}
                    className={cn(flexLayouts.rowCenter, justifyClasses.center)}
                />
            </Tooltip>
        </div>
    )
}

export default memo(FieldHeader)
