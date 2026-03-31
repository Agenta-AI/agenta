import {memo, useCallback, type ReactNode} from "react"

import {Copy} from "@phosphor-icons/react"
import {Button, Popover} from "antd"

import {message} from "../utils/appMessageContext"

interface PopoverContentProps {
    children: ReactNode
    onCopy?: () => void
}

/**
 * Popover content wrapper with copy button
 */
const PopoverContentWrapper = memo(({children, onCopy}: PopoverContentProps) => {
    return (
        <div className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
            {onCopy && (
                <div className="flex justify-end">
                    <Button type="text" size="small" icon={<Copy size={14} />} onClick={onCopy}>
                        Copy
                    </Button>
                </div>
            )}
            <div className="max-h-[350px] overflow-auto">{children}</div>
        </div>
    )
})
PopoverContentWrapper.displayName = "PopoverContentWrapper"

interface CellContentPopoverProps {
    /** The cell content to wrap */
    children: ReactNode
    /** Full content to show in popover */
    fullContent: ReactNode
    /** Raw text for copy functionality */
    copyText?: string
    /** Disable popover */
    disabled?: boolean
    /** Max width of popover */
    maxWidth?: number
    /** Show copy button */
    showCopy?: boolean
}

/**
 * Wraps table cell content with a hover popover that shows the full content.
 * Used to preview truncated cell content without opening the focus drawer.
 *
 * Features:
 * - Hover trigger with delay to prevent accidental opens
 * - Copy button for easy content copying
 * - Destroy on hidden for performance
 */
const CellContentPopover = memo(
    ({
        children,
        fullContent,
        copyText,
        disabled,
        maxWidth = 500,
        showCopy = true,
    }: CellContentPopoverProps) => {
        const handleCopy = useCallback(() => {
            if (copyText) {
                navigator.clipboard.writeText(copyText)
                message.success("Copied to clipboard")
            }
        }, [copyText])

        if (disabled) {
            return <>{children}</>
        }

        return (
            <Popover
                trigger="hover"
                mouseEnterDelay={0.5}
                mouseLeaveDelay={0.2}
                destroyOnHidden
                styles={{
                    root: {
                        maxWidth,
                        maxHeight: 400,
                    },
                }}
                content={
                    <PopoverContentWrapper onCopy={showCopy && copyText ? handleCopy : undefined}>
                        {fullContent}
                    </PopoverContentWrapper>
                }
            >
                {children}
            </Popover>
        )
    },
)
CellContentPopover.displayName = "CellContentPopover"

export default CellContentPopover
