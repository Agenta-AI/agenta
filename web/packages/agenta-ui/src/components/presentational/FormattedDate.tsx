import {useState} from "react"

import {dayjs} from "@agenta/shared/utils"
import {Check, Copy} from "@phosphor-icons/react"
import {Tag, Tooltip} from "antd"

import {copyToClipboard} from "../../utils/copyToClipboard"
import {cn, textColors} from "../../utils/styles"

export interface FormattedDateProps {
    date: string | number | Date | null | undefined
    format?: string
    fallback?: string
    asTag?: boolean
    className?: string
}

function getRawDateString(date: string | number | Date): string {
    if (typeof date === "string") return date
    if (typeof date === "number") return new Date(date).toISOString()
    return date.toISOString()
}

export function FormattedDate({
    date,
    format = "MMM D, YYYY h:mm A",
    fallback = "-",
    asTag = false,
    className,
}: FormattedDateProps) {
    const [copied, setCopied] = useState(false)

    if (date == null) {
        return <span className={cn(textColors.muted, className)}>{fallback}</span>
    }

    const parsed = dayjs(date)
    if (!parsed.isValid()) {
        return <span className={cn(textColors.muted, className)}>{fallback}</span>
    }

    const formatted = parsed.format(format)
    const rawValue = getRawDateString(date)

    const handleCopy = async (e: React.MouseEvent) => {
        e.stopPropagation()
        const success = await copyToClipboard(rawValue)
        if (success) {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
    }

    const icon = copied ? (
        <Check size={12} className="flex-shrink-0" />
    ) : (
        <Copy
            size={12}
            className="flex-shrink-0 opacity-0 group-hover/date:opacity-100 transition-opacity"
        />
    )

    const tooltipTitle = copied ? "Copied!" : `Click to copy: ${rawValue}`

    const inner = (
        <Tooltip title={tooltipTitle} mouseEnterDelay={0.4}>
            <span
                className={cn(
                    "group/date inline-flex items-center gap-1 cursor-pointer",
                    !asTag && className,
                )}
                onClick={handleCopy}
            >
                {formatted}
                {icon}
            </span>
        </Tooltip>
    )

    if (asTag) {
        return (
            <Tag variant="filled" className={cn("bg-[#0517290F]", className)}>
                {inner}
            </Tag>
        )
    }

    return inner
}
