const SNIPPET_PDF_FILENAME = "snippet.pdf"
const SNIPPET_PDF_MIME_TYPE = "application/pdf"

const PDF_PAGE_WIDTH = 612
const PDF_PAGE_HEIGHT = 792
const PDF_MARGIN_X = 48
const PDF_MARGIN_Y = 48
const PDF_FONT_SIZE = 10
const PDF_LINE_HEIGHT = 14
const PDF_FONT_WIDTH_FACTOR = 0.6

export interface SnippetAttachment {
    fileData: string
    filename: string
    mimeType: string
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            if (typeof reader.result === "string") {
                resolve(reader.result)
                return
            }

            reject(new Error("Failed to create snippet data URL."))
        }
        reader.onerror = () => reject(reader.error ?? new Error("Failed to read snippet blob."))
        reader.readAsDataURL(blob)
    })
}

function encodeAscii(text: string): Uint8Array {
    return new TextEncoder().encode(text)
}

function joinBytes(chunks: Uint8Array[]): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const joined = new Uint8Array(totalLength)
    let offset = 0

    for (const chunk of chunks) {
        joined.set(chunk, offset)
        offset += chunk.length
    }

    return joined
}

function normalizeSnippetText(text: string): string {
    return text
        .replace(/\r\n?/g, "\n")
        .replace(/\t/g, "    ")
        .split("")
        .filter((char) => {
            const code = char.charCodeAt(0)
            return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d
        })
        .join("")
}

function wrapLine(line: string, maxCharsPerLine: number): string[] {
    if (!line) {
        return [""]
    }

    const wrapped: string[] = []

    for (let start = 0; start < line.length; start += maxCharsPerLine) {
        wrapped.push(line.slice(start, start + maxCharsPerLine))
    }

    return wrapped
}

function paginateText(text: string): string[][] {
    const normalizedText = normalizeSnippetText(text)
    const maxCharsPerLine = Math.max(
        1,
        Math.floor((PDF_PAGE_WIDTH - PDF_MARGIN_X * 2) / (PDF_FONT_SIZE * PDF_FONT_WIDTH_FACTOR)),
    )
    const maxLinesPerPage = Math.max(
        1,
        Math.floor((PDF_PAGE_HEIGHT - PDF_MARGIN_Y * 2) / PDF_LINE_HEIGHT),
    )
    const lines = normalizedText.split("\n").flatMap((line) => wrapLine(line, maxCharsPerLine))
    const safeLines = lines.length > 0 ? lines : [""]
    const pages: string[][] = []

    for (let start = 0; start < safeLines.length; start += maxLinesPerPage) {
        pages.push(safeLines.slice(start, start + maxLinesPerPage))
    }

    return pages.length > 0 ? pages : [[""]]
}

function escapePdfText(text: string): string {
    return text
        .replace(/[^\x20-\x7e\xa0-\xff]/g, "?")
        .replace(/\\/g, "\\\\")
        .replace(/\(/g, "\\(")
        .replace(/\)/g, "\\)")
}

function buildPageContent(lines: string[]): Uint8Array {
    const startY = PDF_PAGE_HEIGHT - PDF_MARGIN_Y - PDF_FONT_SIZE
    const commands = [
        "BT",
        `/F1 ${PDF_FONT_SIZE} Tf`,
        `${PDF_LINE_HEIGHT} TL`,
        `1 0 0 1 ${PDF_MARGIN_X} ${startY} Tm`,
    ]

    lines.forEach((line, index) => {
        if (index > 0) {
            commands.push("T*")
        }

        commands.push(`(${escapePdfText(line)}) Tj`)
    })

    commands.push("ET")

    return encodeAscii(`${commands.join("\n")}\n`)
}

function createPdfBytes(pages: string[][]): Uint8Array {
    const pageObjectIds = pages.map((_, index) => 4 + index * 2)
    const contentObjectIds = pages.map((_, index) => 5 + index * 2)
    const objectCount = 3 + pages.length * 2
    const offsets = new Array<number>(objectCount + 1).fill(0)
    const chunks: Uint8Array[] = []
    let currentOffset = 0

    const pushChunk = (chunk: Uint8Array | string) => {
        const bytes = typeof chunk === "string" ? encodeAscii(chunk) : chunk
        chunks.push(bytes)
        currentOffset += bytes.length
    }

    const pushObject = (objectId: number, body: Uint8Array | string) => {
        offsets[objectId] = currentOffset
        pushChunk(`${objectId} 0 obj\n`)
        pushChunk(body)
        pushChunk("\nendobj\n")
    }

    pushChunk("%PDF-1.4\n")

    pushObject(1, "<< /Type /Catalog /Pages 2 0 R >>")
    pushObject(
        2,
        `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    )
    pushObject(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>")

    pages.forEach((pageLines, index) => {
        const pageObjectId = pageObjectIds[index]
        const contentObjectId = contentObjectIds[index]
        const contentStream = buildPageContent(pageLines)

        pushObject(
            pageObjectId,
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
        )
        pushObject(
            contentObjectId,
            joinBytes([
                encodeAscii(`<< /Length ${contentStream.length} >>\nstream\n`),
                contentStream,
                encodeAscii("endstream"),
            ]),
        )
    })

    const xrefOffset = currentOffset

    pushChunk(`xref\n0 ${objectCount + 1}\n`)
    pushChunk("0000000000 65535 f \n")

    for (let objectId = 1; objectId <= objectCount; objectId++) {
        pushChunk(`${offsets[objectId].toString().padStart(10, "0")} 00000 n \n`)
    }

    pushChunk(
        `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
    )

    return joinBytes(chunks)
}

export async function createSnippetPdfAttachment(text: string): Promise<SnippetAttachment> {
    const pdfBlob = new Blob([createPdfBytes(paginateText(text))], {
        type: SNIPPET_PDF_MIME_TYPE,
    })
    const fileData = await readBlobAsDataUrl(pdfBlob)

    return {
        fileData,
        filename: SNIPPET_PDF_FILENAME,
        mimeType: SNIPPET_PDF_MIME_TYPE,
    }
}
