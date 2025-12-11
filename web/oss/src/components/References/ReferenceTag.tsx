import {ArrowSquareOut} from "@phosphor-icons/react"
import {Tag, type TagProps, Tooltip} from "antd"
import clsx from "clsx"
import {useRouter} from "next/router"

import {message} from "@/oss/components/AppMessageContext"

import {getReferenceToneColors, type ReferenceTone} from "./referenceColors"

interface ReferenceTagProps extends TagProps {
    label: string
    href?: string
    showIcon?: boolean
    tooltip?: string
    copyValue?: string
    tone?: ReferenceTone
    openExternally?: boolean
}

const ReferenceTag = ({
    label,
    href,
    showIcon = true,
    className,
    tooltip,
    copyValue,
    tone,
    openExternally = false,
    ...props
}: ReferenceTagProps) => {
    const router = useRouter()
    const isClickable = Boolean(href)
    const toneColors = getReferenceToneColors(tone)

    const tagNode = (
        <Tag
            bordered={false}
            className={clsx(
                "group flex items-center gap-1 border border-solid rounded px-2 py-0.5 text-xs transition-all",
                toneColors
                    ? "hover:brightness-95"
                    : "bg-[#0517290F] hover:bg-[#05172916] text-[#344054] border-transparent",
                className,
            )}
            style={
                toneColors
                    ? {
                          backgroundColor: toneColors.background,
                          borderColor: toneColors.border,
                          color: toneColors.text,
                      }
                    : undefined
            }
            {...props}
        >
            <span
                className="truncate max-w-[220px] cursor-copy"
                onClick={async (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    try {
                        if (copyValue) {
                            await navigator.clipboard.writeText(copyValue)
                            message.success("Copied to clipboard")
                        }
                    } catch (err) {
                        message.error("Copy failed")
                    }
                }}
            >
                {label}
            </span>
            {showIcon && isClickable ? (
                <ArrowSquareOut
                    role="button"
                    aria-label="Open link"
                    size={14}
                    className="transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 cursor-pointer"
                    style={{color: toneColors?.text ?? "#2563eb"}}
                    onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (href) {
                            if (openExternally) {
                                window.open(href, "_blank", "noreferrer")
                            } else {
                                void router.push(href)
                            }
                        }
                    }}
                />
            ) : null}
        </Tag>
    )

    if (!tooltip) {
        return tagNode
    }

    return (
        <Tooltip title={tooltip} mouseEnterDelay={0.2}>
            {tagNode}
        </Tooltip>
    )
}

export default ReferenceTag
