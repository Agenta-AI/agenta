export interface SessionRowTitle {
    title: string
    /** Null when the title is the message. */
    subtitle: string | null
}

export function sessionRowTitle(
    name: string | null | undefined,
    preview: string | null,
    automationTitle?: string | null,
): SessionRowTitle {
    const named = name?.trim()
    if (named) return {title: named, subtitle: preview}
    if (automationTitle) return {title: automationTitle, subtitle: preview}
    if (preview) return {title: preview, subtitle: null}
    return {title: tNow("sessions.status.untitledSession"), subtitle: null}
}
import {createT} from "@agenta/i18n"
import sessionsStatusCatalog from "@agenta/i18n/catalogs/sessions.status"

const tNow = createT(sessionsStatusCatalog)
