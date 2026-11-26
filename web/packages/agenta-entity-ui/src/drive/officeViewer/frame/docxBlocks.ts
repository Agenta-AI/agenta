// Numbers Word body blocks the way python-docx does, so a comment names a block the agent can open.
import {blockClass} from "@agenta/shared/previewPicker"

interface ModelBlock {
    type: string
    className?: string
}

const tag = (block: ModelBlock | undefined, kind: "p" | "t", index: number) => {
    if (block)
        block.className = [block.className, blockClass(kind, index)].filter(Boolean).join(" ")
}

const sdtContent = (el: Element): Element | null =>
    Array.from(el.children).find((c) => c.localName === "sdtContent") ?? null

// How many model blocks docx-preview builds from these XML body children (its parseBodyElements).
const modelCount = (parent: Element): number =>
    Array.from(parent.children).reduce((n, el) => {
        if (el.localName === "p" || el.localName === "tbl" || el.localName === "altChunk")
            return n + 1
        if (el.localName !== "sdt") return n
        const content = sdtContent(el)
        return n + (content ? modelCount(content) : 0)
    }, 0)

/**
 * Tags `blocks` (docx-preview's parsed body) with `ag-p<n>` / `ag-t<n>`, counted like python-docx
 * `document.paragraphs` / `document.tables`. Blocks inside content controls stay untagged:
 * docx-preview flattens them into the body, python-docx does not count them.
 */
export function tagBlocks(blocks: ModelBlock[], body: Element | null): void {
    if (!body) return
    let at = 0
    let paragraphs = 0
    let tables = 0
    for (const el of Array.from(body.children)) {
        if (el.localName === "p") tag(blocks[at++], "p", ++paragraphs)
        else if (el.localName === "tbl") tag(blocks[at++], "t", ++tables)
        else if (el.localName === "altChunk") at++
        else if (el.localName === "sdt") {
            const content = sdtContent(el)
            at += content ? modelCount(content) : 0
        }
    }
}

/** The `w:body` element of a document parsed with `keepOrigin: true`. */
export function documentBody(doc: unknown): Element | null {
    const part = (doc as {documentPart?: {_xmlDocument?: unknown}} | null)?.documentPart
    const xml = part?._xmlDocument
    if (!(xml instanceof Node)) return null
    const root = xml.nodeType === Node.DOCUMENT_NODE ? (xml as Document).documentElement : xml
    return root instanceof Element
        ? (Array.from(root.children).find((c) => c.localName === "body") ?? null)
        : null
}

/** docx-preview's parsed body blocks; empty when the model shape is not the one we know. */
export function modelBlocks(doc: unknown): ModelBlock[] {
    const children = (doc as {documentPart?: {body?: {children?: unknown}}} | null)?.documentPart
        ?.body?.children
    return Array.isArray(children) ? (children as ModelBlock[]) : []
}
