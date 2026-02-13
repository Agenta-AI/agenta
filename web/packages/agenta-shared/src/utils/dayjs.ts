/**
 * Dayjs with required plugins for date parsing.
 *
 * Uses customParseFormat for WebKit browser compatibility.
 */

import dayjs from "dayjs"
import customParseFormat from "dayjs/plugin/customParseFormat"
import utc from "dayjs/plugin/utc"

dayjs.extend(customParseFormat)
dayjs.extend(utc)

export default dayjs
