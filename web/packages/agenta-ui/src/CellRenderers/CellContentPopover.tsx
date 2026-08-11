import {memo, useCallback, useEffect, useRef, useState, type ReactNode} from "react"

import {Copy} from "@phosphor-icons/react"

import {Button} from "../components/ui/button"
import {Popover, PopoverAnchor, PopoverArrow, PopoverContent} from "../components/ui/popover"
import {message} from "../utils/appMessageContext"

/** Radix Popover has no hover trigger; reproduce antd's enter/leave delays. */
function useHoverOpen(enterDelay: number, leaveDelay: number) {
    const [open, setOpen] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

    const clear = () => {
        if (timer.current) clearTimeout(timer.current)
        timer.current = null
    }
    useEffect(() => clear, [])

    return {
        open,
        setOpen,
        onMouseEnter: () => {
            clear()
            timer.current = setTimeout(() => setOpen(true), enterDelay)
        },
        onMouseLeave: () => {
            clear()
            timer.current = setTimeout(() => setOpen(false), leaveDelay)
        },
    }
}

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
                    <Button variant="ghost" size="sm" onClick={onCopy}>
                        {<Copy size={14} />}
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

        // antd mouseEnterDelay 0.5s / mouseLeaveDelay 0.2s.
        const hover = useHoverOpen(500, 200)

        if (disabled) {
            return <>{children}</>
        }

        return (
            <Popover open={hover.open} onOpenChange={hover.setOpen}>
                {/* Anchor (not Trigger): the cell keeps its own click semantics. */}
                <PopoverAnchor asChild>
                    {/* self-start/h-fit: the row is a flex container, so this div would otherwise
                        stretch to the full (often oversized) row height, throwing off both the
                        anchor's bounds and the "close to the item" top-centered positioning. */}
                    <div
                        className="self-start h-fit"
                        onMouseEnter={hover.onMouseEnter}
                        onMouseLeave={hover.onMouseLeave}
                    >
                        {children}
                    </div>
                </PopoverAnchor>
                <PopoverContent
                    side="top"
                    align="center"
                    className="p-3"
                    onMouseEnter={hover.onMouseEnter}
                    onMouseLeave={hover.onMouseLeave}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    style={{maxWidth, maxHeight: 400}}
                >
                    <PopoverContentWrapper onCopy={showCopy && copyText ? handleCopy : undefined}>
                        {fullContent}
                    </PopoverContentWrapper>
                    <PopoverArrow />
                </PopoverContent>
            </Popover>
        )
    },
)
CellContentPopover.displayName = "CellContentPopover"

export default CellContentPopover
