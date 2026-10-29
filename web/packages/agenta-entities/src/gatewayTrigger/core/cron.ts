/**
 * Cron helpers for trigger schedules.
 *
 * Schedules use a 5-field cron expression (minute hour day-of-month month
 * day-of-week), interpreted in UTC by the backend (validated server-side via
 * croniter). The web has no cron dependency, so this is a tiny, dependency-free
 * parser/validator used purely for client-side validation, a human-readable
 * description, and a "next runs" preview hint. The backend remains the source of
 * truth throughout.
 *
 * `validateCron` checks field shape only and blocks nothing the backend accepts.
 * `validateSchedule` adds the cadence floor, which mirrors a backend default that a
 * deployment can override — see MIN_CRON_INTERVAL_MINUTES for what that implies.
 */

const FIELD_BOUNDS: {min: number; max: number}[] = [
    {min: 0, max: 59}, // minute
    {min: 0, max: 23}, // hour
    {min: 1, max: 31}, // day of month
    {min: 1, max: 12}, // month
    {min: 0, max: 6}, // day of week (0 = Sunday)
]

const FIELD_NAMES = ["minute", "hour", "day-of-month", "month", "day-of-week"]

export interface CronValidationResult {
    valid: boolean
    error?: string
}

/** Split + sanity-check a 5-field cron expression. */
export function validateCron(expression: string): CronValidationResult {
    const trimmed = expression.trim()
    if (!trimmed) return {valid: false, error: "Cron expression is required"}

    const fields = trimmed.split(/\s+/)
    if (fields.length !== 5) {
        return {
            valid: false,
            error: `Expected 5 fields (minute hour day month weekday), got ${fields.length}`,
        }
    }

    for (let i = 0; i < fields.length; i++) {
        const fieldError = validateField(fields[i], FIELD_BOUNDS[i])
        if (fieldError) return {valid: false, error: `Invalid ${FIELD_NAMES[i]}: ${fieldError}`}
    }

    return {valid: true}
}

/** Validate one cron field supporting star, step, range, list, and plain values. */
function validateField(field: string, bounds: {min: number; max: number}): string | null {
    for (const part of field.split(",")) {
        const [range, stepRaw] = part.split("/")
        if (stepRaw !== undefined) {
            const step = Number(stepRaw)
            if (!Number.isInteger(step) || step <= 0) return `bad step "${stepRaw}"`
        }
        if (range === "*") continue
        if (range.includes("-")) {
            const [a, b] = range.split("-")
            const lo = Number(a)
            const hi = Number(b)
            if (!inBounds(lo, bounds) || !inBounds(hi, bounds) || lo > hi)
                return `bad range "${range}"`
            continue
        }
        const value = Number(range)
        if (!inBounds(value, bounds)) return `"${range}" out of ${bounds.min}-${bounds.max}`
    }
    return null
}

function inBounds(value: number, bounds: {min: number; max: number}): boolean {
    return Number.isInteger(value) && value >= bounds.min && value <= bounds.max
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

/**
 * A best-effort human-readable description of a cron expression. Handles the
 * common shapes (every minute/hour, daily at HH:MM, weekly on a weekday); falls
 * back to echoing the raw expression for anything more exotic.
 */
export function describeCron(expression: string): string {
    const {valid} = validateCron(expression)
    if (!valid) return expression

    const [minute, hour, dom, month, dow] = expression.trim().split(/\s+/)

    if (minute === "*" && hour === "*" && dom === "*" && month === "*" && dow === "*")
        return "Every minute (UTC)"

    const stepMatch = minute.match(/^\*\/(\d+)$/)
    if (stepMatch && hour === "*" && dom === "*" && month === "*" && dow === "*")
        return `Every ${stepMatch[1]} minutes (UTC)`

    if (minute === "0" && hour === "*" && dom === "*" && month === "*" && dow === "*")
        return "Every hour (UTC)"

    // "5 * * * *" fell through to the raw expression, which schedule lists show as a name.
    if (/^\d+$/.test(minute) && hour === "*" && dom === "*" && month === "*" && dow === "*")
        return `Every hour at :${pad(minute)} (UTC)`

    const hourStep = hour.match(/^\*\/(\d+)$/)
    if (/^\d+$/.test(minute) && hourStep && dom === "*" && month === "*" && dow === "*")
        return `Every ${hourStep[1]} hours at :${pad(minute)} (UTC)`

    const isTime = /^\d+$/.test(minute) && /^\d+$/.test(hour)
    if (isTime && dom === "*" && month === "*") {
        const time = `${pad(hour)}:${pad(minute)} UTC`
        if (dow === "*") return `Every day at ${time}`
        if (/^\d$/.test(dow)) return `Every ${DAY_NAMES[Number(dow)]} at ${time}`
        // "0 9 * * 1-5" / "0 9 * * 1,3" — a day set, not a single day.
        if (/^[\d,-]+$/.test(dow)) {
            const days = expandDayList(dow)
            if (days.length) return `${days.map((day) => DAY_NAMES[day]).join(", ")} at ${time}`
        }
    }

    return `${expression} (UTC)`
}

/** Expand a cron day-of-week list/range ("1-5", "1,3") into day indexes. */
function expandDayList(dow: string): number[] {
    const days = new Set<number>()
    for (const part of dow.split(",")) {
        const range = part.match(/^(\d)-(\d)$/)
        if (range) {
            for (let day = Number(range[1]); day <= Number(range[2]); day += 1) days.add(day % 7)
            continue
        }
        if (/^\d$/.test(part)) days.add(Number(part))
        else return []
    }
    return [...days].sort((a, b) => a - b)
}

function pad(value: string): string {
    return value.padStart(2, "0")
}

/**
 * Compute the next `count` UTC fire times for a 5-field cron expression by
 * minute-stepping forward (capped) and matching each field. Returns ISO
 * strings. Used only for the drawer's "next runs" preview.
 */
export function nextCronRuns(expression: string, count = 3, from: Date = new Date()): Date[] {
    if (!validateCron(expression).valid) return []

    const [minute, hour, dom, month, dow] = expression.trim().split(/\s+/)
    const runs: Date[] = []

    // Start at the next whole minute, in UTC.
    const cursor = new Date(from)
    cursor.setUTCSeconds(0, 0)
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)

    // POSIX cron treats day-of-month and day-of-week as a *union* when BOTH are
    // restricted: `0 0 1 * 1` fires on the 1st OR on Mondays (matching the
    // backend croniter), not only on Mondays that fall on the 1st. When either
    // field is `*` it is always-true, so the result collapses to a plain AND.
    const domRestricted = dom !== "*"
    const dowRestricted = dow !== "*"

    // Cap the scan at one year of minutes to avoid an unbounded loop.
    const MAX_STEPS = 366 * 24 * 60
    for (let step = 0; step < MAX_STEPS && runs.length < count; step++) {
        const domHit = matchField(cursor.getUTCDate(), dom, FIELD_BOUNDS[2])
        const dowHit = matchField(cursor.getUTCDay(), dow, FIELD_BOUNDS[4])
        const dayHit = domRestricted && dowRestricted ? domHit || dowHit : domHit && dowHit
        if (
            matchField(cursor.getUTCMinutes(), minute, FIELD_BOUNDS[0]) &&
            matchField(cursor.getUTCHours(), hour, FIELD_BOUNDS[1]) &&
            matchField(cursor.getUTCMonth() + 1, month, FIELD_BOUNDS[3]) &&
            dayHit
        ) {
            runs.push(new Date(cursor))
        }
        cursor.setUTCMinutes(cursor.getUTCMinutes() + 1)
    }

    return runs
}

