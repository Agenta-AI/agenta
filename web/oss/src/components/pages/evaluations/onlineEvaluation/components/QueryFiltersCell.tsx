import React, {useEffect, useMemo, useState} from "react"

import {Skeleton} from "antd"

import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"

import {
    retrieveQueryRevision,
    type QueryFilteringPayload,
} from "../../../../../services/onlineEvaluations/api"

import FiltersPreview from "./FiltersPreview"

type RowRecord = any

export default function QueryFiltersCell({record}: {record: RowRecord}) {
    // Find the input step that references a query
    const inputStep = (record?.data?.steps || []).find((s: any) => s?.type === "input")
    const qRefs = inputStep?.references || {}
    const queryId = qRefs?.query?.id || qRefs?.queryId

    const [revision, setRevision] = useState<any>()
    const [isLoading, setIsLoading] = useState<boolean>(Boolean(queryId))

    useEffect(() => {
        let mounted = true

        ;(async () => {
            if (!queryId) {
                if (mounted) {
                    setRevision(undefined)
                    setIsLoading(false)
                }
                return
            }

            if (mounted) setIsLoading(true)

            try {
                const res = await retrieveQueryRevision({query_ref: {id: queryId}})
                if (!mounted) return
                setRevision(res?.query_revision || null)
            } catch {
                if (mounted) setRevision(null)
            } finally {
                if (mounted) setIsLoading(false)
            }
        })()

        return () => {
            mounted = false
        }
    }, [queryId])

    const {filtering, windowing} = (revision?.data ?? {}) as {
        filtering?: QueryFilteringPayload
        windowing?: {rate?: number; limit?: number; newest?: string; oldest?: string}
    }

    const ratePercent = useMemo(() => {
        const r = typeof windowing?.rate === "number" ? windowing?.rate : undefined
        if (r === undefined || Number.isNaN(r)) return undefined
        const clamped = Math.max(0, Math.min(1, r))
        return Math.round(clamped * 100)
    }, [windowing?.rate])

    const historicalRangeLabel = useMemo(() => {
        const oldest = windowing?.oldest
        const newest = windowing?.newest
        if (!oldest || !newest) return undefined
        const oldestDate = dayjs(oldest)
        const newestDate = dayjs(newest)
        if (!oldestDate.isValid() || !newestDate.isValid()) return undefined
        const diffDays = Math.max(newestDate.diff(oldestDate, "day"), 0)
        if (diffDays > 0 && diffDays <= 31) {
            return `Historical: Last ${diffDays} day${diffDays === 1 ? "" : "s"}`
        }
        return `Historical: ${oldestDate.format("DD MMM YYYY")} – ${newestDate.format(
            "DD MMM YYYY",
        )}`
    }, [windowing?.newest, windowing?.oldest])

    const hasMeta = Boolean(windowing?.oldest && windowing?.newest && historicalRangeLabel)

    if (isLoading) {
        return (
            <div className="flex flex-col gap-2">
                <Skeleton.Input active size="small" block style={{height: 20}} />
                <Skeleton.Input active size="small" block style={{height: 20}} />
            </div>
        )
    }

    if (!filtering && !hasMeta) return null

    return (
        <div className="flex flex-col gap-2">
            <FiltersPreview filtering={filtering} compact />
            {hasMeta ? (
                <div className="flex flex-wrap gap-3 text-[11px] text-[#667085]">
                    {historicalRangeLabel ? (
                        <span className="whitespace-nowrap">{historicalRangeLabel}</span>
                    ) : null}
                    {typeof ratePercent === "number" ? (
                        <span className="whitespace-nowrap">Sample rate: {ratePercent}%</span>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}
