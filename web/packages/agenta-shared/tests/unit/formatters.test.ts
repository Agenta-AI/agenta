import {describe, expect, it} from "vitest"

import {
    formatCompact,
    formatCurrency,
    formatCurrencyPrecise,
    formatLatency,
    formatNumber,
    formatPercent,
    formatTokens,
} from "../../src/utils/formatters/formatters"

// ---------------------------------------------------------------------------
// formatNumber
// ---------------------------------------------------------------------------

describe("formatNumber", () => {
    it("formats with locale thousand separators and 2 decimal places", () => {
        expect(formatNumber(1234.567)).toBe("1,234.57")
    })

    it("returns '-' for null", () => expect(formatNumber(null)).toBe("-"))
    it("returns '-' for undefined", () => expect(formatNumber(undefined)).toBe("-"))

    it("formats zero", () => expect(formatNumber(0)).toBe("0"))
    it("formats negative numbers", () => expect(formatNumber(-1234)).toBe("-1,234"))
})

// ---------------------------------------------------------------------------
// formatCompact
// ---------------------------------------------------------------------------

describe("formatCompact", () => {
    it("formats thousands as K", () => expect(formatCompact(1500)).toBe("1.5K"))
    it("formats millions as M", () => expect(formatCompact(1_500_000)).toBe("1.5M"))
    it("returns '-' for null", () => expect(formatCompact(null)).toBe("-"))
})

// ---------------------------------------------------------------------------
// formatCurrency
// ---------------------------------------------------------------------------

describe("formatCurrency", () => {
    it("formats with dollar sign and 2 decimals for typical values", () => {
        expect(formatCurrency(1234.56)).toBe("$1,234.56")
    })

    it("formats small values without trailing zeros", () => {
        expect(formatCurrency(0.00123)).toBe("$0.00123")
    })

    it("keeps two digits past the leading zeros below a dollar", () => {
        expect(formatCurrency(0.150026)).toBe("$0.15")
        expect(formatCurrency(0.0123456)).toBe("$0.0123")
        expect(formatCurrency(0.0000012)).toBe("$0.000001")
        expect(formatCurrency(0)).toBe("$0.00")
    })

    it("returns '-' for null", () => expect(formatCurrency(null)).toBe("-"))
})

describe("formatCurrencyPrecise", () => {
    it("keeps up to six decimals at every size", () => {
        expect(formatCurrencyPrecise(1.234567)).toBe("$1.234567")
        expect(formatCurrencyPrecise(0.150026)).toBe("$0.150026")
        expect(formatCurrencyPrecise(1234.5)).toBe("$1,234.50")
    })

    it("returns '-' for null", () => expect(formatCurrencyPrecise(null)).toBe("-"))
})

// ---------------------------------------------------------------------------
// formatLatency
// ---------------------------------------------------------------------------

describe("formatLatency", () => {
    it("formats sub-millisecond values in μs", () => {
        expect(formatLatency(0.0001)).toBe("100 μs")
    })

    it("formats millisecond-range values in ms", () => {
        expect(formatLatency(0.5)).toBe("500 ms")
    })

    it("formats second-range values in s", () => {
        expect(formatLatency(2.5)).toBe("2.5 s")
        expect(formatLatency(731.08)).toBe("731.08 s")
    })

    it("formats exactly 1 second", () => {
        expect(formatLatency(1)).toBe("1 s")
    })

    it("formats exactly 1 millisecond as 1 ms, not 1000 μs", () => {
        expect(formatLatency(0.001)).toBe("1 ms")
    })

    it("moves to the next unit when rounding reaches 1000", () => {
        expect(formatLatency(0.0009996)).toBe("1 ms")
        expect(formatLatency(0.9996)).toBe("1 s")
    })

    it("returns '-' for null", () => expect(formatLatency(null)).toBe("-"))
    it("returns '-' for undefined", () => expect(formatLatency(undefined)).toBe("-"))
})

// ---------------------------------------------------------------------------
// formatTokens
// ---------------------------------------------------------------------------

describe("formatTokens", () => {
    it("formats values under 1000 as plain integers", () => {
        expect(formatTokens(500)).toBe("500")
    })

    it("formats thousands as K with 1 decimal", () => {
        expect(formatTokens(1500)).toBe("1.5K")
    })

    it("formats millions as M with 1 decimal", () => {
        expect(formatTokens(1_500_000)).toBe("1.5M")
    })

    it("returns '-' for null", () => expect(formatTokens(null)).toBe("-"))
})

// ---------------------------------------------------------------------------
// formatPercent
// ---------------------------------------------------------------------------

describe("formatPercent", () => {
    it("formats decimal as percentage with 1 decimal for values >= 10%", () => {
        expect(formatPercent(0.856)).toBe("85.6%")
    })

    it("formats small values with 2 decimal places", () => {
        expect(formatPercent(0.001)).toBe("0.10%")
    })

    it("returns '100%' for values >= 99.95%", () => {
        expect(formatPercent(1)).toBe("100%")
        expect(formatPercent(0.9995)).toBe("100%")
    })

    it("returns '0%' for zero", () => {
        expect(formatPercent(0)).toBe("0%")
    })

    it("treats negative values as 0%", () => {
        expect(formatPercent(-0.1)).toBe("0%")
    })

    it("returns '-' for null", () => expect(formatPercent(null)).toBe("-"))
})