const GAP_SAMPLE_COUNT = 64

/**
 * Smallest gap, in minutes, between two consecutive fires. Returns null when the
 * expression is invalid or fires at most once inside the sample, which means it is
 * far sparser than any floor we enforce.
 *
 * Sampling from the first fire rather than from "now" is what catches a
 * day-restricted expression like `0,1 0 31 1 *`, whose only fires sit a month out;
 * `nextCronRuns` already does that. 64 samples covers every realistic minute/hour
 * list: a dense expression reveals its gap in the first two fires, and a listy one
 * (`0,59 * * * *`, whose tight gap is the *second* gap) within a handful.
 */
export function smallestCronGapMinutes(expression: string): number | null {
    const runs = nextCronRuns(expression, GAP_SAMPLE_COUNT)
    if (runs.length < 2) return null

    let smallest = Infinity
    for (let i = 1; i < runs.length; i++) {
        smallest = Math.min(smallest, (runs[i].getTime() - runs[i - 1].getTime()) / 60_000)
    }
    return Number.isFinite(smallest) ? smallest : null
}

/**
 * The smallest cadence a schedule may run at. Mirrors the backend default
 * (`AGENTA_TRIGGERS_SCHEDULE_MIN_INTERVAL_MINUTES`, see `TriggersConfig` in
 * api/oss/src/utils/env.py), which stays the source of truth: this only spares the
 * user a round-trip for the common case. A deployment that *lowers* the backend
 * floor has to lower this too, or the drawer will refuse a value the API accepts.
 */
export const MIN_CRON_INTERVAL_MINUTES = 15

/** Render a gap for an error message: "1 minute", "5 minutes", "2 hours". */
function humanizeGap(minutes: number): string {
    if (minutes >= 60 && minutes % 60 === 0) {
        const hours = minutes / 60
        return `${hours} ${hours === 1 ? "hour" : "hours"}`
    }
    const rounded = Number.isInteger(minutes) ? minutes : Math.round(minutes * 10) / 10
    return `${rounded} ${rounded === 1 ? "minute" : "minutes"}`
}

/**
 * Full pre-submit check for a schedule's cron: field shape *and* cadence.
 *
 * Every fire starts an agent run in its own sandbox, so `* * * * *` bills 1440 runs
 * a day and overlaps itself whenever a run outlives a minute. Use this wherever a
 * user sets a schedule; `validateCron` alone only checks field bounds.
 */
export function validateSchedule(
    expression: string,
    floorMinutes: number = MIN_CRON_INTERVAL_MINUTES,
): CronValidationResult {
    const shape = validateCron(expression)
    if (!shape.valid) return shape

    const gap = smallestCronGapMinutes(expression)
    if (gap !== null && gap < floorMinutes) {
        return {
            valid: false,
            error: `A schedule may run at most once every ${floorMinutes} minutes. This one runs every ${humanizeGap(gap)}.`,
        }
    }
    return {valid: true}
}

/** Does `value` satisfy a single cron field (star, step, range, list, plain)? */
function matchField(value: number, field: string, bounds: {min: number; max: number}): boolean {
    for (const part of field.split(",")) {
        const [range, stepRaw] = part.split("/")
        const step = stepRaw !== undefined ? Number(stepRaw) : 1

        let lo = bounds.min
        let hi = bounds.max
        if (range !== "*") {
            if (range.includes("-")) {
                const [a, b] = range.split("-")
                lo = Number(a)
                hi = Number(b)
            } else {
                lo = Number(range)
                hi = Number(range)
            }
        }

        if (value < lo || value > hi) continue
        if ((value - lo) % step === 0) return true
    }
    return false
}
