import {cloneElement, useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {MouseEvent, ReactElement, ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import {CheckCircle} from "@phosphor-icons/react"
import clsx from "clsx"

import {message} from "../../utils/appMessageContext"
import {copyToClipboard} from "../../utils/copyToClipboard"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../ui/tooltip"

/**
 * Local, antd-free stand-in for antd `TooltipProps` (only the surface call-sites pass).
 * Kept structurally compatible so an antd `TooltipProps` object still assigns — the
 * component translates what Radix expresses and drops the antd-only bits.
 */
export interface CopyTooltipOverlayProps {
    title?: ReactNode
    /** antd placement (12-way); translated to Radix `side` + `align`. */
    placement?: string
    open?: boolean
    defaultOpen?: boolean
    onOpenChange?: (open: boolean) => void
    /** Seconds, antd-style; translated to Radix `delayDuration` (ms). */
    mouseEnterDelay?: number
    mouseLeaveDelay?: number
    /** antd renders an arrow by default; our TooltipContent always does. Accepted, unused. */
    arrow?: boolean | {pointAtCenter?: boolean}
    overlayClassName?: string
    className?: string
    [key: string]: unknown
}

interface CopyTooltipChildProps {
    className?: string
    onClick?: (event: MouseEvent<HTMLElement>) => void
}

export interface CopyTooltipProps {
    /** The element that copies on click: a text span, a badge, or a `Button` with a copy icon. */
    children: ReactElement<CopyTooltipChildProps>
    /** Tooltip text before the copy. After it, the tooltip says the text was copied. */
    title: string
    copyText?: string
    /** How long (ms) the "copied" tooltip stays. */
    duration?: number
    /** Also toast this after the copy; a touch screen shows no tooltip. */
    successMessage?: string
    tooltipProps?: CopyTooltipOverlayProps
}

// antd placement (12-way) → Radix side/align.
const toSide = (p?: string): "top" | "right" | "bottom" | "left" =>
    !p
        ? "top"
        : p.startsWith("bottom")
          ? "bottom"
          : p.startsWith("left")
            ? "left"
            : p.startsWith("right")
              ? "right"
              : "top"

const toAlign = (p?: string): "start" | "center" | "end" =>
    p?.endsWith("Left") || p?.endsWith("Top")
        ? "start"
        : p?.endsWith("Right") || p?.endsWith("Bottom")
          ? "end"
          : "center"

/** CopyTooltip — the one copy control: wraps any element (a span, a badge, a copy-icon `Button`). */
export function CopyTooltip({
    children,
    title,
    copyText,
    tooltipProps,
    duration = 1500,
    successMessage,
}: CopyTooltipProps) {
    const t = useT(commonCatalog)
    const [isCopied, setIsCopied] = useState(false)
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleClick = useCallback(async () => {
        if (!copyText) return
        const copied = await copyToClipboard(copyText)
        if (!copied) {
            setIsCopied(false)
            return
        }
        setIsCopied(true)
        if (successMessage) message.success(successMessage)

        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => {
            setIsCopied(false)
        }, duration)
    }, [copyText, duration, successMessage])

    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
        }
    }, [timeoutRef])

    const tooltipDisplay = isCopied ? (
        <div className="flex items-center gap-1">
            <CheckCircle size={14} weight="fill" className="text-success" />
            <span>{t("common.copiedToClipboard")}</span>
        </div>
    ) : (
        title
    )

    const childrenProps = useMemo(() => {
        return {
            ...children.props,
            className: clsx("cursor-copy", children.props?.className),
            onClick: (event: MouseEvent<HTMLElement>) => {
                event?.stopPropagation?.()
                children.props?.onClick?.(event)
                if (copyText) {
                    handleClick()
                }
            },
        }
    }, [children, copyText, handleClick])

    // antd's default mouseEnterDelay is 0.1s; tooltipProps may override (seconds → ms).
    const delayDuration = (tooltipProps?.mouseEnterDelay ?? 0.1) * 1000
    const placement = (tooltipProps?.placement as string | undefined) ?? "top"

    return (
        <TooltipProvider delayDuration={delayDuration}>
            <Tooltip
                open={tooltipProps?.open}
                defaultOpen={tooltipProps?.defaultOpen}
                onOpenChange={tooltipProps?.onOpenChange}
            >
                <TooltipTrigger asChild>{cloneElement(children, childrenProps)}</TooltipTrigger>
                <TooltipContent side={toSide(placement)} align={toAlign(placement)}>
                    {tooltipProps?.title ?? tooltipDisplay}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

export default CopyTooltip
