import {memo} from "react"

import {WarningIcon} from "@phosphor-icons/react"

import type {BillingUsagePeriod, BillingUsageScope} from "./types"

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

export interface UsageProgressBarProps {
    label: string
    used: number
    limit: number
    free: number
    isUnlimited?: boolean
    strict?: boolean
    period?: BillingUsagePeriod
    scope?: BillingUsageScope
}

/** One quota: what it counts, over which window, and how close to the ceiling it is. */
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
        <div className="flex w-full flex-col gap-1">
            <span className="inline-flex items-center gap-1 font-medium capitalize text-colorTextSecondary">
                {prettifyLabel(label)}
                {suffix}
                {/* A limit of 0 (or one the API did not send) is "unknown", not "exhausted" —
                    `value >= limit` warned on every metric before the plan resolved. */}
                {!isUnlimited && limit > 0 && value >= limit ? (
                    <WarningIcon weight="fill" className="text-colorWarning" />
                ) : null}
            </span>

            <span className="flex items-center gap-2">
                <span className="text-xs font-medium text-colorText">{`${value} / ${limit ? limit : "-"}`}</span>
                <span className="font-medium text-colorTextSecondary">
                    {free ? `(${value > free ? free : value} / ${free} free)` : ""}
                </span>
            </span>
        </div>
    )
}

export default memo(UsageProgressBar)
