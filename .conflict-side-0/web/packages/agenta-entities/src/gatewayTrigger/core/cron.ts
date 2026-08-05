/**
 * Cron helpers for trigger schedules.
 *
 * Schedules use a 5-field cron expression (minute hour day-of-month month
 * day-of-week), interpreted in UTC by the backend (validated server-side via
 * croniter). The web has no cron dependency, so this is a tiny, dependency-free
 * parser/validator used purely for client-side validation, a human-readable
 * description, and a "next runs" preview hint. The backend remains the source of
 * truth; this never blocks a value the backend would accept beyond field bounds.
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

    const isTime = /^\d+$/.test(minute) && /^\d+$/.test(hour)
    if (isTime && dom === "*" && month === "*") {
        const time = `${pad(hour)}:${pad(minute)} UTC`
        if (dow === "*") return `Every day at ${time}`
        if (/^\d$/.test(dow)) return `Every ${DAY_NAMES[Number(dow)]} at ${time}`
    }

    return `${expression} (UTC)`
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
