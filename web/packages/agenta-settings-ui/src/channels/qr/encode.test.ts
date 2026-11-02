import {describe, expect, it} from "vitest"

import {encodeQr, type QrMatrix} from "./encode"

/**
 * Read the 7x7 finder pattern whose top-left module is at (left, top).
 * A finder is dark everywhere except the ring at Chebyshev distance 2 from its centre.
 */
const finderIsCorrect = (matrix: QrMatrix, left: number, top: number): boolean => {
    for (let dy = 0; dy < 7; dy++) {
        for (let dx = 0; dx < 7; dx++) {
            const distance = Math.max(Math.abs(dx - 3), Math.abs(dy - 3))
            const expected = distance !== 2
            if (matrix.modules[top + dy][left + dx] !== expected) return false
        }
    }
    return true
}

describe("encodeQr", () => {
    it("picks version 1 for a short byte-mode string at ECC M", () => {
        const matrix = encodeQr("HELLO WORLD", "M")
        expect(matrix.size).toBe(21)
        expect(matrix.modules).toHaveLength(21)
        expect(matrix.modules[0]).toHaveLength(21)
    })

    it("draws a finder pattern in the three corners", () => {
        const matrix = encodeQr("HELLO WORLD", "M")
        expect(finderIsCorrect(matrix, 0, 0)).toBe(true)
        expect(finderIsCorrect(matrix, matrix.size - 7, 0)).toBe(true)
        expect(finderIsCorrect(matrix, 0, matrix.size - 7)).toBe(true)
        // The fourth corner holds data, not a finder.
        expect(finderIsCorrect(matrix, matrix.size - 7, matrix.size - 7)).toBe(false)
    })

    it("keeps the timing patterns and the always-dark module", () => {
        const matrix = encodeQr("https://t.me/newagentabot?start=abc123", "M")
        for (let i = 8; i < matrix.size - 8; i++) {
            expect(matrix.modules[6][i]).toBe(i % 2 === 0)
            expect(matrix.modules[i][6]).toBe(i % 2 === 0)
        }
        expect(matrix.modules[matrix.size - 8][8]).toBe(true)
    })

    it("is deterministic", () => {
        const first = encodeQr("https://t.me/newagentabot?start=AbCd1234", "M")
        const second = encodeQr("https://t.me/newagentabot?start=AbCd1234", "M")
        expect(second.size).toBe(first.size)
        expect(second.modules).toEqual(first.modules)
    })

    it("fits a 120-character URL and returns a size of 4 * version + 17", () => {
        const url = `https://t.me/newagentabot?start=${"a".repeat(120 - 32)}`
        expect(url).toHaveLength(120)
        const matrix = encodeQr(url, "M")
        const version = (matrix.size - 17) / 4
        expect(Number.isInteger(version)).toBe(true)
        expect(version).toBeGreaterThanOrEqual(1)
        expect(version).toBeLessThanOrEqual(40)
        expect(matrix.size).toBe(4 * version + 17)
    })

    it("uses a larger symbol for a higher ECC level", () => {
        const url = "https://t.me/newagentabot?start=AbCd1234EfGh5678"
        expect(encodeQr(url, "H").size).toBeGreaterThan(encodeQr(url, "L").size)
    })

    it("throws when the text is too long for version 40", () => {
        expect(() => encodeQr("a".repeat(3000), "L")).toThrow(/do not fit/)
    })
})
