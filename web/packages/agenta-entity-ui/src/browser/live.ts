import {getAgentaApiUrl} from "@agenta/shared/api"

export interface BrowserViewport {
    width: number
    height: number
}

/** The viewport `agenta-browser` renders before its first frame says otherwise. */
export const BROWSER_VIEWPORT: BrowserViewport = {width: 1280, height: 800}

/** `id` stays with a tab while others open and close. */
export interface BrowserLiveTab {
    id: number
    title: string
    url: string
    active: boolean
}

export type BrowserLiveServerMessage =
    | {type: "frame"; data: string; width: number; height: number}
    | {
          type: "status"
          control: "agent" | "user"
          url: string
          title: string
          waitReason: string
          tabs: BrowserLiveTab[]
      }
    | {type: "notice"; message: string}

export type BrowserLiveClientMessage =
    | {
          type: "mouse"
          event: "down" | "up" | "move" | "wheel"
          x: number
          y: number
          button?: "left" | "middle" | "right"
          deltaX?: number
          deltaY?: number
      }
    | {type: "key"; event: "down" | "up"; key: string; code?: string}
    | {type: "text"; text: string}
    | {type: "control"; take: boolean}
    | {type: "done"}
    | {type: "navigate"; url: string}
    | {type: "reload"}
    | {type: "tab"; id: number}

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

const parseTabs = (raw: unknown): BrowserLiveTab[] =>
    Array.isArray(raw)
        ? raw.filter(isRecord).flatMap((tab) =>
              typeof tab.id === "number"
                  ? [
                        {
                            id: tab.id,
                            title: typeof tab.title === "string" ? tab.title : "",
                            url: typeof tab.url === "string" ? tab.url : "",
                            active: tab.active === true,
                        },
                    ]
                  : [],
          )
        : []

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
            waitReason: typeof data.wait_reason === "string" ? data.wait_reason : "",
            tabs: parseTabs(data.tabs),
        }
    }
    if (data.type === "notice" && typeof data.message === "string") {
        return {type: "notice", message: data.message}
    }
    return null
}
