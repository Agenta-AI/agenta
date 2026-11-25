// @vitest-environment jsdom
import * as React from "react"

import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {CopyButton} from "../../src/components/presentational/CopyButton"

/**
 * `buttonText={null}` renders an icon-only button. A `??` default once turned `null` back into
 * "Copy", so the label overflowed the icon-sized button in the trace drawer.
 */

afterEach(cleanup)

describe("CopyButton label", () => {
    it("shows the default label when buttonText is omitted", () => {
        render(<CopyButton text="hello" />)
        expect(screen.getByRole("button").textContent).toBe("Copy")
    })

    it("renders icon only when buttonText is null", () => {
        render(<CopyButton text="hello" icon buttonText={null} size="icon-sm" />)
        const button = screen.getByRole("button", {name: "Copy"})
        expect(button.textContent).toBe("")
        expect(button.querySelector("svg")).not.toBeNull()
    })

    it("shows a custom label", () => {
        render(<CopyButton text="hello" buttonText="Copy code" />)
        expect(screen.getByRole("button").textContent).toBe("Copy code")
    })
})
