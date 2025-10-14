import {memo} from "react"

import {CheckCircleOutlined} from "@ant-design/icons"
import {Typography} from "antd"

import {TabLabelProps} from "./types"

const TabLabel = ({children, tabTitle, completed}: TabLabelProps) => {
    return (
        <div className="flex flex-col w-full items-start gap-2">
            <div className="flex items-center gap-1">
                <Typography.Text className="!my-0">{tabTitle}</Typography.Text>
                {completed ? <CheckCircleOutlined style={{color: "green"}} /> : null}
            </div>
            {completed && <div className="flex flex-col gap-1 w-full">{children}</div>}
        </div>
    )
}

export default memo(TabLabel)
