import React from "react"

import {Badge} from "antd"
import clsx from "clsx"

type CustomAntdBadgeProps = {
    className?: string
} & React.ComponentProps<typeof Badge>

const CustomAntdBadge = ({className, ...props}: CustomAntdBadgeProps) => {
    return (
        <Badge
            color="#000000"
            className={clsx(className, [
                "[&_.ant-badge-count]:!rounded-[4px]",
                "[&_.ant-badge-count]:!h-[14px]",
                "[&_.ant-badge-count]:!min-w-[14px]",
                "[&_.ant-badge-count]:text-[10px]",
                "[&_.ant-badge-count]:!flex",
                "[&_.ant-badge-count]:items-center",
                "[&_.ant-badge-count]:justify-center",
            ])}
            {...props}
        />
    )
}

export default CustomAntdBadge
