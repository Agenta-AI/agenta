import {cloneElement, useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {MouseEvent} from "react"

import {CheckCircle} from "@phosphor-icons/react"
import clsx from "clsx"

import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "../components/ui/tooltip"

import {CopyTooltipProps} from "./types"

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

const CopyTooltip = ({
    children,
    title,
    copyText,
    tooltipProps,
    duration = 1500,
}: CopyTooltipProps) => {
    const [isCopied, setIsCopied] = useState(false)
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleClick = useCallback(async () => {
        if (!copyText) return
        try {
            await navigator.clipboard.writeText(copyText)
            setIsCopied(true)

            if (timeoutRef.current) clearTimeout(timeoutRef.current)

            timeoutRef.current = setTimeout(() => {
                setIsCopied(false)
            }, duration)
        } catch (err) {
            setIsCopied(false)
        }
    }, [copyText, duration])

    useEffect(() => {
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
        }
    }, [timeoutRef])

    const tooltipDisplay = isCopied ? (
        <div className="flex items-center gap-1">
            <CheckCircle size={14} weight="fill" className="text-colorSuccess" />
            <span>Copied to clipboard</span>
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
