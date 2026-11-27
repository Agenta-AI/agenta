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
 * />
 * ```
 */

import {memo, useCallback, useState} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {Check, Copy} from "@phosphor-icons/react"

import {copyToClipboard} from "../../../foundation/utils/copyToClipboard"
import {Button} from "../../../primitives/button"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../../../primitives/tooltip"

export interface FieldHeaderProps {
    /** Unique identifier for the field. Retained for backwards compatibility. */
    id?: string
    /** The text value to copy when clicking the copy button */
    value?: string
}

/**
 * Field header with a copy button. The legacy markdown toggle that lived here
 * has been replaced by the shared viewMode dropdown surfaced by chat messages
 * and drill-in field headers — see ChatMessageViewModeDropdown.
 */
const FieldHeader = ({value = ""}: FieldHeaderProps) => {
    const t = useT(commonCatalog)
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
        <div className="flex items-center justify-end gap-1 w-full">
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onCopyText}
                            className="flex items-center justify-center"
                        >
                            {isCopied ? <Check size={14} /> : <Copy size={14} />}
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                        {isCopied ? t("common.copied") : t("common.copy")}
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
        </div>
    )
}

export default memo(FieldHeader)
