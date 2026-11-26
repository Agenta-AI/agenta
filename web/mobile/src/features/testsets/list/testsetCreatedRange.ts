/** The quick ranges the Date Created filter offers, newest window first after "All time". */
export const CREATED_RANGES = [
    {value: "all", label: "All time"},
    {value: "24h", label: "Last 24 hours"},
    {value: "7d", label: "Last 7 days"},
    {value: "14d", label: "Last 14 days"},
    {value: "1m", label: "Last month"},
    {value: "3m", label: "Last 3 months"},
] as const

export type TestsetCreatedRange = (typeof CREATED_RANGES)[number]["value"]

/** The range the reader picked, with its lower bound fixed at the moment of the pick. */
export interface TestsetCreatedFilter {
    range: Exclude<TestsetCreatedRange, "all">
    createdAfter: string
}

export const createdRangeLabel = (range: TestsetCreatedRange): string =>
    CREATED_RANGES.find((item) => item.value === range)?.label ?? "All time"

/** Back by whole months, held at the last day of a shorter month: March 31 goes to February 28. */
const monthsBack = (date: Date, months: number) => {
    const day = date.getDate()
    date.setDate(1)
    date.setMonth(date.getMonth() - months)
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
    date.setDate(Math.min(day, lastDay))
}

/**
 * The filter for a picked range, or null for "All time". The bound is computed once, when the
 * reader picks, so the request (and its cache key) stays the same until they pick again.
 */
export const createdFilterFor = (
    range: TestsetCreatedRange,
    now: Date,
): TestsetCreatedFilter | null => {
    if (range === "all") return null
    const from = new Date(now.getTime())
    if (range === "24h") from.setHours(from.getHours() - 24)
    if (range === "7d") from.setDate(from.getDate() - 7)
    if (range === "14d") from.setDate(from.getDate() - 14)
    if (range === "1m") monthsBack(from, 1)
    if (range === "3m") monthsBack(from, 3)
    return {range, createdAfter: from.toISOString()}
}
