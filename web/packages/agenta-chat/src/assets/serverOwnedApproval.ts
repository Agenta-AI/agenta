/**
 * Keep the server as the sole continuation owner even when its HTTP response is ambiguous.
 * A rejected request may have committed before the connection failed, so the browser must retire
 * its local auto-resume marker on both success and failure while still propagating the error.
 */
export async function submitServerOwnedApproval<T>({
    submit,
    retire,
}: {
    submit: () => Promise<T>
    retire: () => void
}): Promise<T> {
    try {
        return await submit()
    } finally {
        retire()
    }
}
