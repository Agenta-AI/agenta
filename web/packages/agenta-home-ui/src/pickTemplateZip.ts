/** Opens the system file picker for one template zip; resolves null when the user cancels. */
export const pickTemplateZip = (): Promise<File | null> =>
    new Promise((resolve) => {
        const input = document.createElement("input")
        input.type = "file"
        input.accept = ".zip,application/zip"
        input.hidden = true
        const done = (file: File | null) => {
            input.remove()
            resolve(file)
        }
        input.addEventListener("change", () => done(input.files?.[0] ?? null), {once: true})
        input.addEventListener("cancel", () => done(null), {once: true})
        // Attached: Safari ignores click() on an input outside the document.
        document.body.append(input)
        input.click()
    })
