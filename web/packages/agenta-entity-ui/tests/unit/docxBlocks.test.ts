// @vitest-environment jsdom
/** blocks.docx: a header, a paragraph split by a page break, a table, a content control. */
import {readFileSync} from "node:fs"
import {join} from "node:path"

import {installPreviewPicker, type PickerToHost} from "@agenta/shared/previewPicker"
import {parseAsync, renderDocument} from "docx-preview"
import {afterEach, describe, expect, it} from "vitest"

import {documentBody, modelBlocks, tagBlocks} from "../../src/drive/officeViewer/frame/docxBlocks"

const bytes = readFileSync(join(__dirname, "../fixtures/office/blocks.docx"))

// What frame/docx.ts renders, as HTML.
const render = async (reflow: boolean): Promise<string> => {
    const options = {breakPages: !reflow, ignoreWidth: reflow, ignoreHeight: reflow}
    const doc = await parseAsync(new Blob([bytes]), {
        ...options,
        keepOrigin: true,
    } as typeof options)
    tagBlocks(modelBlocks(doc), documentBody(doc))
    const root = document.createElement("div")
    root.id = "root"
    if (reflow) root.className = "reflow"
    for (const node of await renderDocument(doc, options))
        if (node.nodeName !== "STYLE") root.appendChild(node)
    return root.outerHTML
}

const tags = (html: string) => {
    const holder = document.createElement("div")
    holder.innerHTML = html
    return Array.from(holder.querySelectorAll("article > p, article > table")).map((b) => {
        const tag = (b.getAttribute("class") ?? "").split(" ").find((c) => c.startsWith("ag-"))
        return [tag ?? "-", (b.textContent ?? "").slice(0, 24)]
    })
}

const frames: HTMLIFrameElement[] = []

const realm = (html: string) => {
    const frame = document.createElement("iframe")
    document.body.appendChild(frame)
    frames.push(frame)
    const win = frame.contentWindow as Window & {eval(code: string): unknown}
    win.document.body.innerHTML = html
    win.eval("window.CSS = {escape: function (s) { return String(s) }}")
    const posted: PickerToHost[] = []
    ;(win as unknown as {__post: (m: PickerToHost) => void}).__post = (m) => posted.push(m)
    const handle = win.eval(`(${installPreviewPicker.toString()})(window.__post)`) as (
        message: unknown,
    ) => void
    handle({type: "pick-start", format: "document"})
    const pick = (text: string) => {
        const el = Array.from(win.document.querySelectorAll("p")).find(
            (p) => p.textContent === text,
        )
        if (!el) throw new Error(`no paragraph "${text}"`)
        el.dispatchEvent(new win.MouseEvent("mousedown", {bubbles: true}))
        el.dispatchEvent(new win.MouseEvent("click", {bubbles: true}))
        const msg = posted.filter((m) => m.type === "picked").pop()
        if (!msg || msg.type !== "picked") throw new Error("nothing picked")
        return msg.element
    }
    return {pick}
}

afterEach(() => {
    while (frames.length) frames.pop()?.remove()
})

describe("tagBlocks", () => {
    it("numbers blocks like python-docx in both layouts and skips content controls", async () => {
        expect(tags(await render(true))).toEqual([
            ["ag-p1", "Section 1"],
            ["ag-p2", "Para A."],
            ["ag-p3", "Para B before break.Para"],
            ["ag-t1", "Cell oneCell four"],
            ["ag-p4", "Para C."],
            ["-", "Inside a content control"],
            ["ag-p5", "Para D."],
        ])
        expect(tags(await render(false))).toEqual([
            ["ag-p1", "Section 1"],
            ["ag-p2", "Para A."],
            ["ag-p3", "Para B before break."],
            ["ag-p3", "Para B after break."],
            ["ag-t1", "Cell oneCell four"],
            ["ag-p4", "Para C."],
            ["-", "Inside a content control"],
            ["ag-p5", "Para D."],
        ])
    }, 30_000)
})

describe("picking a Word block", () => {
    it("names the same block and selector in Reflow and Pages, with a page only in Pages", async () => {
        const reflow = realm(await render(true))
        const pages = realm(await render(false))

        expect(reflow.pick("Para D.")).toMatchObject({
            selector: ".ag-p5",
            block: {kind: "paragraph", index: 5},
        })
        expect(reflow.pick("Para D.").page).toBeUndefined()
        expect(pages.pick("Para D.")).toMatchObject({
            selector: ".ag-p5",
            block: {kind: "paragraph", index: 5},
            page: 2,
        })

        expect(pages.pick("Para B after break.")).toMatchObject({
            selector: ".ag-p3",
            block: {kind: "paragraph", index: 3},
            page: 2,
        })

        const cell = reflow.pick("Cell four")
        expect(cell.block).toEqual({kind: "table", index: 1})
        expect(cell.selector.startsWith(".ag-t1 > ")).toBe(true)
        expect(pages.pick("Cell four").selector).toBe(cell.selector)
    }, 30_000)
})
