/**
 * Copy text to clipboard utility
 *
 * Note: This is a simplified version. For toast notifications,
 * the calling code should handle the success/error messaging.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
    if (!text) return false
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch (err) {
        console.error("Failed to copy text to clipboard:", err)
        return false
    }
}
