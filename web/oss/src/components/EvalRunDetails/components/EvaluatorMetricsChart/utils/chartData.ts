import type {BasicStats} from "@/oss/lib/metricUtils"

const normalizeStats = (value: BasicStats | undefined): any => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value
    const next: any = {...value}

    if (Array.isArray(next.freq)) {
        next.frequency = next.freq.map((entry: any) => ({
            value: entry?.value,
            count: entry?.count ?? entry?.frequency ?? 0,
        }))
        delete next.freq
    }

    if (Array.isArray(next.uniq)) {
        next.unique = next.uniq
        delete next.uniq
    }

    if (Array.isArray(next.frequency)) {
        next.frequency = next.frequency.map((entry: any) => ({
            value: entry?.value,
            count: entry?.count ?? entry?.frequency ?? 0,
        }))
        // Sort by count descending, then boolean true first, then false, then others by string value
        next.frequency.sort((a: any, b: any) => {
            const countDiff = (b?.count ?? 0) - (a?.count ?? 0)
            if (countDiff !== 0) return countDiff
            // Explicitly handle boolean values
            const aIsTrue = a?.value === true
            const bIsTrue = b?.value === true
            if (aIsTrue && !bIsTrue) return -1
            if (!aIsTrue && bIsTrue) return 1
            const aIsFalse = a?.value === false
            const bIsFalse = b?.value === false
            if (aIsFalse && !bIsFalse) return -1
            if (!aIsFalse && bIsFalse) return 1
            // Fallback: compare stringified values
            const aStr = String(a?.value)
            const bStr = String(b?.value)
            return aStr.localeCompare(bStr)
        })
        next.rank = next.frequency
        if (!Array.isArray(next.unique) || !next.unique.length) {
            next.unique = next.frequency.map((entry: any) => entry.value)
        }
    } else if (Array.isArray(next.rank)) {
        next.rank = next.rank.map((entry: any) => ({
            value: entry?.value,
            count: entry?.count ?? entry?.frequency ?? 0,
        }))
    }

    if (Array.isArray(next.hist)) {
        if (!Array.isArray(next.distribution) || !next.distribution.length) {
            next.distribution = next.hist
                .map((entry: any) => {
                    const interval = Array.isArray(entry?.interval) ? entry.interval : []
                    const start =
                        interval.length && typeof interval[0] === "number"
                            ? interval[0]
                            : typeof entry?.value === "number"
                              ? entry.value
                              : typeof entry?.bin === "number"
                                ? entry.bin
                                : 0
                    return {
                        value: start,
                        count: entry?.count ?? 0,
                    }
                })
                .sort((a: any, b: any) => (a?.value ?? 0) - (b?.value ?? 0))
        }

        if (typeof next.binSize !== "number") {
            // Validate that all intervals have the same width
            const widths: number[] = []
            for (const entry of next.hist) {
                const interval = Array.isArray(entry?.interval) ? entry.interval : null
                if (interval && interval.length >= 2) {
                    const width = Number(interval[1]) - Number(interval[0])
                    if (Number.isFinite(width) && width > 0) {
                        widths.push(width)
                    }
                }
            }
            // Check if all widths are the same
            if (widths.length > 0 && widths.every((w) => w === widths[0])) {
                next.binSize = widths[0]
            }
        }

        if (typeof next.min !== "number") {
            const interval = Array.isArray(next.hist[0]?.interval) ? next.hist[0]?.interval : null
            if (interval && interval.length) next.min = interval[0]
        }

        if (typeof next.max !== "number") {
            const last = next.hist[next.hist.length - 1]
            const interval = Array.isArray(last?.interval) ? last.interval : null
            if (interval && interval.length) next.max = interval[interval.length - 1]
        }
    }

    return next
}

export const buildHistogramChartData = (
    stats: Record<string, any>,
): {data: {x: string | number; y: number; edge?: number}[]; binSize?: number} => {
    const normalized = normalizeStats(stats)

    const distribution = Array.isArray(normalized?.distribution) ? normalized.distribution : []
    if (!distribution.length) return {data: []}

    const result: {data: {x: string | number; y: number; edge?: number}[]; binSize?: number} = {
        data: [],
    }
    if (typeof normalized.binSize === "number" && typeof normalized.min === "number") {
        const entries = distribution.map((entry: any, idx: number) => {
            const start = Number(normalized.min) + idx * Number(normalized.binSize)
            return {
                x: `${start.toPrecision(3)}–${(start + Number(normalized.binSize)).toPrecision(3)}`,
                y: Number(entry?.count ?? entry?.value ?? 0),
                edge: start,
            }
        })
        result.data = entries
        result.binSize = Number(normalized.binSize)
        return result
    }

    if (distribution.every((entry: any) => typeof entry?.value === "number")) {
        result.data = distribution.map((entry: any) => ({
            x: String(entry.value),
            y: Number(entry?.count ?? entry?.value ?? 0),
            edge: entry.value,
        }))
    } else if (distribution.every((entry: any) => typeof entry?.count === "number")) {
        result.data = distribution
            .map((entry: any, index: number) => ({
                x: String(entry?.value ?? index),
                y: Number(entry?.count ?? 0),
                edge: typeof entry?.value === "number" ? entry.value : index,
            }))
            .filter((entry: {x: string | number; y: number}) => Number.isFinite(entry.y))
    } else {
        result.data = []
    }

    return result
}

export const buildFrequencyChartData = (
    stats: Record<string, any>,
): {label: string | number; value: number}[] => {
    const normalized = normalizeStats(stats)

    const frequency = Array.isArray(normalized?.frequency) ? normalized.frequency : []
    if (frequency.length) {
        return frequency.map((entry: any) => ({
            label: entry?.value ?? "",
            value: Number(entry?.count ?? 0),
        }))
    }

    const rank = Array.isArray(normalized?.rank) ? normalized.rank : []
    if (rank.length) {
        return rank.map((entry: any) => ({
            label: entry?.value ?? "",
            value: Number(entry?.count ?? 0),
        }))
    }

    return []
}
