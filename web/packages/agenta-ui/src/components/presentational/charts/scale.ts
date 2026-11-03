/**
 * Pure scale and layout math for the SVG charts. No DOM, so it is unit tested directly.
 */
import type {ChartSeries} from "./types"

/** Approximate width of one character of the 11px chart text. Used to fit labels. */
export const CHAR_WIDTH = 6.5

const SERIES_TOKEN_COUNT = 5

export function seriesColor(series: ChartSeries, index: number): string {
    return series.color ?? `var(--ag-chart-series-${index % SERIES_TOKEN_COUNT})`
}

export function formatChartValue(value: number): string {
    if (!Number.isFinite(value)) return String(value)
    return String(Number(value.toPrecision(3)))
}

/** A readable step (1, 2, 2.5 or 5 times a power of ten) that splits `range` into about `count` parts. */
export function niceStep(range: number, count: number): number {
    if (!(range > 0) || count < 1) return 1
    const raw = range / count
    const power = 10 ** Math.floor(Math.log10(raw))
    const fraction = raw / power
    const nice =
        fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
    return nice * power
}

/** Rounds `value` to the precision of `step`, to drop float noise such as 0.30000000000000004. */
function snap(value: number, step: number): number {
    const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 2)
    return Number(value.toFixed(decimals))
}

/** Rounds the largest value up to a readable tick. */
export function niceMax(value: number, count = 4): number {
    if (!(value > 0)) return 1
    const step = niceStep(value, count)
    return snap(Math.ceil(value / step) * step, step)
}

/** A domain with readable ends that holds every value. Equal ends widen so the scale is never flat. */
export function niceDomain(min: number, max: number, count = 4): [number, number] {
    let low = min
    let high = max
    if (low === high) {
        if (low === 0) return [0, 1]
        low = Math.min(0, low)
        high = Math.max(0, high)
    }
    const step = niceStep(high - low, count)
    return [snap(Math.floor(low / step) * step, step), snap(Math.ceil(high / step) * step, step)]
}

/** Readable tick values from `min` to `max`, both ends included when they fall on a step. */
export function ticks(min: number, max: number, count = 4): number[] {
    if (!(max > min)) return [min]
    const step = niceStep(max - min, count)
    const result: number[] = []
    for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-9; value += step) {
        result.push(snap(value, step))
    }
    return result
}

export function linearScale(
    [d0, d1]: readonly [number, number],
    [r0, r1]: readonly [number, number],
): (value: number) => number {
    const span = d1 - d0
    if (span === 0) return () => (r0 + r1) / 2
    return (value) => r0 + ((value - d0) / span) * (r1 - r0)
}

export function truncate(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text
    if (maxChars <= 1) return "…"
    return `${text.slice(0, maxChars - 1).trimEnd()}…`
}

/** Word wraps `text` to at most `maxLines` lines of `lineLength` characters; a cut last line ends with "…". */
export function wrapLabel(text: string, lineLength = 18, maxLines = 2): string[] {
    const lines: string[] = []
    let current = ""
    for (const word of text.trim().split(/\s+/)) {
        let rest = word
        while (rest.length > 0) {
            const joined = current ? `${current} ${rest}` : rest
            if (joined.length <= lineLength) {
                current = joined
                rest = ""
            } else if (current) {
                lines.push(current)
                current = ""
            } else {
                lines.push(rest.slice(0, lineLength))
                rest = rest.slice(lineLength)
            }
        }
    }
    if (current) lines.push(current)
    if (lines.length <= maxLines) return lines
    const kept = lines.slice(0, maxLines)
    kept[maxLines - 1] = truncate(`${kept[maxLines - 1]} ${lines[maxLines]}`, lineLength)
    return kept
}

export interface BandLayout {
    /** Width of one category group, gap included. */
    step: number
    /** Width of the bars area inside a group. */
    bandWidth: number
    /** Left edge of the bars area of group `index`. */
    bandStart: (index: number) => number
    /** Width of one bar. */
    barWidth: number
    /** Left edge of bar `seriesIndex` inside group `index`. */
    barStart: (index: number, seriesIndex: number) => number
}

