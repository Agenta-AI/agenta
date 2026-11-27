// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogFooter,
    AlertDialogTitle,
} from "../../src/primitives/alert-dialog"
import {Button} from "../../src/primitives/button"

/**
 * How a Button picks its size on the canvas scale (design decision D1): a surface can give its
 * buttons a default size, and the caller's own choices still win. The look itself is checked
 * against the design with browser captures, not here.
 */
afterEach(cleanup)

const byName = (name: string) => screen.getByRole("button", {name})

const InDialog = ({children}: {children: React.ReactNode}) => (
    <AlertDialog open>
        <AlertDialogContent>
            <AlertDialogTitle>Delete this automation?</AlertDialogTitle>
            <AlertDialogFooter>{children}</AlertDialogFooter>
        </AlertDialogContent>
    </AlertDialog>
)

describe("Button size on the canvas scale", () => {
    it("an alert's buttons keep the app scale", () => {
        render(
            <InDialog>
                <Button variant="outline">Cancel</Button>
                <AlertDialogAction>Delete</AlertDialogAction>
            </InDialog>,
        )
        expect(byName("Cancel").dataset.size).toBe("default")
        expect(byName("Delete").className).toContain("h-control")
        expect(byName("Delete").className).not.toContain("h-control-sm")
    })

    it("outside a dialog a Button keeps the app scale", () => {
        render(<Button>Open</Button>)
        expect(byName("Open").dataset.size).toBe("default")
    })

    it("a ghost control on the canvas scale is secondary, and a caller's color still wins", () => {
        render(
            <>
                <Button variant="ghost" size="compact">
                    Keep
                </Button>
                <Button
                    variant="ghost"
                    size="icon-compact"
                    aria-label="Pick"
                    className="text-foreground"
                >
                    <svg />
                </Button>
            </>,
        )
        expect(byName("Keep").className.split(" ")).toContain("text-muted-foreground")
        expect(byName("Pick").className.split(" ")).not.toContain("text-muted-foreground")
    })

    it("a ghost Keep editing in an alert footer keeps the app scale", () => {
        render(
            <InDialog>
                <Button variant="ghost">Keep editing</Button>
            </InDialog>,
        )
        expect(byName("Keep editing").dataset.size).toBe("default")
    })
})
