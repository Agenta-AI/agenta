// @vitest-environment jsdom
/**
 * The refused-send chip, docked above the composer, as both apps draw it.
 *
 * One component mounted inside the shared `ChatComposer`, so the desktop and the mobile app cannot
 * say different things about a message that was not sent. The copy a gateway refusal produces is
 * pinned in `sendRefusal.test.tsx`; what is pinned here is the strip itself: what it announces,
 * what each row offers, and that a row dismisses itself rather than its twin.
 */
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it, vi} from "vitest"

import {ComposerRejections} from "../../../src/components/ComposerRejections"

afterEach(cleanup)

describe("the refused-send chip", () => {
    it("names what was refused and why", () => {
        render(
            <ComposerRejections
                rejections={[{name: "Message", reason: "wasn't sent — No model provider."}]}
                onDismiss={() => undefined}
            />,
        )

        expect(screen.getByText("Message")).toBeTruthy()
        expect(screen.getByText("wasn't sent — No model provider.")).toBeTruthy()
    })

    it("announces itself after the reader's own work, not over it", () => {
        render(
            <ComposerRejections
                rejections={[{name: "Message", reason: "wasn't sent."}]}
                onDismiss={() => undefined}
            />,
        )

        // The composer is where the reader is typing, and an assertive live region would cut
        // across that on every refused attempt.
        expect(screen.getByRole("status")).toBeTruthy()
        expect(screen.queryByRole("alert")).toBeNull()
    })

    it("dismisses the row that was clicked, not the first one that looks like it", () => {
        // Two files can reject with the SAME name and the SAME reason, so a row reports its
        // position rather than its contents.
        const onDismiss = vi.fn()
        render(
            <ComposerRejections
                rejections={[
                    {name: "notes.pdf", reason: "is too large."},
                    {name: "notes.pdf", reason: "is too large."},
                ]}
                onDismiss={onDismiss}
            />,
        )

        const rows = screen.getAllByRole("button", {name: "Dismiss notes.pdf"})
        expect(rows).toHaveLength(2)
        rows[1].click()
        expect(onDismiss).toHaveBeenCalledWith(1)
    })

    it("gives every row its own dismiss, named for the row", () => {
        render(
            <ComposerRejections
                rejections={[
                    {name: "notes.pdf", reason: "is too large."},
                    {name: "Message", reason: "wasn't sent."},
                ]}
                onDismiss={() => undefined}
            />,
        )

        // One control per row, each named so a screen reader hears which row it closes.
        expect(screen.getByRole("button", {name: "Dismiss notes.pdf"})).toBeTruthy()
        expect(screen.getByRole("button", {name: "Dismiss Message"})).toBeTruthy()
    })
})
