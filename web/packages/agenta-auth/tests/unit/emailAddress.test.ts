/**
 * `isValidEmailAddress` replaced `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, which CodeQL flagged as a
 * polynomial ReDoS (js/polynomial-redos): the domain parts overlap, so an address made of many
 * `!.` groups made the engine retry every split point. These tests pin both halves of the claim —
 * the accepted set is unchanged, and the new check is linear.
 */
import {describe, expect, it} from "vitest"

import {isValidEmailAddress} from "../../src/emailAddress"

/** The pattern the check replaced. */
const LEGACY_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const CASES = [
    // Accepted.
    "a@b.c",
    "user@example.com",
    "user.name+tag@sub.example.co.uk",
    "USER@EXAMPLE.COM",
    "a@..b",
    "a@b.c.d",
    "!#$%&'*+-/=?^_`{|}~@example.com",
    // Rejected.
    "",
    " ",
    "plainaddress",
    "@example.com",
    "user@",
    "user@example",
    "user@.com",
    "user@com.",
    "user@@example.com",
    "a@b@c.d",
    "user name@example.com",
    "user@exa mple.com",
    "user@example.com ",
    " user@example.com",
    "user@example.com\nx@y.z",
    "user\t@example.com",
    ".@.",
    "a@.",
    // The shape CodeQL named, at a length the old pattern still handles quickly.
    `!@!.${"!.".repeat(6)}`,
    `!@!.${"!.".repeat(6)}z`,
    `!@!.${"!.".repeat(6)}@`,
    `!@!.${"!.".repeat(6)} `,
]

describe("isValidEmailAddress", () => {
    it("accepts exactly what the pattern it replaced accepted", () => {
        for (const value of CASES) {
            expect({value, valid: isValidEmailAddress(value)}).toEqual({
                value,
                valid: LEGACY_EMAIL_RE.test(value),
            })
        }
    })

    it("stays linear on the input the old pattern backtracked on", () => {
        // The exact witness CodeQL reported: `!@!.` then many `!.` repetitions. The trailing `@`
        // is what makes the address invalid, so the old pattern had to retry every `.` in it —
        // measured quadratic: 4ms at 2000 repetitions, 16ms at 4000.
        const pathological = `!@!.${"!.".repeat(20_000)}@`
        expect(pathological.length).toBeGreaterThan(40_000)

        const started = performance.now()
        const result = isValidEmailAddress(pathological)
        const elapsed = performance.now() - started

        expect(result).toBe(false)
        expect(elapsed).toBeLessThan(100)
    })
})
