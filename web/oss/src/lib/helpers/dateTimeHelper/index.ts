import dayjs from "./dayjs"

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
    return dayjs(date, inputFormat).format(outputFormat)
}
