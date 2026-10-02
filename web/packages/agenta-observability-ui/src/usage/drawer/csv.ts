const cell = (value: string) => `"${value.replace(/"/g, '""')}"`

export const downloadCsv = (filename: string, rows: string[][]) => {
    const csv = rows.map((row) => row.map(cell).join(",")).join("\n")
    const url = URL.createObjectURL(new Blob([csv], {type: "text/csv"}))
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
}
