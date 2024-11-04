const intlNumber = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
})

const intlCurrency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
})

const handleNullOrUndefined = <T, R extends string>(
    value: T | undefined | null,
    callback: (v: T) => R,
    defaultValue: R = "-" as R,
): R => {
    if (value == null || (typeof value === "number" && isNaN(value))) {
        return defaultValue
    } else {
        return callback(value)
    }
}

export const formatNumber = (value: number | undefined | null) => {
    return handleNullOrUndefined(value, intlNumber.format)
}

export const formatCurrency = (value: number | undefined | null) => {
    return handleNullOrUndefined(value, intlCurrency.format)
}

export const formatLatency = (value: number | undefined | null) => {
    return handleNullOrUndefined(value, (v) => {
        const MS_LIMIT = 1000
        const S_LIMIT = MS_LIMIT * 1000
        const S_TO_US = S_LIMIT
        const DECIMAL_DIGITS = 100 // 2 decimal places

        let value = v * S_TO_US
        let unit = "us"

        if (MS_LIMIT < value && value < S_LIMIT) {
            value = Math.round(value / MS_LIMIT)
            unit = "ms"
        } else if (S_LIMIT < value) {
            value = Math.round((value / S_LIMIT) * DECIMAL_DIGITS) / DECIMAL_DIGITS
            unit = "s"
        } else {
            value = Math.round(value)
            unit = "us"
        }

        return `${value}${unit}`
    })
}

export const formatTokenUsage = (value: number | undefined | null) => {
    return handleNullOrUndefined(value, (v) => v.toString())
}
