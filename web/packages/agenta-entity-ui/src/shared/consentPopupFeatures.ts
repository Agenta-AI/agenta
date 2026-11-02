const CONSENT_POPUP_WIDTH = 1024
const CONSENT_POPUP_HEIGHT = 768

/**
 * The `window.open` features for a provider sign-in window: large enough for a desktop
 * sign-in page, never larger than the screen, centered over the window that opens it.
 */
export const consentPopupFeatures = (
    opener: Pick<Window, "screenX" | "screenY" | "outerWidth" | "outerHeight"> & {
        screen: Pick<Window["screen"], "availWidth" | "availHeight">
    },
): string => {
    const width = Math.min(CONSENT_POPUP_WIDTH, opener.screen.availWidth)
    const height = Math.min(CONSENT_POPUP_HEIGHT, opener.screen.availHeight)
    const left = Math.round(opener.screenX + (opener.outerWidth - width) / 2)
    const top = Math.round(opener.screenY + (opener.outerHeight - height) / 2)
    return `width=${width},height=${height},left=${left},top=${top},popup=yes`
}
