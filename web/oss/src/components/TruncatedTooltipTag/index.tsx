import {memo} from "react"

import {Tag, TagProps, Tooltip, TooltipProps} from "antd"
import {Inter} from "next/font/google"

const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
})

const TruncatedTooltipTag = ({
    children,
    width = 400,
    tagProps,
    ...props
}: {children: string; width?: number; tagProps?: TagProps} & TooltipProps) => {
    return (
        <Tooltip
            title={
                <pre className="text-wrap" style={{fontFamily: inter.style.fontFamily}}>
                    {children}
                </pre>
            }
            overlayClassName={`w-fit text-wrap`}
            className={`overflow-hidden text-ellipsis whitespace-nowrap max-w-[100%]`}
            placement="bottomLeft"
            {...props}
        >
            <Tag {...tagProps}>{children}</Tag>
        </Tooltip>
    )
}

export default memo(TruncatedTooltipTag)
