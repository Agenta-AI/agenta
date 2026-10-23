// Office viewer frame (design D6): the host↔frame contract, the CSP, and the srcdoc it ships in.

// Old-style code on purpose: `relay` below is shipped as a string into a foreign document.
/* eslint-disable no-var, @typescript-eslint/prefer-for-of */

export type OfficeViewerKind = "document" | "presentation"

export type HostToViewer =
    | {type: "render"; kind: OfficeViewerKind; bytes: ArrayBuffer}
    | {type: "goto"; index: number}

export type ViewerToHost =
    | {type: "ready"}
    | {type: "rendered"; slideCount: number}
    | {type: "slide"; index: number}
    | {type: "failed"}
    | {type: "open-link"; url: string}

/** No `allow-same-origin`: the frame is an opaque origin with no cookies, storage or token. */
export const OFFICE_VIEWER_SANDBOX = "allow-scripts"

export const OFFICE_VIEWER_CSP = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data: blob:",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "form-action 'none'",
].join("; ")

const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"])
const MAX_URL_LENGTH = 2048

/** Only absolute http, https and mailto links leave the frame. */
export function isOpenableLink(url: string): boolean {
    if (url.length > MAX_URL_LENGTH) return false
    try {
        return LINK_PROTOCOLS.has(new URL(url).protocol)
    } catch {
        return false
    }
}

const isRecord = (x: unknown): x is Record<string, unknown> =>
    typeof x === "object" && x !== null && !Array.isArray(x)

const isIndex = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0

/** Frame → host, validated at the boundary; anything else is null and ignored. */
export function parseViewerMessage(data: unknown): ViewerToHost | null {
    if (!isRecord(data)) return null
    switch (data.type) {
        case "ready":
            return {type: "ready"}
        case "failed":
            return {type: "failed"}
        case "rendered":
            return isIndex(data.slideCount) ? {type: "rendered", slideCount: data.slideCount} : null
        case "slide":
            return isIndex(data.index) ? {type: "slide", index: data.index} : null
        case "open-link":
            return typeof data.url === "string" && isOpenableLink(data.url)
                ? {type: "open-link", url: data.url}
                : null
        default:
            return null
    }
}

/** Host → frame, validated inside the frame. */
export function parseHostMessage(data: unknown): HostToViewer | null {
    if (!isRecord(data)) return null
    if (data.type === "goto") return isIndex(data.index) ? {type: "goto", index: data.index} : null
    if (
        data.type === "render" &&
        (data.kind === "document" || data.kind === "presentation") &&
        data.bytes instanceof ArrayBuffer
    )
        return {type: "render", kind: data.kind, bytes: data.bytes}
    return null
}

/** Opens a link the frame asked for in a new tab, without an opener. */
export function openViewerLink(url: string): boolean {
    if (!isOpenableLink(url)) return false
    window.open(url, "_blank", "noopener,noreferrer")
    return true
}

/** Outer frame: nests the viewer under `frame-src 'none'` and relays messages both ways. */
function relay(viewerDoc: string, flags: string): void {
    var loads = 0
    var queue: {data: unknown; transfer: Transferable[]}[] = []
    var frame = document.createElement("iframe")
    frame.setAttribute("sandbox", flags)
    frame.setAttribute("title", "Viewer")
    frame.setAttribute("style", "display:block;width:100%;height:100%;border:0")

    frame.onload = function () {
        loads += 1
        if (loads > 1) {
            if (frame.parentNode) frame.parentNode.removeChild(frame)
            window.parent.postMessage({type: "failed"}, "*")
            return
        }
        var pending = queue
        queue = []
        for (var i = 0; i < pending.length; i++) send(pending[i].data, pending[i].transfer)
    }

    function send(data: unknown, transfer: Transferable[]): void {
        if (loads !== 1 || !frame.contentWindow) {
            if (loads === 0) queue.push({data: data, transfer: transfer})
            return
        }
        frame.contentWindow.postMessage(data, "*", transfer)
    }

    window.addEventListener("message", function (event: MessageEvent) {
        var data = event.data as {type?: unknown; bytes?: unknown} | null
        if (event.source === window.parent) {
            var bytes = data && data.bytes instanceof ArrayBuffer ? [data.bytes] : []
            send(data, bytes)
        } else if (event.source === frame.contentWindow && loads <= 1) {
            window.parent.postMessage(data, "*")
        }
    })

    frame.srcdoc = viewerDoc
    document.body.appendChild(frame)
}

/** A string safe to inline as a JS literal inside `<script>`. */
const scriptLiteral = (value: string): string =>
    JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029")

const BASE_STYLE = "html,body{margin:0;height:100%;background:transparent}"

const cspMeta = `<meta http-equiv="Content-Security-Policy" content="${OFFICE_VIEWER_CSP}">`

/** The srcdoc for the host iframe: the relay document holding the viewer document. */
export function buildViewerSrcdoc(viewerScript: string): string {
    const viewerDoc =
        `<!doctype html><html><head><meta charset="utf-8">${cspMeta}` +
        `<style>${BASE_STYLE}</style></head><body><script>${viewerScript.replace(/<\/script/gi, "<\\/script")}</script></body></html>`
    return (
        `<!doctype html><html><head><meta charset="utf-8">${cspMeta}` +
        `<style>${BASE_STYLE}body{overflow:hidden}</style></head><body><script>` +
        `(${relay.toString()})(${scriptLiteral(viewerDoc)}, ${scriptLiteral(OFFICE_VIEWER_SANDBOX)})` +
        "</script></body></html>"
    )
}
