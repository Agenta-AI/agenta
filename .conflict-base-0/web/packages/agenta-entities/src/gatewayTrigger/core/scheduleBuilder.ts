/**
 * Friendly schedule builder <-> cron bridge.
 *
 * The cron string (`data.schedule`) stays the source of truth; this module is a
 * lossless editor model over the subset of cron a non-technical user needs:
 * hourly / daily / weekly / monthly cadences with one or more run times. Cron is
 * far more expressive, so the mapping is asymmetric:
 *
 *   - builderToCron: always deterministic.
 *   - cronToBuilder: only when the expression fits the builder's vocabulary;
 *     anything beyond it (steps, ranges, L/#, month restrictions, mixed
 *     dom+dow) is reported `representable: false` and the UI falls back to a raw
 *     "Custom" cron field.
 *
 * Everything here is UTC, matching the backend (croniter). Timezone-aware
 * schedules are a separate concern that needs a backend tz field.
 */

import {describeCron, validateCron} from "./cron"

export type CronCadence = "hourly" | "daily" | "weekly" | "monthly" | "custom"

export interface CronTimeOfDay {
    hour: number // 0-23
    minute: number // 0-59
}

/**
 * Flat builder state (one object the form can edit directly). Only the fields
 * relevant to `cadence` are read when generating cron; the rest hold their last
 * value so switching cadence back and forth doesn't lose the user's input.
 */
export interface ScheduleBuilderState {
    cadence: CronCadence
    everyNHours: number // hourly: 1-23 (1 = every hour)
    times: CronTimeOfDay[] // daily / weekly / monthly run times
    weekdays: number[] // weekly: 0-6 (0 = Sunday, cron convention)
    daysOfMonth: number[] // monthly: 1-31
    cron: string // custom: raw expression
}

export const DEFAULT_TIME: CronTimeOfDay = {hour: 9, minute: 0}

export function defaultBuilderState(cadence: CronCadence): ScheduleBuilderState {
    return {
        cadence,
        everyNHours: 1,
        times: [{...DEFAULT_TIME}],
        weekdays: [1], // Monday
        daysOfMonth: [1],
        cron: "0 9 * * *",
    }
}

// ---------------------------------------------------------------------------
// builder -> cron
// ---------------------------------------------------------------------------

export function builderToCron(state: ScheduleBuilderState): string {
    switch (state.cadence) {
        case "custom":
            return state.cron.trim()
        case "hourly": {
            const n = clampInt(state.everyNHours, 1, 23)
            const minute = state.times[0]?.minute ?? 0
            return `${minute} ${n <= 1 ? "*" : `*/${n}`} * * *`
        }
        case "daily":
            return `${minuteField(state.times)} ${hourField(state.times)} * * *`
        case "weekly":
            return `${minuteField(state.times)} ${hourField(state.times)} * * ${listField(state.weekdays, 0)}`
        case "monthly":
            return `${minuteField(state.times)} ${hourField(state.times)} ${listField(state.daysOfMonth, 1)} * *`
    }
}

// ---------------------------------------------------------------------------
// cron -> builder (representability check)
// ---------------------------------------------------------------------------

export function cronToBuilder(cron: string): {
    state: ScheduleBuilderState
    representable: boolean
} {
    const custom = (): {state: ScheduleBuilderState; representable: boolean} => ({
        state: {...defaultBuilderState("custom"), cron: cron.trim()},
        representable: false,
    })

    if (!validateCron(cron).valid) return custom()

    const [minute, hour, dom, month, dow] = cron.trim().split(/\s+/)
    // We don't expose a month picker, so any month restriction is "too advanced".
    if (month !== "*") return custom()

    const minutes = plainIntList(minute)

    // Hourly: hour is "*" or "*/n", a single run minute, no day restriction.
    if (dom === "*" && dow === "*" && minutes?.length === 1) {
        const step = hour === "*" ? 1 : stepOfStar(hour)
        if (step !== null) {
            return {
                state: {
                    ...defaultBuilderState("hourly"),
                    everyNHours: step,
                    times: [{hour: 0, minute: minutes[0]}],
                },
                representable: true,
            }
        }
    }

    const hours = plainIntList(hour)
    if (!minutes || !hours) return custom()
    const times = gridTimes(hours, minutes)

    // Daily: no day-of-week or day-of-month restriction.
    if (dom === "*" && dow === "*") {
        return {state: {...defaultBuilderState("daily"), times}, representable: true}
    }
    // Weekly: day-of-week list, no day-of-month.
    if (dom === "*" && dow !== "*") {
        const weekdays = plainIntList(dow)
        if (!weekdays) return custom()
        return {state: {...defaultBuilderState("weekly"), weekdays, times}, representable: true}
    }
    // Monthly: day-of-month list, no day-of-week. (Both set = cron OR semantics,
    // which the builder can't represent.)
    if (dom !== "*" && dow === "*") {
        const daysOfMonth = plainIntList(dom)
        if (!daysOfMonth) return custom()
        return {state: {...defaultBuilderState("monthly"), daysOfMonth, times}, representable: true}
    }
    return custom()
}

