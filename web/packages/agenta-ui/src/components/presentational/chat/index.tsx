/**
 * Chat message chrome, antd-free — the drop-in replacements for the @ant-design/x pieces the
 * desktop chat used (`Bubble`, `Actions` items, `FileCard`). Metrics mirror antd-x so the swap
 * is invisible: content 16/12 padding with a 12px radius, `filled` on the fill-content token,
 * `borderless` flush on the canvas, a 32px avatar column + 12px gap, and the 4px three-dot
 * typing loader.
 * Bodies stay caller-owned ReactNodes; nothing here knows about messages or parts.
 */
import {type ReactNode} from "react"

import {FileText, FilmStrip, Image as ImageIcon} from "@phosphor-icons/react"

import {cn} from "../../../utils/styles"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../../ui/tooltip"

/** The antd-x loading dots: three 4px primary dots on a gentle bounce. */
export const ChatTypingDots = ({className}: {className?: string}) => (
    <span className={cn("flex h-8 items-center gap-2 self-center px-0.5", className)}>
        {[0, 1, 2].map((i) => (
            <span
                key={i}
                className="size-1 rounded-full bg-colorPrimary motion-safe:animate-bounce"
                style={{animationDuration: "1.2s", animationDelay: `${i * 0.2}s`}}
            />
        ))}
    </span>
)

export interface ChatBubbleProps {
    /** `start` hugs the left (assistant), `end` the right (user). */
    placement?: "start" | "end"
    /** `filled` paints the content card, `outlined` draws its border, `borderless` sits flush. */
    variant?: "filled" | "outlined" | "borderless"
    avatar?: ReactNode
    /** Typing indicator — replaces the content with the three-dot loader. */
    loading?: boolean
    content?: ReactNode
    className?: string
    classNames?: {content?: string; body?: string}
}

/**
 * One message bubble: avatar column + content column. Pure chrome — the body is whatever the
 * caller renders (markdown, tool groups, widgets); this only owns placement, fill, and the
 * typing state.
 */
export const ChatBubble = ({
    placement = "start",
    variant = "filled",
    avatar,
    loading = false,
    content,
    className,
    classNames,
}: ChatBubbleProps) => (
    <div
        className={cn(
            "flex gap-3",
            placement === "end" && "flex-row-reverse",
            loading ? "items-center" : "items-start",
            className,
        )}
    >
        {/* 32px slot, not shrink-to-fit: antd-x reserves a 32px avatar column around its 24px
            avatar, so shrink-wrapping moved every message body 8px inboard of the desktop app. */}
        {avatar ? <div className="w-8 shrink-0">{avatar}</div> : null}
        <div className={cn("flex min-w-0 max-w-full flex-col", classNames?.body)}>
            {loading ? (
                <ChatTypingDots />
            ) : (
                <div
                    className={cn(
                        "relative box-border min-w-0 max-w-full break-words text-xs leading-normal text-colorText",
                        variant === "filled" && "rounded-xl bg-colorFillSecondary px-4 py-3",
                        variant === "outlined" &&
                            "rounded-xl border border-solid border-colorBorderSecondary px-4 py-3",
                        variant === "borderless" && "min-h-0 bg-transparent p-0",
                        classNames?.content,
                    )}
                >
                    {content}
                </div>
            )}
        </div>
    </div>
)

/** The 24px round icon avatar the bubbles used (antd `Avatar size="small"` look). */
export const ChatBubbleAvatar = ({icon, className}: {icon: ReactNode; className?: string}) => (
    <span
        className={cn(
            "flex size-6 items-center justify-center rounded-full",
            "bg-colorTextQuaternary text-white",
            className,
        )}
    >
        {icon}
    </span>
)

/** One toolbar icon button with its tooltip — an antd-x `Actions` item, as plain markup. */
export const ChatActionIconButton = ({
    label,
    icon,
    onClick,
}: {
    label: string
    icon: ReactNode
    onClick: () => void
}) => (
    <TooltipProvider delayDuration={300}>
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    type="button"
                    aria-label={label}
                    onClick={onClick}
                    className={cn(
                        "flex size-6 cursor-pointer items-center justify-center rounded border-0",
                        "bg-transparent text-colorTextSecondary transition-colors",
                        "hover:bg-colorFillTertiary hover:text-colorText",
                    )}
                >
                    {icon}
                </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-64 text-xs">{label}</TooltipContent>
        </Tooltip>
    </TooltipProvider>
)

const CARD_WIDTH = "w-[268px] max-w-full"

const KIND_ICONS = {
    image: ImageIcon,
    video: FilmStrip,
    file: FileText,
} as const

export interface ChatAttachmentCardProps {
    name: string
    kind: "image" | "video" | "file"
    src?: string
    /** The media source is still being fetched — show the placeholder box instead of a broken img. */
    loading?: boolean
    /** Second line of the file chip (media type, a download link, an unavailable note). */
    description?: ReactNode
    className?: string
    onImageError?: () => void
    onVideoError?: () => void
}

/**
 * A message attachment (the antd-x `FileCard` roles): images and video preview inline at the
 * 268px card width; anything else is a typed chip with the name and a caller-owned description
 * line. Audio never routes here — the chat keeps its own player.
 */
export const ChatAttachmentCard = ({
    name,
    kind,
    src,
    loading = false,
    description,
    className,
    onImageError,
    onVideoError,
}: ChatAttachmentCardProps) => {
    if (kind === "image" || kind === "video") {
        // Both media kinds share the placeholder: a src-less <video> renders an empty player,
        // which reads as broken exactly the way a src-less <img> does.
        if (loading || !src) {
            return (
                <div
                    className={cn(
                        CARD_WIDTH,
                        "h-[140px] animate-pulse rounded-md bg-colorFillTertiary",
                        className,
                    )}
                    aria-label={`Loading ${name}`}
                />
            )
        }
        return kind === "image" ? (
            <img
                src={src}
                alt={name}
                onError={onImageError}
                className={cn(
                    CARD_WIDTH,
                    "h-auto rounded-md border border-solid border-colorBorderSecondary",
                    className,
                )}
            />
        ) : (
            <video
                src={src}
                controls
                onError={onVideoError}
                className={cn(CARD_WIDTH, "rounded-md", className)}
            />
        )
    }

    const Icon = KIND_ICONS[kind]
    return (
        <div
            className={cn(
                CARD_WIDTH,
                "box-border flex h-10 items-center gap-2 rounded-md border border-solid",
                "border-colorBorderSecondary bg-colorBgContainer px-2",
                className,
            )}
        >
            <Icon size={20} className="shrink-0 text-colorTextSecondary" />
            <div className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-medium text-colorText" title={name}>
                    {name}
                </span>
                {description}
            </div>
        </div>
    )
}
