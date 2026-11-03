import {useEffect, useRef, useState, type ReactNode} from "react"

import {CollapseToggleButton} from "@agenta/ui/components/presentational"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {
    ArrowClockwise,
    Check,
    Copy,
    FileArchive,
    Image as PhImage,
    MinusCircle,
    Paperclip,
} from "@phosphor-icons/react"

const COPIED_MS = 1000

export interface MessageToolbarProps {
    /** Re-run is left out on a tool message. */
    onRerun?: () => void
    rerunDisabled?: boolean
    /** Add attachment is left out unless the message takes attachments (a user message). */
    onAddImage?: () => void
    onAddDocument?: () => void
    /** False once the message has the most image slots it takes. */
    canAddImage?: boolean
    /** False once the message has the most document slots it takes. */
    canAddDocument?: boolean
    /** The text Copy puts on the clipboard. */
    copyText: string
    onRemove: () => void
    collapsed: boolean
    onToggleCollapse: () => void
    /** Controls that sit before the buttons, such as the view mode. */
    children?: ReactNode
}

/**
 * The buttons of one message. They show on hover or focus inside the message, and always on a
 * touch screen, which has no hover.
 */
export const MessageToolbar = ({
    onRerun,
    rerunDisabled,
    onAddImage,
    onAddDocument,
    canAddImage: imageAllowed = true,
    canAddDocument: documentAllowed = true,
    copyText,
    onRemove,
    collapsed,
    onToggleCollapse,
    children,
}: MessageToolbarProps) => {
    const [copied, setCopied] = useState(false)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])

    const copy = () => {
        if (!copyText) return
        setCopied(true)
        void navigator.clipboard.writeText(copyText)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), COPIED_MS)
    }

    const canAddImage = Boolean(onAddImage) && imageAllowed
    const canAddDocument = Boolean(onAddDocument) && documentAllowed
    const copyLabel = copied ? "Copied" : "Copy"

    return (
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/message:opacity-100 group-focus-within/message:opacity-100 [@media(hover:none)]:opacity-100">
            {children}
            {onRerun ? (
                <SimpleTooltip title="Re-run" side="top">
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Re-run"
                        disabled={rerunDisabled}
                        onClick={onRerun}
                    >
                        <ArrowClockwise />
                    </Button>
                </SimpleTooltip>
            ) : null}
            {onAddImage || onAddDocument ? (
                <DropdownMenu>
                    <SimpleTooltip title="Add attachment" side="top">
                        <span className="inline-flex">
                            <DropdownMenuTrigger asChild disabled={!canAddImage && !canAddDocument}>
                                <Button variant="ghost" size="icon" aria-label="Add attachment">
                                    <Paperclip />
                                </Button>
                            </DropdownMenuTrigger>
                        </span>
                    </SimpleTooltip>
                    <DropdownMenuContent align="end">
                        {onAddImage ? (
                            <DropdownMenuItem disabled={!canAddImage} onSelect={onAddImage}>
                                <PhImage />
                                Upload image
                            </DropdownMenuItem>
                        ) : null}
                        {onAddDocument ? (
                            <DropdownMenuItem disabled={!canAddDocument} onSelect={onAddDocument}>
                                <FileArchive />
                                Attach document
                            </DropdownMenuItem>
                        ) : null}
                    </DropdownMenuContent>
                </DropdownMenu>
            ) : null}
            <SimpleTooltip title={copyLabel} side="top">
                <Button variant="ghost" size="icon" aria-label={copyLabel} onClick={copy}>
                    {copied ? <Check /> : <Copy />}
                </Button>
            </SimpleTooltip>
            <SimpleTooltip title="Remove" side="top">
                <Button variant="ghost" size="icon" aria-label="Remove" onClick={onRemove}>
                    <MinusCircle />
                </Button>
            </SimpleTooltip>
            <CollapseToggleButton collapsed={collapsed} onToggle={onToggleCollapse} size="icon" />
        </div>
    )
}
