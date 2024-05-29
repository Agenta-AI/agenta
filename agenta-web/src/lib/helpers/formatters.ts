const intlNumber = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
})

const intlCurrency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 6,
})

export const formatNumber = (value = 0) => {
    return intlNumber.format(value)
}

export const formatCurrency = (value = 0) => {
    if (value === null) {
        return "-"
    } else {
        return intlCurrency.format(value)
    }
}

export const formatLatency = (value = 0) => {
    return `${Math.round(value * 1000)}ms`
}

export const formatTokenUsage = (value = 0) => {
    if (value === null) {
        return "-"
    } else {
        return value
    }
}
