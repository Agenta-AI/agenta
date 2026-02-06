import {message} from "@agenta/ui/app-message"

export const getErrorMessage = (error: any, fallback = "An unknown error occurred!") => {
    let message = fallback
    if (error == null) return message
    error?.preventDefault && error.preventDefault()
    if (typeof error === "string") message = error
    else if (error.message) message = error.message
    else if (error && typeof error === "object") message = getErrorMessage(Object.values(error)[0])
    else message = JSON.stringify(error)
    return message
}

export const globalErrorHandler = (error: any) => {
    const errorMsg = getErrorMessage(error)
    console.error(errorMsg, error)
    message.error(errorMsg)
}

export type AnyErr = unknown

const getLower = (v: unknown) => (typeof v === "string" ? v.toLowerCase() : "")

export const isNetworkIssue = (err: AnyErr): boolean => {
    const name = typeof (err as any)?.name === "string" ? (err as any).name : ""
    const code = typeof (err as any)?.code === "string" ? (err as any).code : ""
    const msg = getLower((err as any)?.message)

    // Guard navigator in SSR
    const offline =
        typeof navigator !== "undefined" && typeof navigator.onLine === "boolean"
            ? !navigator.onLine
            : false

    return (
        offline ||
        code === "NETWORK_ERROR" ||
        name === "NetworkError" ||
        (name === "TypeError" &&
            msg &&
            /network|fetch|connection|timeout|failed to fetch/i.test(
                msg,
            )) /* more specific network-related TypeError check */ ||
        msg.includes("network") ||
        msg.includes("refused") ||
        msg.includes("timeout") ||
        msg.includes("unreachable")
    )
}

export const isServerError = (err: AnyErr): boolean => {
    const status = (err as any)?.status
    if (typeof status === "number") {
        return (status >= 500 && status <= 504) || status === 404
    }
    // Avoid brittle message parsing; keep minimal fallback if you must:
    const msg = getLower((err as any)?.message)
    return ["500", "502", "503", "504", "404"].some((c) => msg.includes(c))
}

export const isBackendAvailabilityIssue = (err: AnyErr): boolean =>
    isNetworkIssue(err) || isServerError(err)
