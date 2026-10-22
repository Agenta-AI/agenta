import {act, type ReactNode} from "react"

import type {DriveFileKind} from "@agenta/entities/drive"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {DriveSessionProvider} from "../../src/drive/driveSessionContext"
import {DriveToolbar} from "../../src/drive/DriveToolbar"
import {PreviewCommentModeProvider} from "../../src/drive/previewCommentMode"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const show = (previewKind: DriveFileKind, inConversation: boolean) => {
    const toolbar = (
        <PreviewCommentModeProvider fileKey="file">
            <DriveToolbar variant="other" path="reports/q3.xlsx" previewKind={previewKind} />
        </PreviewCommentModeProvider>
    )
    const tree: ReactNode = inConversation ? (
        <DriveSessionProvider sessionId="s1">{toolbar}</DriveSessionProvider>
    ) : (
        toolbar
    )
    act(() => root.render(tree))
}

const toggle = () => container.querySelector<HTMLButtonElement>('button[aria-label="Comment"]')

describe("Comment toggle", () => {
    it.each<DriveFileKind>(["spreadsheet", "html", "document", "presentation"])(
        "shows for a %s in a conversation",
        (kind) => {
            show(kind, true)
            expect(toggle()?.getAttribute("aria-pressed")).toBe("false")
        },
    )

    it("hides outside a conversation", () => {
        show("spreadsheet", false)
        expect(toggle()).toBeNull()
    })

    it("hides for a PDF", () => {
        show("pdf", true)
        expect(toggle()).toBeNull()
    })

    it("turns on by click and off by Escape on the page", () => {
        show("spreadsheet", true)
        act(() => toggle()?.click())
        expect(toggle()?.getAttribute("aria-pressed")).toBe("true")
        act(() => {
            document.body.dispatchEvent(
                new KeyboardEvent("keydown", {key: "Escape", bubbles: true}),
            )
        })
        expect(toggle()?.getAttribute("aria-pressed")).toBe("false")
    })
})
