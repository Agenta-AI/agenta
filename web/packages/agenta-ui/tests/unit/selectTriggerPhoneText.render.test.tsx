// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {Select, SelectTrigger, SelectValue} from "../../src/components/ui/select"

/**
 * Input is 16px below md so iOS Safari does not zoom the page on focus. The Select trigger kept
 * the 14px desktop ramp there, so one phone form mixed two sizes (a webhook's Name and URL at 16px,
 * its Event and Authentication at 14px). Below md it now matches the input; above, the size
 * variant's ramp is unchanged.
 */
afterEach(cleanup)

const trigger = (size?: "sm" | "default" | "lg") => {
    render(
        <Select>
            <SelectTrigger size={size} aria-label="Event">
                <SelectValue placeholder="Pick one" />
            </SelectTrigger>
        </Select>,
    )
    return screen.getByRole("combobox", {name: "Event"})
}

describe("the Select trigger's text size", () => {
    it.each(["sm", "default", "lg"] as const)("is 16px below md at size %s, like Input", (size) => {
        expect(trigger(size).className.split(/\s+/)).toContain("max-md:text-base")
    })

    it("keeps the desktop ramp above md", () => {
        const classes = trigger().className.split(/\s+/)
        expect(classes).toContain("text-field-md")
        expect(classes).not.toContain("text-base")
    })
})
