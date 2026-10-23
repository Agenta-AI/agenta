// Runs inside the viewer frame: receives the bytes once, renders them, keeps links in the frame.
import {installPreviewPicker, isHostToPickerType} from "@agenta/shared/previewPicker"

import {
    isOpenableLink,
    parseHostMessage,
    type OfficeViewerKind,
    type ViewerToHost,
} from "../protocol"

export interface FrameRenderer {
    kind: OfficeViewerKind
    /** Renders into `root`; runs again with the same bytes when the host switches the layout. */
    render: (
        bytes: ArrayBuffer,
        root: HTMLElement,
        layout: {reflow: boolean},
    ) => Promise<{slideCount: number}>
    /** Runs once, before the first render. */
    setup?: (root: HTMLElement) => void
    goto?: (index: number) => void
}

const XLINK = "http://www.w3.org/1999/xlink"

const post = (message: ViewerToHost) => window.parent.postMessage(message, "*")

const linkTarget = (anchor: Element): string | null =>
    anchor.getAttribute("href") ?? anchor.getAttributeNS(XLINK, "href")

/** Any link that is not an in-page anchor or an openable URL renders as plain text. */
export function sanitizeLinks(root: ParentNode): void {
    for (const anchor of Array.from(root.querySelectorAll("a"))) {
        anchor.removeAttribute("target")
        const target = linkTarget(anchor)
        if (target === null || target.startsWith("#") || isOpenableLink(target)) continue
        anchor.removeAttribute("href")
        anchor.removeAttributeNS(XLINK, "href")
    }
}

function onClick(event: MouseEvent): void {
    const anchor = event
        .composedPath()
        .find((node): node is Element => node instanceof Element && node.localName === "a")
    if (!anchor) return
    const target = linkTarget(anchor)
    if (target?.startsWith("#")) return
    event.preventDefault()
    if (target && isOpenableLink(target)) post({type: "open-link", url: target})
}

export function runViewer(renderer: FrameRenderer): void {
    const root = document.createElement("div")
    root.id = "root"
    document.body.appendChild(root)
    document.addEventListener("click", onClick, true)
    const picker = installPreviewPicker(post)
    let bytes: ArrayBuffer | null = null

    const draw = (layout: {reflow: boolean}) =>
        renderer
            .render(bytes as ArrayBuffer, root, layout)
            .then(({slideCount}) => {
                sanitizeLinks(root)
                post({type: "rendered", slideCount})
            })
            .catch(() => post({type: "failed"}))

    window.addEventListener("message", (event) => {
        if (event.source !== window.parent) return
        const data = event.data as {type?: unknown} | null
        if (data && isHostToPickerType(data.type)) {
            picker(data)
            return
        }
        const message = parseHostMessage(event.data)
        if (!message) return
        if (message.type === "goto") {
            renderer.goto?.(message.index)
            return
        }
        if (message.type === "layout") {
            if (bytes) void draw({reflow: message.reflow})
            return
        }
        if (bytes || message.kind !== renderer.kind) return
        bytes = message.bytes
        renderer.setup?.(root)
        void draw({reflow: message.reflow})
    })

    post({type: "ready"})
}
