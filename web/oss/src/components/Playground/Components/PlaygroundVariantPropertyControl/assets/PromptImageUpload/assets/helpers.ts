export const isValidImageUrl = (value: string): boolean => {
    try {
        const isHttp = value.startsWith("http://") || value.startsWith("https://")
        const isDataUrl = /^data:image\/(png|jpeg|webp|gif);base64,/.test(value)
        return isHttp || isDataUrl
    } catch {
        return false
    }
}
