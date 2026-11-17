import type {ScheduleText} from "@agenta/entities/gatewayTrigger"
import {createEnglishT, createT, formatDate, formatLocale} from "@agenta/i18n"
import scheduleTextCatalog from "@agenta/i18n/catalogs/entityUi.scheduleText"

const tNow = createT(scheduleTextCatalog)
const tEnglish = createEnglishT(scheduleTextCatalog)
type ScheduleT = typeof tNow

// 1970-01-04 was a Sunday, so day `d` (0 = Sunday, cron convention) is that date plus `d` days.
const weekday = (day: number, locale: string, width: "short" | "long") =>
    new Intl.DateTimeFormat(locale, {weekday: width, timeZone: "UTC"}).format(
        Date.UTC(1970, 0, 4 + day),
    )

// English keeps the wording it had before translation: "1st", "Mon 17 Aug" and "a, b and c"
// (no serial comma, which is what en-GB lists give).
const ENGLISH_ORDINAL_SUFFIX: Record<string, string> = {
    one: "st",
    two: "nd",
    few: "rd",
    other: "th",
}
const englishOrdinals = new Intl.PluralRules("en-US", {type: "ordinal"})
const englishDate = (date: Date) =>
    `${weekday(date.getUTCDay(), "en-US", "short")} ${date.getUTCDate()} ${new Intl.DateTimeFormat(
        "en-US",
        {month: "short", timeZone: "UTC"},
    ).format(date)}`

/** `locale` undefined means English. */
const buildScheduleText = (t: ScheduleT, locale: string | undefined): ScheduleText => {
    const intlLocale = locale ?? "en-US"
    const relative = new Intl.RelativeTimeFormat(intlLocale, {numeric: "always"})
    const list = new Intl.ListFormat(locale ?? "en-GB", {type: "conjunction"})
    return {
        everyHours: (hours, minute) => t("entityUi.scheduleText.everyHours", {hours, minute}),
        daily: t("entityUi.scheduleText.daily"),
        everyDay: t("entityUi.scheduleText.everyDay"),
        weekdays: t("entityUi.scheduleText.weekdays"),
        monthlyOn: (days) => t("entityUi.scheduleText.monthlyOn", {days}),
        ordinal: locale
            ? (day) => t("entityUi.scheduleText.dayOfMonth", {day})
            : (day) => `${day}${ENGLISH_ORDINAL_SUFFIX[englishOrdinals.select(day)]}`,
        dayShort: (day) => weekday(day, intlLocale, "short"),
        dayLong: (day) => weekday(day, intlLocale, "long"),
        join: (items) => list.format(items),
        atTimesUtc: (cadence, times) => t("entityUi.scheduleText.atTimesUtc", {cadence, times}),
        utc: (cadence) => t("entityUi.scheduleText.utc", {cadence}),
        nextRun: (date, time, relativeText) =>
            t("entityUi.scheduleText.nextRun", {
                date: locale
                    ? formatDate(date, {
                          weekday: "short",
                          day: "numeric",
                          month: "short",
                          timeZone: "UTC",
                      })
                    : englishDate(date),
                time,
                relative: relativeText,
            }),
        relative: (value, unit) => relative.format(value, unit),
        runsPerDay: (line, count) => t("entityUi.scheduleText.runsPerDay", {line, count}),
        cronEveryMinute: t("entityUi.scheduleText.cronEveryMinute"),
        cronEveryMinutes: (minutes) => t("entityUi.scheduleText.cronEveryMinutes", {minutes}),
        cronEveryHour: t("entityUi.scheduleText.cronEveryHour"),
        cronEveryHourAt: (minute) => t("entityUi.scheduleText.cronEveryHourAt", {minute}),
        cronEveryHoursAt: (hours, minute) =>
            t("entityUi.scheduleText.cronEveryHoursAt", {hours, minute}),
        cronEveryDayAt: (time) => t("entityUi.scheduleText.cronEveryDayAt", {time}),
        cronEveryWeekdayAt: (day, time) =>
            t("entityUi.scheduleText.cronEveryWeekdayAt", {day, time}),
        cronDaysAt: (days, time) => t("entityUi.scheduleText.cronDaysAt", {days, time}),
        cronRaw: (expression) => t("entityUi.scheduleText.cronRaw", {expression}),
    }
}

/** The schedule words in the active language, for display only. */
export const scheduleTextNow = (): ScheduleText => buildScheduleText(tNow, formatLocale())

/** The schedule words in English, for a name saved to the API. Never use it for display. */
export const englishScheduleText = (): ScheduleText => buildScheduleText(tEnglish, undefined)
