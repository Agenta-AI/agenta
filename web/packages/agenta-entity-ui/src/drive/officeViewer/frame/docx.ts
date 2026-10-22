import {renderAsync} from "docx-preview"

import {runViewer} from "./runtime"

const style = document.createElement("style")
// The page keeps its own white paper; the frame around it shows the app's theme.
style.textContent =
    "body{overflow:auto}.docx-wrapper{background:transparent!important;padding:16px!important}"

const PAGE_GUTTER = 32

// Pages have a fixed paper width; a narrower pane would clip their left edge, so scale them down.
function fitPages(root: HTMLElement): void {
    const wrapper = root.querySelector<HTMLElement>(".docx-wrapper")
    const page = wrapper?.querySelector<HTMLElement>("section.docx")
    if (!wrapper || !page) return
    wrapper.style.zoom = ""
    const scale = Math.min(1, (window.innerWidth - PAGE_GUTTER) / page.offsetWidth)
    wrapper.style.zoom = String(scale)
}

runViewer({
    kind: "document",
    render: async (bytes, root) => {
        await renderAsync(bytes, root, document.head, {
            renderAltChunks: false,
            useBase64URL: true,
            breakPages: true,
        })
        // renderAsync empties its style container, so the override goes in after it.
        document.head.appendChild(style)
        fitPages(root)
        window.addEventListener("resize", () => fitPages(root))
        return {slideCount: 0}
    },
})
