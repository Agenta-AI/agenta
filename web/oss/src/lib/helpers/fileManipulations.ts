import Papa from "papaparse"

export const escapeNewlines = (value: string) => value.replace(/\n/g, "\\n")

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

export const isValidCSVFile = (file: File) => {
    return new Promise((res) => {
        Papa.parse(file, {
            skipEmptyLines: true,
            complete: (results) => {
                if (results.data && results.data.length > 0) {
                    res(true)
                } else {
                    res(false)
                }
            },
            error: () => {
                res(false)
            },
        })
    })
}

export const isValidJSONFile = (file: File) => {
    return new Promise((res) => {
        const reader = new FileReader()
        reader.onload = (e) => {
            try {
                JSON.parse(e.target?.result as string)
                res(true)
            } catch (e) {
                res(false)
            }
        }
        reader.readAsText(file)
    })
}
