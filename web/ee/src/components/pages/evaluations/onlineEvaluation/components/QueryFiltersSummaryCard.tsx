import {useMemo} from "react"

import clsx from "clsx"

import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"

import type {
    QueryFilteringPayload,
    QueryWindowingPayload,
} from "../../../../../services/onlineEvaluations/api"

import FiltersPreview from "./FiltersPreview"

interface QueryFiltersSummaryCardProps {
    filtering?: QueryFilteringPayload | null
    windowing?: QueryWindowingPayload | null
    loading?: boolean
    createdAt?: string | number | null
    className?: string
}

export const buildHistoricalWindowLabel = ({
    windowing,
    createdAt,
}: {
    windowing?: QueryWindowingPayload | null
    createdAt?: string | number | null
}) => {
    const oldest = windowing?.oldest
    const newest = windowing?.newest

    if (oldest && newest) {
        const oldestDate = dayjs(oldest)
        const newestDate = dayjs(newest)
        if (oldestDate.isValid() && newestDate.isValid()) {
            const diffDays = Math.max(newestDate.diff(oldestDate, "day"), 0)
            if (diffDays > 0 && diffDays <= 31) {
                return `Historical window: Last ${diffDays} day${diffDays === 1 ? "" : "s"}`
            }
            return `Historical window: ${oldestDate.format("DD MMM YYYY")} – ${newestDate.format(
                "DD MMM YYYY",
            )}`
        }
    }

    if (createdAt !== undefined && createdAt !== null) {
        const createdMoment = dayjs(createdAt)
        if (createdMoment.isValid()) {
            return `Since query creation on ${createdMoment.format(
                "DD MMM YYYY HH:mm",
            )} (${createdMoment.fromNow()})`
        }
    }

    return "Live traffic as it arrives"
}

const QueryFiltersSummaryCard = ({
    filtering,
    windowing,
    loading,
    createdAt,
    className,
}: QueryFiltersSummaryCardProps) => {
    const historicalLabel = useMemo(
        () => buildHistoricalWindowLabel({windowing, createdAt}),
        [windowing, createdAt],
    )

    return (
        <div
            className={clsx(
                "rounded-lg border border-solid border-[#E4E7EC] bg-[#F9FAFB] p-4",
                className,
            )}
        >
            <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-[0.08em] text-[#667085]">
                    Query filters
                </span>
                {loading ? <span className="text-xs text-[#98A2B3]">Loading…</span> : null}
            </div>
            <div className="flex flex-col gap-2 text-left">
                {loading ? null : <FiltersPreview filtering={filtering ?? undefined} compact />}
                {historicalLabel ? (
                    <span className="text-xs text-[#667085]">{historicalLabel}</span>
                ) : null}
            </div>
        </div>
    )
}

export default QueryFiltersSummaryCard
