// @vitest-environment jsdom
import {cleanup, render, screen} from "@testing-library/react"
import {afterEach, describe, expect, it} from "vitest"

import {BuilderIcon} from "../../src/agent-icon"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "../../src/components/ui/alert-dialog"
import {Button} from "../../src/components/ui/button"
import {UnsavedChangesDialog} from "../../src/view-stack/UnsavedChangesDialog"

/**
 * The canvas scale (design decision D1) the builder layout surfaces share: a 28px control with
 * radius 6, 13px text and a 16px glyph, and on a phone a 44px icon button with a 20px glyph.
 */
afterEach(cleanup)

const button = () => screen.getByRole("button")

describe("Button canvas sizes", () => {
    it("compact is a 28px control, radius 6, 13px text, 16px glyph", () => {
        render(<Button size="compact">Save</Button>)
        const cls = button().className
        for (const c of ["h-control-sm", "rounded-[6px]", "text-btn-sm", "size-btn-icon"]) {
            expect(cls).toContain(c)
        }
        expect(button().dataset.size).toBe("compact")
    })

    it("icon-compact is 28 on desktop and the 44px phone button with a 20px glyph", () => {
        render(
            <Button size="icon-compact" aria-label="Builder">
                <BuilderIcon />
            </Button>,
        )
        const cls = button().className
        for (const c of [
            "size-control-sm",
            "rounded-[6px]",
            "max-md:size-11",
            "max-md:rounded-[8px]",
            "max-md:[&_svg:not([class*='size-'])]:size-5",
        ]) {
            expect(cls).toContain(c)
        }
    })

    it("a ghost control on the canvas scale is secondary text, and compact ghost pads 8px", () => {
        render(
            <Button variant="ghost" size="compact">
                Keep editing
            </Button>,
        )
        const cls = button().className.split(" ")
        expect(cls).toContain("text-colorTextSecondary")
        expect(cls).not.toContain("text-foreground")
        expect(cls).toContain("px-2")
        expect(cls).not.toContain("px-btn-sm")
    })

    it("a ghost button on the app scale keeps the foreground text", () => {
        render(<Button variant="ghost">Open</Button>)
        expect(button().className.split(" ")).toContain("text-foreground")
    })

    it("a caller's className still wins over the canvas ghost color", () => {
        render(
            <Button variant="ghost" size="icon-compact" aria-label="x" className="text-colorText">
                <BuilderIcon />
            </Button>,
        )
        const cls = button().className.split(" ")
        expect(cls).toContain("text-colorText")
        expect(cls).not.toContain("text-colorTextSecondary")
    })

    it("destructive paints the palette's error pair", () => {
        render(<Button variant="destructive">Remove</Button>)
        const cls = button().className.split(" ")
        expect(cls).toContain("bg-colorErrorBg")
        expect(cls).toContain("text-error")
    })
})

describe("BuilderIcon", () => {
    it("draws the one four-point sparkle at 16px by default", () => {
        const {container} = render(<BuilderIcon />)
        const svg = container.querySelector("svg")
        expect(svg?.getAttribute("width")).toBe("16")
        expect(svg?.getAttribute("aria-hidden")).toBe("true")
        expect(svg?.getAttribute("class")).toContain("lucide-sparkle")
        expect(container.querySelectorAll("path")).toHaveLength(1)
    })

    it("takes another size", () => {
        const {container} = render(<BuilderIcon size={20} />)
        expect(container.querySelector("svg")?.getAttribute("width")).toBe("20")
    })
})

describe("Confirmation dialog on the canvas scale", () => {
    it("draws a 400px box, a 14px/600 title, 13px secondary text and no footer band", () => {
        render(
            <AlertDialog open>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove Zendesk from this agent?</AlertDialogTitle>
                        <AlertDialogDescription>The connection stays.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter data-testid="footer">
                        <Button variant="outline">Cancel</Button>
                        <AlertDialogAction>Remove</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>,
        )
        const dialog = screen.getByRole("alertdialog")
        expect(dialog.className).toContain("max-w-[400px]")
        expect(dialog.className).toContain("rounded-[12px]")
        expect(screen.getByText("Remove Zendesk from this agent?").className).toContain(
            "font-semibold",
        )
        expect(screen.getByText("The connection stays.").className).toContain("text-[13px]")
        const footer = screen.getByTestId("footer").className
        expect(footer).not.toContain("border-t")
        expect(footer).not.toContain("bg-")
        // A caller's plain Button and the dialog's own action both take the 28px canvas size.
        expect(screen.getByRole("button", {name: "Cancel"}).dataset.size).toBe("compact")
        expect(screen.getByRole("button", {name: "Remove"}).className).toContain("h-control-sm")
    })

    it("an explicit size beats the dialog's default", () => {
        render(
            <AlertDialog open>
                <AlertDialogContent>
                    <AlertDialogTitle>t</AlertDialogTitle>
                    <Button size="lg">Big</Button>
                </AlertDialogContent>
            </AlertDialog>,
        )
        expect(screen.getByRole("button", {name: "Big"}).dataset.size).toBe("lg")
    })

    it("draws Keep editing as a secondary ghost in the unsaved changes dialog", () => {
        render(
            <UnsavedChangesDialog
                open
                description="Save your changes?"
                canSave
                onAnswer={() => undefined}
            />,
        )
        const keep = screen.getByRole("button", {name: "Keep editing"})
        expect(keep.dataset.size).toBe("compact")
        expect(keep.className.split(" ")).toContain("text-colorTextSecondary")
    })
})
