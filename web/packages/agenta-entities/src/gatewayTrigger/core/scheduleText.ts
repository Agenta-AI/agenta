/**
 * The words a schedule is described with. The schedule helpers take one of these; the UI layer
 * builds it from the translation catalog, in the active language for display or in English for a
 * name saved to the API.
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
