export const copyToClipboard = async (e: React.MouseEvent, text: string) => {
    e.preventDefault()
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch (err) {
        console.error("Failed to copy text to clipboard")
    }
}