/**
 * Do these run times form a clean minute x hour grid? Cron's minute and hour
 * fields are independent, so a times list is only faithfully representable when
 * it's the full cross-product of its distinct minutes and hours. The builder UI
 * uses this to warn before a new chip would silently add cross-product runs.
 */
export function timesFormCleanGrid(times: CronTimeOfDay[]): boolean {
    const hours = sortedUnique(times.map((t) => t.hour))
    const minutes = sortedUnique(times.map((t) => t.minute))
    const distinct = new Set(times.map((t) => `${t.hour}:${t.minute}`))
    return distinct.size === hours.length * minutes.length
}

// ---------------------------------------------------------------------------
// description (the friendly "next runs" summary line)
// ---------------------------------------------------------------------------

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

export function describeBuilder(state: ScheduleBuilderState): string {
    switch (state.cadence) {
        case "custom":
            return describeCron(state.cron)
        case "hourly": {
            const n = clampInt(state.everyNHours, 1, 23)
            const m = state.times[0]?.minute ?? 0
            const at = m === 0 ? "" : ` at :${pad2(m)}`
            return `${n <= 1 ? "Every hour" : `Every ${n} hours`}${at} (UTC)`
        }
        case "daily":
            return `Every day at ${timesPhrase(state.times)} (UTC)`
        case "weekly":
            return `${daysPhrase(state.weekdays)} at ${timesPhrase(state.times)} (UTC)`
        case "monthly":
            return `Monthly on ${ordinalList(state.daysOfMonth)} at ${timesPhrase(state.times)} (UTC)`
    }
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function sortedUnique(nums: number[]): number[] {
    return Array.from(new Set(nums)).sort((a, b) => a - b)
}

function sortedTimes(times: CronTimeOfDay[]): CronTimeOfDay[] {
    return [...times].sort((a, b) => a.hour - b.hour || a.minute - b.minute)
}

function minuteField(times: CronTimeOfDay[]): string {
    const ms = sortedUnique(times.map((t) => t.minute))
    return ms.length ? ms.join(",") : "0"
}

function hourField(times: CronTimeOfDay[]): string {
    const hs = sortedUnique(times.map((t) => t.hour))
    return hs.length ? hs.join(",") : "0"
}

function listField(nums: number[], fallback: number): string {
    const xs = sortedUnique(nums)
    return xs.length ? xs.join(",") : String(fallback)
}

/** Sorted unique ints, or null if the field uses any star / range / step syntax. */
function plainIntList(field: string): number[] | null {
    const out: number[] = []
    for (const part of field.split(",")) {
        if (!/^\d+$/.test(part)) return null
        out.push(Number(part))
    }
    return sortedUnique(out)
}

function stepOfStar(field: string): number | null {
    const m = field.match(/^\*\/(\d+)$/)
    if (!m) return null
    const n = Number(m[1])
    return n > 0 ? n : null
}

function gridTimes(hours: number[], minutes: number[]): CronTimeOfDay[] {
    const out: CronTimeOfDay[] = []
    for (const hour of sortedUnique(hours)) {
        for (const minute of sortedUnique(minutes)) out.push({hour, minute})
    }
    return out
}

function clampInt(n: number, lo: number, hi: number): number {
    if (!Number.isFinite(n)) return lo
    return Math.min(hi, Math.max(lo, Math.round(n)))
}

function pad2(n: number): string {
    return String(n).padStart(2, "0")
}

function timesPhrase(times: CronTimeOfDay[]): string {
    return joinAnd(sortedTimes(times).map((t) => `${pad2(t.hour)}:${pad2(t.minute)}`))
}

function daysPhrase(days: number[]): string {
    const ds = sortedUnique(days)
    if (ds.length === 7) return "Every day"
    if (ds.length === 5 && [1, 2, 3, 4, 5].every((d) => ds.includes(d))) return "Every weekday"
    return joinAnd(ds.map((d) => DAY_ABBR[d]))
}

function ordinalList(days: number[]): string {
    return `the ${joinAnd(sortedUnique(days).map(ordinal))}`
}

function ordinal(n: number): string {
    const suffixes = ["th", "st", "nd", "rd"]
    const v = n % 100
    return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`
}

function joinAnd(items: string[]): string {
    if (items.length <= 1) return items[0] ?? ""
    if (items.length === 2) return `${items[0]} and ${items[1]}`
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}
