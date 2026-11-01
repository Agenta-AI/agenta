/** Transcript file card: written files always show, linked ones once listed, all offer Download. */
import {act} from "react"

import {createStore, Provider} from "jotai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const state = vi.hoisted(() => ({listed: new Set<string>()}))

vi.mock("../../src/drive/useDriveFileLookup", () => ({
    useDriveFileLookup: () => (path: string) =>
        state.listed.has(path)
            ? {
                  entry: {path, size: 387},
                  target: {mount: {id: "m1"}, path},
              }
            : {entry: null, target: null},
}))
vi.mock("../../src/drive/useDriveFileDownload", () => ({useDriveFileDownload: () => vi.fn()}))

import {DriveFileCard} from "../../src/drive/DriveFileCard"

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    state.listed = new Set()
    container = document.createElement("div")
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

const render = (node: React.ReactNode) =>
    act(() => root.render(<Provider store={createStore()}>{node}</Provider>))

const download = (name: string) => container.querySelector(`[aria-label="Download ${name}"]`)

describe("DriveFileCard", () => {
    it.each(["launch-kit-1.0.0.zip", "launch-kit/checklist.md", "page.html"])(
        "offers Download for a listed %s",
        (path) => {
            state.listed.add(path)
            render(<DriveFileCard path={path} op="write" />)
            expect(download(path.split("/").pop()!)).not.toBeNull()
        },
    )

    it("shows a linked zip once the drive lists it", () => {
        state.listed.add("launch-kit-1.0.0.zip")
        render(<DriveFileCard path="launch-kit-1.0.0.zip" listedOnly />)
        expect(container.textContent).toContain("launch-kit-1.0.0.zip")
        expect(download("launch-kit-1.0.0.zip")).not.toBeNull()
    })

    it("hides a linked file the drive does not hold", () => {
        render(<DriveFileCard path="missing.zip" listedOnly />)
        expect(container.innerHTML).toBe("")
    })

    it("still shows a written file the listing has not caught up with", () => {
        render(<DriveFileCard path="notes.md" op="write" />)
        expect(container.textContent).toContain("notes.md")
    })
})
