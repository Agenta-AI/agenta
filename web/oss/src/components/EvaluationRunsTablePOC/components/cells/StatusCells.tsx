import {Tooltip, Typography} from "antd"

import SkeletonLine from "@/oss/components/InfiniteVirtualTable/components/common/SkeletonLine"

import type {EvaluationRunTableRow} from "../../types"

type AntBadgeStatus = "success" | "processing" | "default" | "error" | "warning"

const STATUS_COLORS: Record<AntBadgeStatus, string> = {
    success: "#12B76A",
    processing: "#3B82F6",
    default: "#98A2B3",
    error: "#F04438",
    warning: "#F79009",
}

const humanizeStatus = (value: string) =>
    value
        .toString()
        .replaceAll("_", " ")
        .replace(/(^|\s)([a-z])/g, (match) => match.toUpperCase())

const mapBadgeStatus = (raw: string): AntBadgeStatus => {
    const s = raw.toLowerCase()
    if (s.includes("success") || s.includes("completed") || s === "finished" || s === "ok")
        return "success"
    if (s.includes("fail") || s.includes("error")) return "error"
    if (s.includes("run") || s.includes("progress") || s.includes("queued") || s.includes("active"))
        return "processing"
    if (s.includes("warn") || s.includes("partial") || s.includes("degraded")) return "warning"
    if (s.includes("cancel") || s.includes("stop") || s.includes("closed")) return "default"
    return "default"
}

const CELL_CLASS = "flex h-full w-full min-w-0 flex-col justify-center gap-1 px-2"

const StatusIndicator = ({label, tone}: {label: string; tone: AntBadgeStatus}) => {
    const dotColor = STATUS_COLORS[tone]
    return (
        <Tooltip title={label} mouseEnterDelay={0.1} mouseLeaveDelay={0} placement="right">
            <span className="flex items-center gap-2" aria-label={label} role="img">
                <span
                    className="inline-block rounded-full"
                    style={{backgroundColor: dotColor, width: 12, height: 12}}
                />
            </span>
        </Tooltip>
    )
}

export const PreviewStatusCell = ({record}: {record: EvaluationRunTableRow}) => {
    if (record.__isSkeleton) {
        return (
            <div className={CELL_CLASS}>
                <SkeletonLine width="40%" />
            </div>
        )
    }

    const status = record.status ?? null

    if (!status) {
        return (
            <div className={CELL_CLASS}>
                <Typography.Text>—</Typography.Text>
            </div>
        )
    }

    const label = humanizeStatus(status)
    const badgeStatus = mapBadgeStatus(status)

    return (
        <div className={CELL_CLASS}>
            <StatusIndicator label={label} tone={badgeStatus} />
        </div>
    )
}
