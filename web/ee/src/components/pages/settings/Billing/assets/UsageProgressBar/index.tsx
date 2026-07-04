import {memo} from "react"

import {Warning} from "@phosphor-icons/react"

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
            <span className="text-[var(--ag-c-586673)] font-medium capitalize">
                {prettifyLabel(label)}
                {suffix}{" "}
                {!isUnlimited && value >= limit && (
                    <Warning weight="fill" className="inline-block text-yellow-500" size={14} />
                )}
            </span>

            <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{`${value} / ${limit ? limit : "-"}`}</span>
                <span className="font-medium text-muted-foreground">{`${free ? `(${value > free ? free : value} / ${free} free)` : ``}`}</span>
            </div>
        </div>
    )
}

export default memo(UsageProgressBar)
