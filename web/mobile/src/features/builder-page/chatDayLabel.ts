import {formatDate} from "@agenta/i18n"

const startOfDay = (date: Date, daysBack = 0) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate() - daysBack).getTime()

/**
 * The day of a chat's last message as the builder sidebar shows it: "Today", "Yesterday", the
 * weekday in the last week ("Mon"), else the date. Empty for a chat with no time.
 */
export const chatDayLabel = (
    updatedAt: string | null | undefined,
    now: Date,
    words: {today: string; yesterday: string},
): string => {
    if (!updatedAt) return ""
    const at = new Date(updatedAt)
    const time = at.getTime()
    if (Number.isNaN(time)) return ""
    if (time >= startOfDay(now)) return words.today
    if (time >= startOfDay(now, 1)) return words.yesterday
    if (time >= startOfDay(now, 6)) return formatDate(at, {weekday: "short"})
    return formatDate(at, {month: "short", day: "numeric"})
}
