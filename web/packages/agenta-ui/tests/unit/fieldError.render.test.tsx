// @vitest-environment jsdom
//
// A field that refuses an entry has to say so to more than the eye.
//
// The MCP connect dialog's duplicate-name refusal was reported unchanged in three QA rounds:
// the message renders, and the control carries neither `aria-invalid` nor `aria-describedby`,
// so a screen-reader user meets a Continue button that silently stops working with no announced
// reason (round 4, D4). Every Field with an error had the same gap, so it is closed in Field.
import {renderToStaticMarkup} from "react-dom/server"
import {describe, expect, it} from "vitest"

import {Field} from "../../src/components/ui/field"

/** The rendered field, as a DOM tree so ids can be followed the way a reader follows them. */
const render = (element: React.ReactElement): HTMLElement => {
    const host = document.createElement("div")
    host.innerHTML = renderToStaticMarkup(element)
    return host
}

const control = (host: HTMLElement) => host.querySelector("input")!

/**
 * What the control's `aria-describedby` actually points at, in order.
 *
 * Followed by id rather than asserted as a string: an `aria-describedby` naming an element that
 * is not on the page announces nothing, and that failure looks identical to a correct attribute.
 * `useId` puts characters in an id that a CSS selector cannot carry, so the lookup is by id.
 */
const describedText = (host: HTMLElement): string[] => {
    const byId = new Map(
        [...host.querySelectorAll("[id]")].map((node) => [node.id, node.textContent ?? ""]),
    )
    return (control(host).getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => byId.get(id) ?? `<missing: ${id}>`)
}

describe("Field announces why it refused an entry", () => {
    it("marks the control invalid and points it at the message", () => {
        const host = render(
            <Field label="Name" error="Another connection in this project already uses this name.">
                <input />
            </Field>,
        )

        expect(control(host).getAttribute("aria-invalid")).toBe("true")
        expect(describedText(host)).toEqual([
            "Another connection in this project already uses this name.",
        ])
    })

    it("says nothing about validity while there is nothing wrong", () => {
        const host = render(
            <Field label="Name">
                <input />
            </Field>,
        )

        expect(control(host).getAttribute("aria-invalid")).toBeNull()
        expect(control(host).getAttribute("aria-describedby")).toBeNull()
    })

    it("announces a description even with no error beside it", () => {
        const host = render(
            <Field label="Name" description="Agents reference this connection by its own slug.">
                <input />
            </Field>,
        )

        expect(describedText(host)).toEqual(["Agents reference this connection by its own slug."])
        expect(control(host).getAttribute("aria-invalid")).toBeNull()
    })

    it("reads the description and then the error when both are there", () => {
        const host = render(
            <Field label="Name" description="How this connection is labelled." error="Name taken.">
                <input />
            </Field>,
        )

        expect(describedText(host)).toEqual(["How this connection is labelled.", "Name taken."])
    })

    it("marks a field invalid with no message at all", () => {
        // `invalid` exists for "this is missing" states, where a text error would be noise. The
        // control still has to report itself as invalid.
        const host = render(
            <Field label="Name" invalid>
                <input />
            </Field>,
        )

        expect(control(host).getAttribute("aria-invalid")).toBe("true")
    })

    it("keeps a description the control already named for itself", () => {
        const host = render(
            <>
                <span id="own-hint">Written by the caller.</span>
                <Field label="Name" error="Name taken.">
                    <input aria-describedby="own-hint" />
                </Field>
            </>,
        )

        expect(describedText(host)).toEqual(["Written by the caller.", "Name taken."])
    })

    it("keeps pointing at the message when the caller supplied the control's id", () => {
        // `htmlFor` skips the id injection, and the association has to survive that path too.
        const host = render(
            <Field label="Name" htmlFor="chosen-id" error="Name taken.">
                <input id="chosen-id" />
            </Field>,
        )

        expect(control(host).getAttribute("aria-invalid")).toBe("true")
        expect(describedText(host)).toEqual(["Name taken."])
    })
})
