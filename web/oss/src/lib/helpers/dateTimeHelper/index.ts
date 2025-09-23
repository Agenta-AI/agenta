import dayjs from "./dayjs"

const FALLBACK_FORMATS = [
    "YYYY-MM-DD H:mm:ssAZ",
    "YYYY-MM-DD H:mm:sssAZ",
    "YYYY-MM-DD HH:mm:ss.SSSZ",
    "YYYY-MM-DD HH:mm:ss.SSS",
    "YYYY-MM-DD HH:mm:ssZ",
    "YYYY-MM-DD HH:mm:ss",
    "YYYY-MM-DDTHH:mm:ss.SSSSSS",
    "YYYY-MM-DDTHH:mm:ss.SSSZ",
    "YYYY-MM-DDTHH:mm:ssZ",
    "YYYY-MM-DDTHH:mm:ss",
]

export const formatDate = (date: dayjs.ConfigType): string => {
    return dayjs(date).format("DD MMM YYYY | h:mm a")
}

export const formatDate24 = (date: dayjs.ConfigType, includeSeconds = false): string => {
    return dayjs(date).format("DD MMM YY, HH:mm" + (includeSeconds ? ":ss" : ""))
}

export const parseDate = ({date, inputFormat = "YYYY-MM-DD H:mm:sssAZ"}) => {
    return dayjs(date, inputFormat)
}

export const formatDay = ({
    date,
    inputFormat = "YYYY-MM-DD H:mm:ssAZ",
    outputFormat = "DD MMM YYYY",
}: {
    date: dayjs.ConfigType
    inputFormat?: string
    outputFormat?: string
}): string => {
    const formatsToTry = inputFormat
        ? [inputFormat, ...FALLBACK_FORMATS.filter((format) => format !== inputFormat)]
        : FALLBACK_FORMATS

    for (const format of formatsToTry) {
        const parsed = dayjs(date, format)
        if (parsed.isValid()) {
            return parsed.format(outputFormat)
        }
    }

    const direct = dayjs(date)
    return direct.isValid() ? direct.format(outputFormat) : ""
}
