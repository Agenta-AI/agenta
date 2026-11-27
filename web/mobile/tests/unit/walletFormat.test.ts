import {describe, expect, it} from "vitest"

import {formatCreditsShort, MUSD_PER_CREDIT} from "@/features/wallet/walletFormat"

const credits = (n: number) => n * MUSD_PER_CREDIT

describe("formatCreditsShort", () => {
    it("shows whole credits below 10,000", () => {
        expect(formatCreditsShort(credits(500))).toBe("500")
        expect(formatCreditsShort(credits(9_999.9))).toBe("9,999")
    })

    it("goes compact from 10,000 so long balances fit one line", () => {
        expect(formatCreditsShort(credits(10_000))).toBe("10K")
        expect(formatCreditsShort(credits(12_345))).toBe("12.3K")
        expect(formatCreditsShort(credits(123_456_789.5))).toBe("123M")
        expect(formatCreditsShort(credits(987_654_321_000))).toBe("988B")
    })
})
