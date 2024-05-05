import dayjs from "dayjs"

export const formatDate = (date: dayjs.ConfigType): string => {
    return dayjs(date).format("DD MMM YYYY | h:m a")
}

export const formatDate24 = (date: dayjs.ConfigType, includeSeconds = false): string => {
    return dayjs(date).format("DD MMM YY, HH:mm" + (includeSeconds ? ":ss" : ""))
}