/** Groups share the width; `groupGap` of each group is empty, `barGap` of each bar slot is empty. */
export function bandLayout(
    width: number,
    groupCount: number,
    seriesCount: number,
    groupGap = 0.2,
    barGap = 0.1,
): BandLayout {
    const step = width / Math.max(1, groupCount)
    const bandWidth = step * (1 - groupGap)
    const slot = bandWidth / Math.max(1, seriesCount)
    const barWidth = seriesCount > 1 ? slot * (1 - barGap) : slot
    const bandStart = (index: number) => index * step + (step - bandWidth) / 2
    return {
        step,
        bandWidth,
        bandStart,
        barWidth,
        barStart: (index, seriesIndex) =>
            bandStart(index) + seriesIndex * slot + (slot - barWidth) / 2,
    }
}

/** Every `step`-th x label is drawn so labels of `minChars` fit; returns the step and the chars that fit. */
export function xLabelStep(
    bandStep: number,
    longest: number,
    minChars = 6,
): {every: number; maxChars: number} {
    const wanted = Math.min(longest, minChars)
    let every = 1
    while (Math.floor((bandStep * every) / CHAR_WIDTH) - 1 < wanted && every < 64) every += 1
    return {every, maxChars: Math.max(1, Math.floor((bandStep * every) / CHAR_WIDTH) - 1)}
}

/**
 * Path of a bar between `valueY` and `baseline`, with the two corners at the value end rounded.
 * Works for bars above and below the baseline.
 */
export function barPath(x: number, width: number, valueY: number, baseline: number, radius = 4) {
    const up = valueY <= baseline
    const height = Math.abs(baseline - valueY)
    const r = Math.max(0, Math.min(radius, width / 2, height))
    const dir = up ? 1 : -1
    return [
        `M${x},${baseline}`,
        `V${valueY + dir * r}`,
        `Q${x},${valueY} ${x + r},${valueY}`,
        `H${x + width - r}`,
        `Q${x + width},${valueY} ${x + width},${valueY + dir * r}`,
        `V${baseline}`,
        "Z",
    ].join(" ")
}

/** Point on axis `index` of `count` at `fraction` (0..1) of `radius`. Axis 0 points up, then clockwise. */
export function radarPoint(
    cx: number,
    cy: number,
    radius: number,
    index: number,
    count: number,
    fraction: number,
): [number, number] {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count
    const r = radius * Math.min(1, Math.max(0, fraction))
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
}

/** Index of the axis nearest to the direction from the center to (`dx`, `dy`). */
export function nearestRadarAxis(dx: number, dy: number, count: number): number {
    const angle = Math.atan2(dy, dx) + Math.PI / 2
    const turn = (angle / (2 * Math.PI) + 1) % 1
    return Math.round(turn * count) % count
}

/** Splits a series into runs of consecutive non-null points; a null breaks the line. */
export function lineSegments(
    points: readonly (readonly [number, number | null])[],
): [number, number][][] {
    const segments: [number, number][][] = []
    let current: [number, number][] = []
    for (const [x, y] of points) {
        if (y === null || !Number.isFinite(y)) {
            if (current.length) segments.push(current)
            current = []
        } else {
            current.push([x, y])
        }
    }
    if (current.length) segments.push(current)
    return segments
}

export function polylinePath(points: readonly (readonly [number, number])[]): string {
    return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ")
}

/** Index of the value in sorted `xs` nearest to `x`. */
export function nearestIndex(xs: readonly number[], x: number): number {
    if (xs.length === 0) return -1
    let low = 0
    let high = xs.length - 1
    while (high - low > 1) {
        const mid = (low + high) >> 1
        if (xs[mid] <= x) low = mid
        else high = mid
    }
    return Math.abs(xs[high] - x) < Math.abs(xs[low] - x) ? high : low
}

/** Up to `count` indexes spread evenly over `length` items, first and last included. */
export function spreadIndexes(length: number, count: number): number[] {
    if (length <= 0) return []
    if (length === 1 || count <= 1) return [0]
    const n = Math.min(length, count)
    const result = new Set<number>()
    for (let i = 0; i < n; i += 1) result.add(Math.round((i * (length - 1)) / (n - 1)))
    return [...result]
}
