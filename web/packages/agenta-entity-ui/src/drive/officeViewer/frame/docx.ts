import {renderAsync} from "docx-preview"

import {runViewer} from "./runtime"

const style = document.createElement("style")
// The page keeps its own white paper; the frame around it shows the app's theme.
style.textContent =
    "body{overflow:auto}.docx-wrapper{background:transparent!important;padding:16px!important}" +
    // Reflow drops the page geometry: one column of text that fits the pane.
    ".reflow .docx-wrapper{padding:0!important;display:block!important}" +
    ".reflow section.docx{width:auto!important;min-height:0!important;padding:20px!important;margin:0!important;box-shadow:none!important}"
document.head.appendChild(style)

// docx-preview empties its style container, so it gets its own instead of <head>.
const docxStyles = document.createElement("div")
document.body.appendChild(docxStyles)

const PAGE_GUTTER = 32

// Pages have a fixed paper width; a narrower pane would clip their left edge, so scale them down.
function fitPages(root: HTMLElement): void {
    const wrapper = root.querySelector<HTMLElement>(".docx-wrapper")
    const page = wrapper?.querySelector<HTMLElement>("section.docx")
    if (!wrapper || !page || root.classList.contains("reflow")) return
    wrapper.style.zoom = ""
    const scale = Math.min(1, (window.innerWidth - PAGE_GUTTER) / page.offsetWidth)
    wrapper.style.zoom = String(scale)
}

// The page whose top last passed the upper third of the view, reported as the current page.
function trackPage(root: HTMLElement): void {
    let shown = -1
    let frame = 0
    const report = () => {
        frame = 0
        const line = window.innerHeight / 3
        const pages = Array.from(root.querySelectorAll("section.docx"))
        let index = 0
        pages.forEach((page, i) => {
            if (page.getBoundingClientRect().top <= line) index = i
        })
        if (index === shown) return
        shown = index
        window.parent.postMessage({type: "slide", index}, "*")
    }
    // The body is the scroller, so its scroll events reach the document only while capturing.
    document.addEventListener(
        "scroll",
        () => {
            if (!frame) frame = requestAnimationFrame(report)
        },
        true,
    )
}

runViewer({
    kind: "document",
    render: async (bytes, root, {reflow}) => {
        root.classList.toggle("reflow", reflow)
        await renderAsync(bytes, root, docxStyles, {
            renderAltChunks: false,
            useBase64URL: true,
            breakPages: !reflow,
            ignoreWidth: reflow,
            ignoreHeight: reflow,
        })
        fitPages(root)
        document.body.scrollTop = 0
        return {slideCount: root.querySelectorAll("section.docx").length}
    },
    setup: (root) => {
        window.addEventListener("resize", () => fitPages(root))
        trackPage(root)
    },
})
