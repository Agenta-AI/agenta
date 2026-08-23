/**
 * Stripe hands back a URL, and by then the click is over.
 *
 * A `window.open` issued after an await sits outside the user-gesture window, and iOS Safari and
 * Chrome for Android block it — the user taps and nothing happens. Reserve the tab inside the
 * handler instead, then point it at the URL once the request resolves.
 */

export interface ReservedTab {
    /** Send the reserved tab to the URL. Falls back to this tab if the popup was blocked. */
    navigate: (url: string) => void
    /** Nothing to show after all — drop the blank tab. */
    release: () => void
}

export const reserveTab = (): ReservedTab => {
    const tab = typeof window === "undefined" ? null : window.open("", "_blank")
    // Keeping the handle rules out `noopener`, so sever the back-reference by hand.
    if (tab) tab.opener = null

    return {
        navigate: (url) => {
            if (tab && !tab.closed) tab.location.href = url
            else window.location.assign(url)
        },
        release: () => {
            if (tab && !tab.closed) tab.close()
        },
    }
}
