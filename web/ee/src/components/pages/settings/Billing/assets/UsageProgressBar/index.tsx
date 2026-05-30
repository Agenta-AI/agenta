import {memo} from "react"

import {WarningFilled} from "@ant-design/icons"
import {Space, Typography} from "antd"

import {UsageProgressBarProps} from "../types"

const PERIOD_SUFFIX: Record<string, string> = {
    daily: "today",
    monthly: "this month",
    yearly: "this year",
}

const SCOPE_SUFFIX: Record<string, string> = {
    user: "per user",
    project: "per project",
    workspace: "per workspace",
    // organization scope is implicit — no suffix.
}

const prettifyLabel = (label: string): string => label.replace(/_/g, " ")

const UsageProgressBar = ({
    label,
    limit,
    used: value,
    isUnlimited = false,
    free,
    period,
    scope,
}: UsageProgressBarProps) => {
    const suffixParts: string[] = []
    if (scope && SCOPE_SUFFIX[scope]) {
        suffixParts.push(SCOPE_SUFFIX[scope])
    }
    if (period && PERIOD_SUFFIX[period]) {
        suffixParts.push(PERIOD_SUFFIX[period])
    }
    const suffix = suffixParts.length ? ` (${suffixParts.join(", ")})` : ""

    return (
        <div className="w-full flex flex-col gap-1">
            <Typography.Text className="text-[var(--ag-c-586673)] font-medium capitalize">
                {prettifyLabel(label)}
                {suffix}{" "}
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
