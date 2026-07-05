import {memo, useState, type ReactElement, type ReactNode} from "react"

import {Popover, PopoverContent, PopoverTrigger} from "@agenta/primitive-ui/components/popover"
import {CopyButton} from "@agenta/ui"

interface CellContentPopoverProps {
    children: ReactNode
    content: ReactNode
    disabled?: boolean
    copyContent?: string
}

/**
 * Wraps table cell content with a hover popover that shows the full content.
 * Used to preview truncated cell content without opening the focus drawer.
 */
const CellContentPopover = ({
    children,
    content,
    disabled,
    copyContent,
}: CellContentPopoverProps) => {
    const [open, setOpen] = useState(false)

    if (disabled) {
        return <>{children}</>
    }

    const popoverContent = (
        <div className="relative">
            <div className="max-w-[400px] max-h-[300px] overflow-auto text-xs pr-6">{content}</div>
            {copyContent && (
                <div className="absolute -top-1 -right-1">
                    <CopyButton
                        text={copyContent}
                        icon={true}
                        buttonText={null}
                        size="small"
                        stopPropagation={true}
                        type="text"
                    />
                </div>
            )}
        </div>
    )

    return (
        <Popover
            open={open}
            onOpenChange={(nextOpen, eventDetails) => {
                if (eventDetails.reason === "trigger-press") return
                setOpen(nextOpen)
            }}
        >
            <PopoverTrigger
                nativeButton={false}
                render={children as ReactElement}
                openOnHover
                delay={500}
                closeDelay={100}
            />
            <PopoverContent
                side="top"
                align="center"
                className="w-auto p-3 shadow-[0_4px_12px_rgba(0,0,0,0.15)]"
            >
                {popoverContent}
            </PopoverContent>
        </Popover>
    )
}

export default memo(CellContentPopover)
