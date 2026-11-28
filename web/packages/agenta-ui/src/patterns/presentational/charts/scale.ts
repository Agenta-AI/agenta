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

/** A finite number, or null for a missing, NaN or infinite value. Charts draw null as "no value". */
export function finiteOrNull(value: number | null | undefined): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null
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
    // Below float precision the power rounds to 0: one step spans the whole range.
    if (!(power > 0)) return range
    const fraction = raw / power
    const nice =
        fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10
    return nice * power
}

/** Rounds `value` to the precision of `step`, to drop float noise such as 0.30000000000000004. */
function snap(value: number, step: number): number {
    const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 2)
    // toFixed accepts at most 100 digits; finer values have no float noise worth removing.
    if (decimals > 100) return value
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
    if (!(max > min) || !Number.isFinite(max - min)) return [min]
    const step = niceStep(max - min, count)
    const first = Math.ceil(min / step) * step
    const steps = Math.floor((max - first) / step + 1e-9)
    // At extreme magnitudes a step can be below float precision: fall back to the two ends.
    if (!(steps >= 0 && steps <= count * 4)) return [min, max]
    const values = Array.from({length: steps + 1}, (_, i) => snap(first + i * step, step))
    return [...new Set(values)]
}

/** Width of the y axis: room for the longest tick label and a small gap. */
export function yAxisWidth(tickValues: readonly number[], format: (value: number) => string) {
    return Math.max(...tickValues.map((tick) => format(tick).length)) * CHAR_WIDTH + 10
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

/**
 * Word wraps `text` to at most `maxLines` lines of `lineLength` characters. A cut line, or a word
 * longer than a line, ends with "…".
 */
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
                // A word longer than a line is cut, not split over two lines.
                current = truncate(rest, lineLength)
                rest = ""
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
    groupWidth: number
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
    const groupWidth = width / Math.max(1, groupCount)
    const bandWidth = groupWidth * (1 - groupGap)
    const slot = bandWidth / Math.max(1, seriesCount)
    const barWidth = seriesCount > 1 ? slot * (1 - barGap) : slot
    const bandStart = (index: number) => index * groupWidth + (groupWidth - bandWidth) / 2
    return {
        groupWidth,
        bandWidth,
        bandStart,
        barWidth,
        barStart: (index, seriesIndex) =>
            bandStart(index) + seriesIndex * slot + (slot - barWidth) / 2,
    }
}

/**
 * Draw every `every`-th x label so that labels of up to `minChars` characters fit between their
 * neighbours; `maxChars` is how many characters fit then.
 */
export function xLabelEvery(
    groupWidth: number,
    longest: number,
    minChars = 6,
): {every: number; maxChars: number} {
    if (!(groupWidth > 0)) return {every: 1, maxChars: 1}
    const wanted = Math.min(longest, minChars)
    // One character of the slot stays empty, so labels never touch.
    const every = Math.max(1, Math.ceil(((wanted + 1) * CHAR_WIDTH) / groupWidth))
    return {every, maxChars: Math.max(1, Math.floor((groupWidth * every) / CHAR_WIDTH) - 1)}
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

/** Unit direction [cos, sin] of axis `index` of `count`. Axis 0 points up, then clockwise. */
export function radarDirection(index: number, count: number): [number, number] {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count
    return [Math.cos(angle), Math.sin(angle)]
}

/** Point on axis `index` of `count` at `fraction` (0..1) of `radius`. */
export function radarPoint(
    cx: number,
    cy: number,
    radius: number,
    index: number,
    count: number,
    fraction: number,
): [number, number] {
    const [cos, sin] = radarDirection(index, count)
    const r = radius * Math.min(1, Math.max(0, fraction))
    return [cx + r * cos, cy + r * sin]
}

/** Axes this close to vertical or horizontal get centered labels. */
const RADAR_CENTER_ZONE = 0.2

export interface RadarLabelAlign {
    anchor: "start" | "middle" | "end"
    vertical: "above" | "center" | "below"
}

/** Where the label of an axis sits relative to the end of the axis. */
export function radarLabelAlign(index: number, count: number): RadarLabelAlign {
    const [cos, sin] = radarDirection(index, count)
    return {
        anchor: cos > RADAR_CENTER_ZONE ? "start" : cos < -RADAR_CENTER_ZONE ? "end" : "middle",
        vertical: sin < -RADAR_CENTER_ZONE ? "above" : sin > RADAR_CENTER_ZONE ? "below" : "center",
    }
}

/**
 * The largest radius at which every axis label, `gap` px past the end of its axis, still fits
 * inside `width` x `height`. Label sizes are in px; the result can be 0 or less when nothing fits.
 */
export function radarRadius(
    width: number,
    height: number,
    labels: readonly {width: number; height: number}[],
    gap: number,
): number {
    let radius = Math.min(width, height) / 2 - gap
    labels.forEach((label, index) => {
        const [cos, sin] = radarDirection(index, labels.length).map(Math.abs)
        const {anchor, vertical} = radarLabelAlign(index, labels.length)
        const roomX = width / 2 - (anchor === "middle" ? label.width / 2 : label.width)
        const roomY = height / 2 - (vertical === "center" ? label.height / 2 : label.height)
        if (cos > 1e-6) radius = Math.min(radius, roomX / cos - gap)
        else if (roomX < 0) radius = 0
        if (sin > 1e-6) radius = Math.min(radius, roomY / sin - gap)
        else if (roomY < 0) radius = 0
    })
    return radius
}

/** Shorter label lines to try, in order, when the radar labels leave too little room. */
const RADAR_LINE_LENGTHS = [18, 14, 10, 7]

/**
 * Wraps the axis names into labels and picks the radius that fits them. Labels wrap at 18
 * characters; while that leaves the radar smaller than `targetRadius`, they wrap shorter. When no
 * length reaches the target, the length with the largest radius wins, so labels never leave the
 * chart. The radius is never below 0.
 */
export function fitRadarLabels(
    width: number,
    height: number,
    names: readonly string[],
    {gap, lineHeight, targetRadius}: {gap: number; lineHeight: number; targetRadius: number},
): {labels: string[][]; radius: number} {
    let best: {labels: string[][]; radius: number} = {labels: [], radius: -Infinity}
    for (const lineLength of RADAR_LINE_LENGTHS) {
        const labels = names.map((name) => wrapLabel(name, lineLength))
        const radius = radarRadius(
            width,
            height,
            labels.map((lines) => ({
                width: Math.max(...lines.map((line) => line.length)) * CHAR_WIDTH,
                // One more line of room: the block starts half a line past the gap.
                height: (lines.length + 1) * lineHeight,
            })),
            gap,
        )
        if (radius >= targetRadius) return {labels, radius}
        if (radius > best.radius) best = {labels, radius}
    }
    return {labels: best.labels, radius: Math.max(0, best.radius)}
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

/** At most `maxCount` indexes of `length` items, an equal number of items apart, starting at 0. */
export function tickIndexes(length: number, maxCount: number): number[] {
    if (length <= 0) return []
    const step = Math.max(1, Math.ceil((length - 1) / Math.max(1, maxCount - 1)))
    return Array.from({length: Math.floor((length - 1) / step) + 1}, (_, i) => i * step)
}
