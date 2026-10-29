/** Browser file downloads. No-ops during SSR. */

const downloadBlob = (content: string | BlobPart[], filename: string, type: string): void => {
    if (typeof window === "undefined") return

    const blob = new Blob(Array.isArray(content) ? content : [content], {type})
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = objectUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(objectUrl)
}

export const downloadCsv = (csvContent: string | BlobPart[], filename: string): void =>
    downloadBlob(csvContent, filename, "text/csv")

export const downloadText = (content: string, filename: string, type = "text/markdown"): void =>
    downloadBlob(content, filename, type)
