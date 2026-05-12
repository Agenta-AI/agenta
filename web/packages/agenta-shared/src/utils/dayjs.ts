/**
 * Dayjs with required plugins for date parsing.
 *
 * Uses customParseFormat for WebKit browser compatibility.
 */

import dayjs from "dayjs"
import customParseFormat from "dayjs/plugin/customParseFormat"
import relativeTime from "dayjs/plugin/relativeTime"
import utc from "dayjs/plugin/utc"

dayjs.extend(customParseFormat)
dayjs.extend(relativeTime)
dayjs.extend(utc)

export default dayjs
