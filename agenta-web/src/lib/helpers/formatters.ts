const intlNumber = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
})

const intlCurrency = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
})

export const formatNumber = (value = 0) => {
    return intlNumber.format(value)
}

export const formatCurrency = (value = 0) => {
    return intlCurrency.format(value)
}

export const formatLatency = (value = 0) => {
    return `${intlNumber.format(value / 1000)}s`
}
