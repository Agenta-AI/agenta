// @vitest-environment jsdom
import {act} from "react"

import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it} from "vitest"

import {TestsetFileDrop} from "@/features/testsets/create/TestsetFileDrop"
import {useTestsetFilePick} from "@/features/testsets/create/useTestsetFilePick"

import {polyfillBlobText, until} from "./testsetHttp"
polyfillBlobText()
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

// The real hook and the real package file checks. Only the browser file picker is simulated.
function Harness() {
    const picked = useTestsetFilePick()
    return (
        <TestsetFileDrop
            file={picked.file}
            preview={picked.rows}
            error={picked.error}
            onFile={(file) => void picked.pick(file)}
            onRemove={picked.remove}
        />
    )
}

describe("Test set file drop", () => {
    let root: Root
    let host: HTMLDivElement

    beforeEach(() => {
        host = document.createElement("div")
        document.body.append(host)
        root = createRoot(host)
        act(() => root.render(<Harness />))
    })
    afterEach(() => {
        act(() => root.unmount())
        host.remove()
    })

    const choose = async (file: File) => {
        const input = host.querySelector<HTMLInputElement>('[data-testid="testset-file-input"]')!
        Object.defineProperty(input, "files", {value: [file], configurable: true})
        await act(async () => {
            input.dispatchEvent(new Event("change", {bubbles: true}))
        })
        await until(() =>
            expect(
                host.textContent?.includes(file.name) ||
                    host.querySelector('[role="alert"]') !== null,
            ).toBe(true),
        )
    }

    it("A file with another extension shows Unsupported file format", async () => {
        await choose(new File(["hello"], "notes.txt"))
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(
            "Unsupported file format. Please upload a CSV or JSON file.",
        )
        expect(host.textContent).toContain("Click or drag file to this area to upload")
    })

    it("An invalid JSON file shows Invalid JSON format", async () => {
        await choose(new File(["{not json"], "broken.json"))
        expect(host.querySelector('[role="alert"]')?.textContent).toBe(
            "Invalid JSON format. Ensure it's an array of objects with column names as keys.",
        )
    })

    it("A JSON file that is not an array of objects shows Invalid JSON format", async () => {
        await choose(new File(['{"question": "hi"}'], "object.json"))
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("Invalid JSON format")
    })

    it("A valid CSV file shows the file bar and the first five rows", async () => {
        const lines = [
            "question,answer",
            ...Array.from({length: 8}, (_, i) => `q${i + 1},a${i + 1}`),
        ]
        await choose(new File([lines.join("\n")], "cases.csv"))
        expect(host.textContent).toContain("cases.csv")
        expect(host.querySelectorAll("tbody tr")).toHaveLength(5)
        expect(Array.from(host.querySelectorAll("th")).map((cell) => cell.textContent)).toEqual([
            "question",
            "answer",
        ])
        expect(host.querySelector("tbody tr td")?.textContent).toBe("q1")
        expect(host.querySelector('[role="alert"]')).toBeNull()
    })

    it("Remove clears the file and the preview", async () => {
        await choose(new File(["a,b\n1,2"], "cases.csv"))
        const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Remove file"]')!
        await act(async () => remove.click())
        expect(host.textContent).not.toContain("cases.csv")
        expect(host.querySelector("table")).toBeNull()
        expect(host.textContent).toContain("Click or drag file to this area to upload")
    })

    it("A dropped file is checked like a chosen one", async () => {
        const target = host.querySelector("button[type='button']")!
        const drop = new Event("drop", {bubbles: true, cancelable: true})
        Object.defineProperty(drop, "dataTransfer", {
            value: {files: [new File(["a,b\n1,2"], "dropped.csv")]},
        })
        await act(async () => {
            target.dispatchEvent(drop)
        })
        await until(() => expect(host.textContent).toContain("dropped.csv"))
        expect(host.textContent).toContain("dropped.csv")
    })
})
