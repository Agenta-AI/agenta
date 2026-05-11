import {cloneElement, useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {MouseEvent} from "react"

import {CheckCircle} from "@phosphor-icons/react"
import {Tooltip} from "antd"
import clsx from "clsx"

import {CopyTooltipProps} from "./types"

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
            <CheckCircle size={14} weight="fill" color="green" />
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

    return (
        <Tooltip title={tooltipDisplay} placement="top" {...tooltipProps}>
            {cloneElement(children, childrenProps)}
        </Tooltip>
    )
}

export default CopyTooltip
