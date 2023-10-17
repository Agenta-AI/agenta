import {message} from "antd"

export const copyToClipboard = async (text: string, showToast = true) => {
    if (!text) return
    try {
        await navigator.clipboard.writeText(text)
        if (showToast) message.success("Copied to clipboard!")
        return false
    } catch (err) {
        console.error("Failed to copy text to clipboard")
        return false
    }
}
