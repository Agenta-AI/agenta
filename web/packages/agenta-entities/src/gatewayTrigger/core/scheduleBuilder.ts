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

import {describeCron, nextCronRuns, validateCron} from "./cron"

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
// description — the cadence phrase, the collapsed summary, and the next run
// ---------------------------------------------------------------------------

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTH_ABBR = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
]

/**
 * The cadence on its own, with no run times — "Weekdays", "Every 3h at :00",
 * "Monthly on the 1st". Drives the cadence chips and feeds {@link summarizeSchedule}.
 */
export function describeCadence(state: ScheduleBuilderState): string {
    switch (state.cadence) {
        case "custom":
            return state.cron.trim() || describeCron(state.cron)
        case "hourly": {
            const n = clampInt(state.everyNHours, 1, 23)
            return `Every ${n}h at :${pad2(state.times[0]?.minute ?? 0)}`
        }
        case "daily":
            return "Daily"
        case "weekly":
            return daysPhrase(state.weekdays)
        case "monthly":
            return `Monthly on ${ordinalList(state.daysOfMonth)}`
    }
}

/**
 * The collapsed schedule row — "Weekdays at 09:00 UTC". Hourly already carries its
 * minute in the cadence phrase, and a raw expression speaks for itself, so neither
 * repeats the times.
 */
export function summarizeSchedule(state: ScheduleBuilderState): string {
    const cadence = describeCadence(state)
    if (state.cadence === "custom") return cadence
    if (state.cadence === "hourly") return `${cadence} UTC`
    return `${cadence} at ${timesPhrase(state.times)} UTC`
}

/**
 * "Next run Mon 17 Aug, 09:00 UTC · in 2 days" — the hint under the schedule row.
 * Hourly appends its daily run count, which is the number people actually check.
 * Empty when the expression has no computable next run, so the caller can fall back.
 */
export function formatNextRun(
    cron: string,
    state?: ScheduleBuilderState,
    from: Date = new Date(),
): string {
    const next = nextCronRuns(cron, 1, from)[0]
    if (!next) return ""

    const when = `${DAY_ABBR[next.getUTCDay()]} ${next.getUTCDate()} ${MONTH_ABBR[next.getUTCMonth()]}`
    const time = `${pad2(next.getUTCHours())}:${pad2(next.getUTCMinutes())}`
    let line = `Next run ${when}, ${time} UTC · ${relativeFrom(next, from)}`

    if (state?.cadence === "hourly") {
        const perDay = Math.ceil(24 / clampInt(state.everyNHours, 1, 23))
        line += ` · ${plural(perDay, "run")} a day`
    }
    return line
}

/**
 * The Name placeholder — "Weekdays 09:00 — daily-update". A cadence that carries its
 * own time (hourly) or is a raw expression (custom) skips the time segment.
 */
export function suggestScheduleName(
    state: ScheduleBuilderState,
    agentName?: string | null,
): string {
    const carriesOwnTime = state.cadence === "hourly" || state.cadence === "custom"
    const cadence = describeCadence(state)
    const withTime = carriesOwnTime ? cadence : `${cadence} ${timesPhrase(state.times)}`
    const agent = agentName?.trim()
    return agent ? `${withTime} — ${agent}` : withTime
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
    return joinCapped(sortedTimes(times).map((t) => `${pad2(t.hour)}:${pad2(t.minute)}`))
}

function daysPhrase(days: number[]): string {
    const ds = sortedUnique(days)
    if (ds.length === 7) return "Every day"
    if (ds.length === 5 && [1, 2, 3, 4, 5].every((d) => ds.includes(d))) return "Weekdays"
    return joinCapped(ds.map((d) => DAY_ABBR[d]))
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`
}

/** "in 40 minutes" / "in 3 hours" / "in 2 days", coarsening as the gap grows. */
function relativeFrom(target: Date, from: Date): string {
    const minutes = Math.max(1, Math.round((target.getTime() - from.getTime()) / 60_000))
    if (minutes < 60) return `in ${plural(minutes, "minute")}`
    if (minutes < 1440) return `in ${plural(Math.round(minutes / 60), "hour")}`
    return `in ${plural(Math.round(minutes / 1440), "day")}`
}

function ordinalList(days: number[]): string {
    return `the ${joinCapped(sortedUnique(days).map(ordinal))}`
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

/**
 * Join a short list in prose, but keep the result bounded: a monthly schedule can select 31 days,
 * and spelling every one out grows the collapsed summary until it truncates mid-word. Past
 * {@link LIST_CAP} entries the tail becomes a count.
 */
const LIST_CAP = 3

function joinCapped(items: string[]): string {
    if (items.length <= LIST_CAP) return joinAnd(items)
    return `${items.slice(0, LIST_CAP).join(", ")} +${items.length - LIST_CAP}`
}
