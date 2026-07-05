import {memo} from "react"

import {Popover, PopoverContent, PopoverTrigger} from "@agenta/primitive-ui/components/popover"
import {Tag} from "antd"
import clsx from "clsx"

import type {ResultTagProps} from "./types"

const resultTagClass =
    "flex items-center w-fit p-0 cursor-pointer [&>span.value1]:bg-colorFillQuaternary [&>span.value1]:flex-1 [&>span.value1]:px-2 [&>span.value1]:border-r [&>span.value1]:border-colorBorder [&>span.value2]:bg-colorBgContainer [&>span.value2]:pl-1 [&>span.value2]:pr-2 [&>span.value2]:rounded-[inherit] [&>div.singleValue]:px-2 [&>div.singleValue]:flex [&>div.singleValue]:items-center [&>div.singleValue]:gap-2"

const ResultTag = memo(
    ({value1, value2, className, popoverContent, bordered, variant, ...props}: ResultTagProps) => {
        const resolvedVariant = variant ?? (bordered === false ? "filled" : undefined)

        const content =
            value2 !== undefined ? (
                <>
                    <span className="value1">{value1}</span>
                    <span className="value2 break-words overflow-hidden whitespace-break-spaces">
                        {value2}
                    </span>
                </>
            ) : (
                <div className="singleValue break-words overflow-hidden whitespace-break-spaces">
                    {value1}
                </div>
            )

        const tag = (
            <Tag className={clsx(resultTagClass, className)} variant={resolvedVariant} {...props}>
                {content}
            </Tag>
        )

        return popoverContent ? (
            <Popover>
                <PopoverTrigger nativeButton={false} render={tag} />
                <PopoverContent side="bottom" align="center" className="w-[240px]">
                    {popoverContent}
                </PopoverContent>
            </Popover>
        ) : (
            tag
        )
    },
)

export default ResultTag
