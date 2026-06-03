import {describe, expect, it} from "vitest"

import {
    createFormatter,
    formatCompact,
    formatCurrency,
    formatLatency,
    formatNumber,
    formatPercent,
    formatPreviewValue,
    formatSignificant,
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

    it("formats small values without trailing zeros (maximumFractionDigits: 6)", () => {
        expect(formatCurrency(0.00123)).toBe("$0.00123")
    })

    it("returns '-' for null", () => expect(formatCurrency(null)).toBe("-"))
})

// ---------------------------------------------------------------------------
// formatLatency
// ---------------------------------------------------------------------------

describe("formatLatency", () => {
    it("formats sub-millisecond values in μs", () => {
        expect(formatLatency(0.0001)).toBe("100μs")
    })

    it("formats millisecond-range values in ms", () => {
        expect(formatLatency(0.5)).toBe("500ms")
    })

    it("formats second-range values in s", () => {
        expect(formatLatency(2.5)).toBe("2.5s")
    })

    it("formats exactly 1 second", () => {
        expect(formatLatency(1)).toBe("1s")
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

// ---------------------------------------------------------------------------
// formatSignificant
// ---------------------------------------------------------------------------

describe("formatSignificant", () => {
    it("formats values with significant-figure-aware decimals", () => {
        // 1234: exponent=3 → decimals=max(0, 2-3)=0 → "1234" (integer, no rounding)
        expect(formatSignificant(1234)).toBe("1234")
        // 0.00456: exponent=-3 → decimals=max(0, 2-(-3))=5 → "0.00456"
        expect(formatSignificant(0.00456)).toBe("0.00456")
    })

    it("returns '0' for zero", () => {
        expect(formatSignificant(0)).toBe("0")
    })

    it("uses scientific notation for extreme values", () => {
        const result = formatSignificant(1.5e12)
        expect(result).toMatch(/e/)
    })

    it("returns '-' for null", () => expect(formatSignificant(null)).toBe("-"))
})

// ---------------------------------------------------------------------------
// formatPreviewValue
// ---------------------------------------------------------------------------

describe("formatPreviewValue", () => {
    it("wraps strings in quotes", () => {
        expect(formatPreviewValue("hello")).toBe('"hello"')
    })

    it("truncates long strings and adds ellipsis", () => {
        const long = "a".repeat(60)
        const result = formatPreviewValue(long, 50)
        expect(result).toBe(`"${"a".repeat(50)}..."`)
    })

    it("formats numbers as-is", () => {
        expect(formatPreviewValue(123)).toBe("123")
    })

    it("formats booleans as-is", () => {
        expect(formatPreviewValue(true)).toBe("true")
        expect(formatPreviewValue(false)).toBe("false")
    })

    it("formats arrays with length", () => {
        expect(formatPreviewValue([1, 2, 3])).toBe("[Array(3)]")
    })

    it("formats small objects with key names", () => {
        expect(formatPreviewValue({a: 1, b: 2})).toBe("{a, b}")
    })

    it("truncates objects with more than 3 keys", () => {
        const result = formatPreviewValue({a: 1, b: 2, c: 3, d: 4})
        expect(result).toBe("{a, b, c...}")
    })

    it("returns '(null)' for null", () => expect(formatPreviewValue(null)).toBe("(null)"))
    it("returns '(undefined)' for undefined", () =>
        expect(formatPreviewValue(undefined)).toBe("(undefined)"))
})

// ---------------------------------------------------------------------------
// createFormatter
// ---------------------------------------------------------------------------

describe("createFormatter", () => {
    it("applies multiplier, prefix, suffix, and fixed decimals", () => {
        const fmt = createFormatter({multiplier: 100, suffix: "%", decimals: 1})
        expect(fmt(0.856)).toBe("85.6%")
    })

    it("uses the custom fallback for null/undefined", () => {
        const fmt = createFormatter({fallback: "n/a"})
        expect(fmt(null)).toBe("n/a")
        expect(fmt(undefined)).toBe("n/a")
    })

    it("uses compact notation when compact: true", () => {
        const fmt = createFormatter({compact: true})
        expect(fmt(1500)).toBe("1.5K")
    })

    it("prepends a prefix", () => {
        const fmt = createFormatter({prefix: "$", decimals: 2})
        expect(fmt(10)).toBe("$10.00")
    })
})
