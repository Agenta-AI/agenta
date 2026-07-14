/**
 * Active-window helpers for trigger schedules.
 *
 * A schedule's start_time/end_time are stored as UTC ISO strings. The antd
 * DatePicker edits in local mode, so these map a stored UTC instant onto the
 * same local clock face for display and back to UTC on write — the user always
 * picks the UTC wall-clock directly (a schedule's cron is UTC).
 */

import {dayjs} from "@agenta/shared/utils"

type Dayjs = ReturnType<typeof dayjs>

export function utcIsoToLocalFace(iso: string | null | undefined): Dayjs | null {
    if (!iso) return null
    const u = dayjs.utc(iso)
    return dayjs().year(u.year()).month(u.month()).date(u.date()).hour(u.hour()).minute(u.minute())
}

export function localFaceToUtcIso(d: Dayjs | null | undefined): string | null {
    if (!d) return null
    return dayjs
        .utc()
        .year(d.year())
        .month(d.month())
        .date(d.date())
        .hour(d.hour())
        .minute(d.minute())
        .second(0)
        .millisecond(0)
        .toISOString()
}
