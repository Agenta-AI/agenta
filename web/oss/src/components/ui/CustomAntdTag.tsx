import React from "react"
import {Tag} from "antd"
import clsx from "clsx"
import {getStringOrJson} from "@/oss/lib/helpers/utils"

type CustomAntdTagProps = {
    value: string
    className?: string
} & React.ComponentProps<typeof Tag>

const CustomAntdTag = ({value, className, ...props}: CustomAntdTagProps) => {
    return (
        <Tag className={clsx([className, "bg-[rgba(5,23,41,0.06)]"])} {...props}>
            {getStringOrJson(value)}
        </Tag>
    )
}

export default CustomAntdTag
