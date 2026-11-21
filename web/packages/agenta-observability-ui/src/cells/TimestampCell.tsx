import {memo} from "react"

import {activeLanguageAtom, formatDate} from "@agenta/i18n"
import {formattedTimestampAtomFamily} from "@agenta/observability"
import {useAtomValue} from "jotai"

/** Other languages: the same UTC time stamp, in their own words for the month. */
const LOCAL_FORMAT: Intl.DateTimeFormatOptions = {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
}

export const TimestampCell = memo(({timestamp}: {timestamp?: string | number | null}) => {
    const formatted = useAtomValue(formattedTimestampAtomFamily(timestamp))
    const language = useAtomValue(activeLanguageAtom)
    const date = language !== "en" && timestamp != null ? new Date(timestamp) : null
    // English keeps its exact format; an unparsable stamp keeps the shared formatter's output.
    const text = date && !Number.isNaN(date.getTime()) ? formatDate(date, LOCAL_FORMAT) : formatted
    return <div className="font-mono">{text}</div>
})

export default TimestampCell
