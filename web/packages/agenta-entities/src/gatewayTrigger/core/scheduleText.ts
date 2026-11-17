/**
 * The words a schedule is described with. The schedule helpers take one of these, so a UI can
 * pass the active language's words; {@link ENGLISH_SCHEDULE_TEXT} is the default, and it is also
 * what a name saved to the API is built from.
 */
export interface ScheduleText {
    /** "Every 3h at :00" (hourly cadence chip and summary). */
    everyHours: (hours: number, minute: string) => string
    daily: string
    everyDay: string
    weekdays: string
    /** "Monthly on the 1st and 15th"; `days` is the joined ordinal list. */
    monthlyOn: (days: string) => string
    ordinal: (day: number) => string
    /** "Mon"; 0 = Sunday. */
    dayShort: (day: number) => string
    /** "Monday"; 0 = Sunday. */
    dayLong: (day: number) => string
    /** "a, b and c". */
    join: (items: string[]) => string
    /** "Weekdays at 09:00 UTC". */
    atTimesUtc: (cadence: string, times: string) => string
    /** "Every 3h at :00 UTC". */
    utc: (cadence: string) => string
    /** "Next run Mon 17 Aug, 09:00 UTC · in 2 days". */
    nextRun: (date: Date, time: string, relative: string) => string
    /** "in 2 days". */
    relative: (value: number, unit: "minute" | "hour" | "day") => string
    /** Appends "· 8 runs a day" to the next-run line. */
    runsPerDay: (line: string, count: number) => string
    cronEveryMinute: string
    cronEveryMinutes: (minutes: string) => string
    cronEveryHour: string
    cronEveryHourAt: (minute: string) => string
    cronEveryHoursAt: (hours: string, minute: string) => string
    /** `time` is "09:00 UTC". */
    cronEveryDayAt: (time: string) => string
    cronEveryWeekdayAt: (day: string, time: string) => string
    cronDaysAt: (days: string, time: string) => string
    cronRaw: (expression: string) => string
}

const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

const ordinal = (n: number): string => {
    const suffixes = ["th", "st", "nd", "rd"]
    const v = n % 100
    return `${n}${suffixes[(v - 20) % 10] ?? suffixes[v] ?? suffixes[0]}`
}

const joinAnd = (items: string[]): string => {
    if (items.length <= 1) return items[0] ?? ""
    if (items.length === 2) return `${items[0]} and ${items[1]}`
    return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

export const ENGLISH_SCHEDULE_TEXT: ScheduleText = {
    everyHours: (hours, minute) => `Every ${hours}h at :${minute}`,
    daily: "Daily",
    everyDay: "Every day",
    weekdays: "Weekdays",
    monthlyOn: (days) => `Monthly on the ${days}`,
    ordinal,
    dayShort: (day) => DAY_ABBR[day] ?? "",
    dayLong: (day) => DAY_NAMES[day] ?? "",
    join: joinAnd,
    atTimesUtc: (cadence, times) => `${cadence} at ${times} UTC`,
    utc: (cadence) => `${cadence} UTC`,
    nextRun: (date, time, relative) =>
        `Next run ${DAY_ABBR[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH_ABBR[date.getUTCMonth()]}, ${time} UTC · ${relative}`,
    relative: (value, unit) => `in ${plural(value, unit)}`,
    runsPerDay: (line, count) => `${line} · ${plural(count, "run")} a day`,
    cronEveryMinute: "Every minute (UTC)",
    cronEveryMinutes: (minutes) => `Every ${minutes} minutes (UTC)`,
    cronEveryHour: "Every hour (UTC)",
    cronEveryHourAt: (minute) => `Every hour at :${minute} (UTC)`,
    cronEveryHoursAt: (hours, minute) => `Every ${hours} hours at :${minute} (UTC)`,
    cronEveryDayAt: (time) => `Every day at ${time}`,
    cronEveryWeekdayAt: (day, time) => `Every ${day} at ${time}`,
    cronDaysAt: (days, time) => `${days} at ${time}`,
    cronRaw: (expression) => `${expression} (UTC)`,
}
