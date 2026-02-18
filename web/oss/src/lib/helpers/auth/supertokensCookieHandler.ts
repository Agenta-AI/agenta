import {getLocalCookiePortSuffix} from "../cookies"

interface CookieHandlerInterface {
    setCookie: (cookieString: string) => Promise<void>
    getCookie: () => Promise<string>
}

const SUPERTOKENS_COOKIE_BASE_NAMES = [
    "sAccessToken",
    "sRefreshToken",
    "sFrontToken",
    "sAntiCsrf",
    "st-last-access-token-update",
    "st-access-token",
    "st-refresh-token",
    "sIRTFrontend",
    "stSsrSessionRefreshAttempt",
    "sCurrentPath",
    "sSessionRefreshed",
    "sSessionRevoked",
] as const

const SUPERTOKENS_COOKIE_NAME_SET = new Set<string>(SUPERTOKENS_COOKIE_BASE_NAMES)

const getCookieBaseName = (name: string, suffix: string): string | null => {
    if (SUPERTOKENS_COOKIE_NAME_SET.has(name)) return name
    if (!suffix) return null

    for (const baseName of SUPERTOKENS_COOKIE_BASE_NAMES) {
        if (name === `${baseName}${suffix}`) return baseName
    }

    return null
}

const isOtherSupertokensSuffix = (name: string, suffix: string): boolean => {
    if (!suffix) return false

    for (const baseName of SUPERTOKENS_COOKIE_BASE_NAMES) {
        if (name.startsWith(`${baseName}_`) && name !== `${baseName}${suffix}`) {
            return true
        }
    }

    return false
}

const rewriteSetCookieString = (cookieString: string, suffix: string): string => {
    if (!suffix) return cookieString

    const firstSemicolon = cookieString.indexOf(";")
    const firstPart = firstSemicolon === -1 ? cookieString : cookieString.slice(0, firstSemicolon)
    const tail = firstSemicolon === -1 ? "" : cookieString.slice(firstSemicolon)

    const eqIndex = firstPart.indexOf("=")
    if (eqIndex <= 0) return cookieString

    const rawName = firstPart.slice(0, eqIndex).trim()
    const rawValue = firstPart.slice(eqIndex + 1)

    if (SUPERTOKENS_COOKIE_NAME_SET.has(rawName)) {
        return `${rawName}${suffix}=${rawValue}${tail}`
    }

    return cookieString
}

const rewriteCookieHeaderForSDK = (cookieHeader: string, suffix: string): string => {
    if (!suffix) return cookieHeader

    const parts = cookieHeader
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)

    const rewritten: string[] = []

    for (const part of parts) {
        const eqIndex = part.indexOf("=")
        if (eqIndex <= 0) {
            rewritten.push(part)
            continue
        }

        const name = part.slice(0, eqIndex).trim()
        const value = part.slice(eqIndex + 1)
        const baseName = getCookieBaseName(name, suffix)

        if (baseName) {
            if (name === `${baseName}${suffix}`) {
                rewritten.push(`${baseName}=${value}`)
            }
            continue
        }

        if (isOtherSupertokensSuffix(name, suffix)) {
            continue
        }

        rewritten.push(part)
    }

    return rewritten.join("; ")
}

export const createLocalSupertokensCookieHandler = (
    original: CookieHandlerInterface,
): CookieHandlerInterface => {
    const suffix = getLocalCookiePortSuffix()

    return {
        ...original,
        setCookie: async (cookieString: string) => {
            const namespacedCookieString = rewriteSetCookieString(cookieString, suffix)
            await original.setCookie(namespacedCookieString)
        },
        getCookie: async () => {
            const rawCookieHeader = await original.getCookie()
            return rewriteCookieHeaderForSDK(rawCookieHeader, suffix)
        },
    }
}
