// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogFooter,
    AlertDialogTitle,
} from "../../src/components/ui/alert-dialog"
import {Button} from "../../src/components/ui/button"
import {UnsavedChangesDialog} from "../../src/view-stack/UnsavedChangesDialog"

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
    it("a confirmation dialog gives a plain Button and its own action the compact size", () => {
        render(
            <InDialog>
                <Button variant="outline">Cancel</Button>
                <AlertDialogAction>Delete</AlertDialogAction>
            </InDialog>,
        )
        expect(byName("Cancel").dataset.size).toBe("compact")
        expect(byName("Delete").className).toContain("h-control-sm")
    })

    it("an icon-only Button in the dialog takes the compact icon size", () => {
        render(
            <InDialog>
                <Button aria-label="More">
                    <svg />
                </Button>
            </InDialog>,
        )
        expect(byName("More").dataset.size).toBe("icon-compact")
    })

    it("an explicit size beats the dialog's default", () => {
        render(
            <InDialog>
                <Button size="lg">Big</Button>
            </InDialog>,
        )
        expect(byName("Big").dataset.size).toBe("lg")
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
                    className="text-colorText"
                >
                    <svg />
                </Button>
            </>,
        )
        expect(byName("Keep").className.split(" ")).toContain("text-colorTextSecondary")
        expect(byName("Pick").className.split(" ")).not.toContain("text-colorTextSecondary")
    })

    it("Keep editing in the unsaved changes dialog is a compact secondary ghost", () => {
        render(<UnsavedChangesDialog open description="Save?" canSave onAnswer={() => undefined} />)
        const keep = byName("Keep editing")
        expect(keep.dataset.size).toBe("compact")
        expect(keep.className.split(" ")).toContain("text-colorTextSecondary")
    })
})
