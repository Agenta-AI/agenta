import {type ComponentProps} from "react"

import {Tag, Tooltip} from "antd"

const TruncatedTooltipTag = ({
    children,
    width = 400,
    ...props
}: {children: string; width?: number} & ComponentProps<typeof Tooltip>) => {
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
