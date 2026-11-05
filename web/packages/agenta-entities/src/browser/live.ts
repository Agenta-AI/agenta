import {getAgentaApiUrl} from "@agenta/shared/api"

import type {BrowserLiveServerMessage} from "./types"

/** The viewport `agenta-browser` renders; pointer input is sent in these CSS pixels. */
export const BROWSER_VIEWPORT = {width: 1280, height: 800} as const

/** Cookies authenticate the live socket, so the API origin must be the app's. */
export const browserLiveUrl = (projectId: string, sessionId: string): string => {
    const url = new URL(`${getAgentaApiUrl()}/browser/live`, globalThis.location?.href)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    url.searchParams.set("project_id", projectId)
    url.searchParams.set("session_id", sessionId)
    return url.toString()
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null

export const parseBrowserLiveMessage = (raw: unknown): BrowserLiveServerMessage | null => {
    if (typeof raw !== "string") return null
    let data: unknown
    try {
        data = JSON.parse(raw)
    } catch {
        return null
    }
    if (!isRecord(data)) return null
    if (data.type === "frame" && typeof data.data === "string") {
        return {
            type: "frame",
            data: data.data,
            width: Number(data.width) || BROWSER_VIEWPORT.width,
            height: Number(data.height) || BROWSER_VIEWPORT.height,
        }
    }
    if (data.type === "status") {
        return {
            type: "status",
            control: data.control === "user" ? "user" : "agent",
            url: typeof data.url === "string" ? data.url : "",
            title: typeof data.title === "string" ? data.title : "",
            waiting: typeof data.waiting === "string" ? data.waiting : "",
        }
    }
    if (data.type === "notice" && typeof data.message === "string") {
        return {type: "notice", message: data.message}
    }
    return null
}
