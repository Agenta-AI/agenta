/**
 * QueueDescriptionPanel
 *
 * Popover trigger for the queue description.
 * Keeping the description in an overlay avoids pushing the session layout down.
 */

import {memo, useState} from "react"

import {Popover, PopoverContent, PopoverTrigger} from "@agenta/primitive-ui/components/popover"
import {CaretDown, Info} from "@phosphor-icons/react"

interface QueueDescriptionPanelProps {
    description: string
}

const QueueDescriptionPanel = memo(function QueueDescriptionPanel({
    description,
}: QueueDescriptionPanelProps) {
    const [open, setOpen] = useState(false)

    return (
        <div className="border-b border-solid border-[var(--ant-color-border-secondary)]">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger
                    render={
                        <button
                            type="button"
                            aria-expanded={open}
                            className="flex items-center gap-2 w-full px-4 py-2 text-left bg-[var(--ant-color-fill-quaternary)] hover:bg-[var(--ant-color-fill-tertiary)] transition-colors cursor-pointer border-none"
                        >
                            <Info size={14} className="shrink-0 text-[var(--ag-c-758391)]" />
                            <span className="text-xs font-medium flex-1 text-muted-foreground">
                                Description
                            </span>
                            <CaretDown
                                size={12}
                                className={`text-[var(--ag-c-758391)] transition-transform ${open ? "rotate-180" : ""}`}
                            />
                        </button>
                    }
                />
                <PopoverContent
                    side="bottom"
                    align="start"
                    className="w-[min(640px,calc(100vw-32px))] max-h-[min(320px,calc(100vh-160px))] overflow-y-auto gap-0 p-0"
                >
                    <div className="px-4 py-3">
                        <span className="block whitespace-pre-wrap text-sm leading-6 text-[var(--ant-color-text)]">
                            {description}
                        </span>
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    )
})

export default QueueDescriptionPanel
