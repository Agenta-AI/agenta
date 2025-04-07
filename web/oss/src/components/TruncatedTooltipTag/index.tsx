import {Tag, Tooltip} from "antd"
import React from "react"

const TruncatedTooltipTag = ({
    children,
    width = 400,
    ...props
}: {children: string; width?: number} & React.ComponentProps<typeof Tooltip>) => {
    return (
        <Tooltip
            title={children}
            overlayClassName={`max-w-[${width}px] w-fit`}
            className={`overflow-hidden text-ellipsis whitespace-nowrap max-w-[${width}px]`}
            placement="bottomLeft"
            {...props}
        >
            <Tag>{children}</Tag>
        </Tooltip>
    )
}

export default TruncatedTooltipTag
