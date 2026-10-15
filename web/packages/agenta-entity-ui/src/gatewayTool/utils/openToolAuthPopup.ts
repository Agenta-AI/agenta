import {getAgentaApiUrl, getAgentaWebUrl} from "@agenta/shared/api"
import {message} from "@agenta/ui"

const trustedOrigins = () => {
    const origins = new Set<string>([window.location.origin])
    for (const url of [getAgentaApiUrl(), getAgentaWebUrl()]) {
        if (!url) continue
        try {
            origins.add(new URL(url).origin)
        } catch {
            // An invalid env URL adds no origin.
        }
    }
    return origins
}

/** Open a provider's auth popup; `onDone` fires once. `null` means blocked, so the tab redirected. */
export const openToolAuthPopup = (redirectUrl: string, onDone: () => void) => {
    const popup = window.open(redirectUrl, "tools_oauth", "width=600,height=700,popup=yes")
    if (!popup) {
        message.warning("Popup blocked. Redirecting in this tab.")
        window.location.assign(redirectUrl)
        return null
    }
    const origins = trustedOrigins()
    const cleanup = () => {
        window.removeEventListener("message", handler)
        clearInterval(pollTimer)
    }
    const done = () => {
        cleanup()
        window.focus()
        onDone()
    }
    const handler = (event: MessageEvent) => {
        if (event.data?.type === "tools:oauth:complete" && origins.has(event.origin)) done()
    }
    window.addEventListener("message", handler)
    const pollTimer = setInterval(() => {
        if (popup.closed) done()
    }, 1000)
    return cleanup
}
