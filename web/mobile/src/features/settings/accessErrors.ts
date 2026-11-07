import {t} from "@agenta/i18n/settings"

/** Plain-language message for a failed access action. The server text is never shown. */
export const plainAccessError = (error: unknown, fallback: string): string => {
    const candidate = error as {statusCode?: number; response?: {status?: number}} | null
    const status = candidate?.statusCode ?? candidate?.response?.status
    if (status === 403) return t("settings.accessErrors.forbidden")
    if (status === 409) return t("settings.accessErrors.conflict")
    return fallback
}
