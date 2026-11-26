// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {inputVariants} from "../../src/components/ui/input"
import {cn} from "../../src/components/ui/utils"
import {SearchInput} from "../../src/components/ui/input-composed"
import {Select, SelectTrigger, SelectValue} from "../../src/components/ui/select"

/**
 * The canvas draws form fields at 34px, search fields at 30px and selects at 34px, all radius 6
 * and 13px text. `compact` and `compact-search` are opt-in; the default sizes
 * do not change.
 */
afterEach(cleanup)

// The components pass the variant classes through `cn`, which drops the overridden base size.
const classesOf = (value: string) => cn(value).split(/\s+/)

describe("the compact Input", () => {
    it("is the canvas form field", () => {
        const classes = classesOf(inputVariants({size: "compact"}))
        expect(classes).toEqual(
            expect.arrayContaining(["h-[34px]", "rounded-[6px]", "md:text-[13px]", "text-base"]),
        )
        expect(classes).not.toContain("md:text-sm")
    })

    it("is the canvas search field at compact-search", () => {
        expect(classesOf(inputVariants({size: "compact-search"}))).toEqual(
            expect.arrayContaining(["h-[30px]", "rounded-[6px]", "md:text-[13px]"]),
        )
    })

    it("leaves the default size alone", () => {
        expect(classesOf(inputVariants({}))).toEqual(
            expect.arrayContaining(["h-8", "rounded-lg", "md:text-sm"]),
        )
    })

    it("gives the inner field of a search input the 13px text", () => {
        render(<SearchInput size="compact-search" aria-label="Search" />)
        const input = screen.getByRole("textbox", {name: "Search"})
        expect(classesOf(input.className)).toContain("md:text-[13px]")
        expect(classesOf(input.className)).not.toContain("md:text-sm")
    })
})

describe("the compact Select trigger", () => {
    it("is 34px, radius 6, 13px, 14px on a phone, with the up-down icon", () => {
        render(
            <Select>
                <SelectTrigger size="compact" aria-label="Account">
                    <SelectValue placeholder="Pick one" />
                </SelectTrigger>
            </Select>,
        )
        const trigger = screen.getByRole("combobox", {name: "Account"})
        const classes = classesOf(trigger.className)
        expect(classes).toEqual(
            expect.arrayContaining(["h-[34px]", "rounded-[6px]", "text-[13px]", "max-md:text-sm"]),
        )
        expect(classes).not.toContain("max-md:text-base")
        const icon = trigger.querySelector("svg")
        expect(icon?.getAttribute("width")).toBe("14")
    })
})
