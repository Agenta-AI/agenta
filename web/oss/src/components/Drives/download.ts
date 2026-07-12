/** Save one drive file's text content via a blob download (Phase 1 — text endpoint only). */
export function downloadTextFile(filename: string, content: string) {
    const blob = new Blob([content], {type: "text/plain;charset=utf-8"})
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
}
