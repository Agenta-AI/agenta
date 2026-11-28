// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {SearchInput} from "../../src/composed/controls/input-affix"
import {cn} from "../../src/foundation/utils/cn"
import {inputVariants} from "../../src/primitives/input"
import {Select, SelectTrigger, SelectValue} from "../../src/primitives/select"

/**
 * The canvas draws form fields at 34px, search fields at 30px and selects at the control height, all radius 6
 * and the field text style (14px). `compact` and `compact-search` are opt-in; the default sizes
 * do not change.
 */
afterEach(cleanup)

// The components pass the variant classes through `cn`, which drops the overridden base size.
const classesOf = (value: string) => cn(value).split(/\s+/)

describe("the compact Input", () => {
    it("is the canvas form field", () => {
        const classes = classesOf(inputVariants({size: "compact"}))
        expect(classes).toEqual(
            expect.arrayContaining(["h-control", "rounded-control", "text-field-md"]),
        )
        expect(classes).not.toContain("md:text-sm")
    })

    it("is the canvas search field at compact-search", () => {
        expect(classesOf(inputVariants({size: "compact-search"}))).toEqual(
            expect.arrayContaining(["h-control-sm", "rounded-control", "text-field-md"]),
        )
    })

    it("leaves the default size alone", () => {
        expect(classesOf(inputVariants({}))).toEqual(
            expect.arrayContaining(["h-control", "rounded-control", "text-field-md"]),
        )
    })

    it("gives the inner field of a search input the field text style", () => {
        render(<SearchInput size="compact-search" aria-label="Search" />)
        const input = screen.getByRole("textbox", {name: "Search"})
        expect(classesOf(input.className)).toContain("text-field-md")
        expect(classesOf(input.className)).not.toContain("md:text-sm")
    })
})

describe("the compact Select trigger", () => {
    it("is the control height, radius 6, the field text style, with the up-down icon", () => {
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
            expect.arrayContaining(["h-control", "rounded-control", "text-field-md"]),
        )
        expect(classes).not.toContain("text-base")
        const icon = trigger.querySelector("svg")
        expect(icon?.getAttribute("width")).toBe("14")
    })
})
