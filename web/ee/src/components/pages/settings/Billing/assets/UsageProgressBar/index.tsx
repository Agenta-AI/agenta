import {memo} from "react"

import {WarningFilled} from "@ant-design/icons"
import {Space, Typography} from "antd"

import {UsageProgressBarProps} from "../types"

const UsageProgressBar = ({
    label,
    limit,
    used: value,
    isUnlimited = false,
    free,
}: UsageProgressBarProps) => {
    return (
        <div className="w-full flex flex-col gap-1">
            <Typography.Text className="text-[#586673] font-medium capitalize">
                {label}{" "}
                {!isUnlimited && value >= limit && <WarningFilled className="text-yellow-500" />}
            </Typography.Text>

            <Space>
                <Typography.Text className="text-sm font-medium">{`${value} / ${limit ? limit : "-"}`}</Typography.Text>
                <Typography.Text
                    type="secondary"
                    className="font-medium"
                >{`${free ? `(${value > free ? free : value} / ${free} free)` : ``}`}</Typography.Text>
            </Space>
        </div>
    )
}

export default memo(UsageProgressBar)
