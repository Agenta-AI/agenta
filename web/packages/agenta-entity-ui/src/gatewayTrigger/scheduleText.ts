import {ENGLISH_SCHEDULE_TEXT, type ScheduleText} from "@agenta/entities/gatewayTrigger"
import {createT, formatDate, formatLocale} from "@agenta/i18n"
import scheduleTextCatalog from "@agenta/i18n/catalogs/entityUi.scheduleText"

const tNow = createT(scheduleTextCatalog)

// 1970-01-04 was a Sunday, so day `d` (0 = Sunday, cron convention) is that date plus `d` days.
const weekday = (day: number, locale: string, width: "short" | "long") =>
    new Intl.DateTimeFormat(locale, {weekday: width, timeZone: "UTC"}).format(
        Date.UTC(1970, 0, 4 + day),
    )

/**
 * The schedule words in the active language, for display only. English returns the entities
 * default unchanged. A name saved to the API keeps using {@link ENGLISH_SCHEDULE_TEXT}.
 */
export const scheduleTextNow = (): ScheduleText => {
    const locale = formatLocale()
    if (!locale) return ENGLISH_SCHEDULE_TEXT
    const relative = new Intl.RelativeTimeFormat(locale, {numeric: "always"})
    const list = new Intl.ListFormat(locale, {type: "conjunction"})
    return {
        everyHours: (hours, minute) => tNow("entityUi.scheduleText.everyHours", {hours, minute}),
        daily: tNow("entityUi.scheduleText.daily"),
        everyDay: tNow("entityUi.scheduleText.everyDay"),
        weekdays: tNow("entityUi.scheduleText.weekdays"),
        monthlyOn: (days) => tNow("entityUi.scheduleText.monthlyOn", {days}),
        ordinal: (day) => tNow("entityUi.scheduleText.dayOfMonth", {day}),
        dayShort: (day) => weekday(day, locale, "short"),
        dayLong: (day) => weekday(day, locale, "long"),
        join: (items) => list.format(items),
        atTimesUtc: (cadence, times) => tNow("entityUi.scheduleText.atTimesUtc", {cadence, times}),
        utc: (cadence) => tNow("entityUi.scheduleText.utc", {cadence}),
        nextRun: (date, time, relativeText) =>
            tNow("entityUi.scheduleText.nextRun", {
                date: formatDate(date, {
                    weekday: "short",
                    day: "numeric",
                    month: "short",
                    timeZone: "UTC",
                }),
                time,
                relative: relativeText,
            }),
        relative: (value, unit) => relative.format(value, unit),
        runsPerDay: (line, count) => tNow("entityUi.scheduleText.runsPerDay", {line, count}),
        cronEveryMinute: tNow("entityUi.scheduleText.cronEveryMinute"),
        cronEveryMinutes: (minutes) => tNow("entityUi.scheduleText.cronEveryMinutes", {minutes}),
        cronEveryHour: tNow("entityUi.scheduleText.cronEveryHour"),
        cronEveryHourAt: (minute) => tNow("entityUi.scheduleText.cronEveryHourAt", {minute}),
        cronEveryHoursAt: (hours, minute) =>
            tNow("entityUi.scheduleText.cronEveryHoursAt", {hours, minute}),
        cronEveryDayAt: (time) => tNow("entityUi.scheduleText.cronEveryDayAt", {time}),
        cronEveryWeekdayAt: (day, time) =>
            tNow("entityUi.scheduleText.cronEveryWeekdayAt", {day, time}),
        cronDaysAt: (days, time) => tNow("entityUi.scheduleText.cronDaysAt", {days, time}),
        cronRaw: (expression) => tNow("entityUi.scheduleText.cronRaw", {expression}),
    }
}
