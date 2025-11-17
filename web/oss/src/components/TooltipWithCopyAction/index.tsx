import {cloneElement, MouseEvent, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {CheckCircleFilled} from "@ant-design/icons"
import clsx from "clsx"
import dynamic from "next/dynamic"

import {TooltipWithCopyActionProps} from "./types"

const Tooltip = dynamic(() => import("antd").then((mod) => mod.Tooltip), {ssr: false})

const TooltipWithCopyAction = ({
    children,
    title,
    copyText,
    tooltipProps,
    duration = 1500,
}: TooltipWithCopyActionProps) => {
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
            <CheckCircleFilled style={{color: "green"}} />
            <span>Copied to clipboard</span>
        </div>
    ) : (
        title
    )

    const childrenProps = useMemo(() => {
        return {
            ...children.props,
            className: clsx("cursor-copy", children.props?.className),
            onClick: (event: MouseEvent) => {
                event.stopPropagation()
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

export default TooltipWithCopyAction
