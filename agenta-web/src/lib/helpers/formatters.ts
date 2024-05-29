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
    return handleNullOrUndefined(value, (v) => `${Math.round(v * 1000)}ms`)
}

export const formatTokenUsage = (value: number | undefined | null) => {
    return handleNullOrUndefined(value, (v) => v.toString())
}
