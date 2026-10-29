import {renderAsync} from "docx-preview"

import {pageAtLine, sectionPageCount} from "./docxPages"
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

// Per rendered section: its page count, and its paper height as a share of its own height.
// Measured before `fitPages` zooms them; the share holds at any zoom.
let sectionPages: {pages: number; paperShare: number}[] = []

function countPages(root: HTMLElement): number {
    const sections = Array.from(root.querySelectorAll<HTMLElement>("section.docx"))
    sectionPages = sections.map((section) => {
        const height = section.offsetHeight
        const paper = parseFloat(getComputedStyle(section).minHeight)
        const pages = sectionPageCount(height, paper)
        return {pages, paperShare: pages > 1 ? paper / height : 1}
    })
    return sectionPages.reduce((sum, {pages}) => sum + pages, 0)
}

// The page at the upper third of the view, reported as the current page.
function trackPage(root: HTMLElement): void {
    let shown = -1
    let frame = 0
    const report = () => {
        frame = 0
        const sections = Array.from(root.querySelectorAll("section.docx")).map((section, i) => {
            const {top, height} = section.getBoundingClientRect()
            const {pages, paperShare} = sectionPages[i] ?? {pages: 1, paperShare: 1}
            return {top, height, pages, pageHeight: height * paperShare}
        })
        const index = pageAtLine(sections, window.innerHeight / 3)
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
        const slideCount = countPages(root)
        fitPages(root)
        document.body.scrollTop = 0
        return {slideCount}
    },
    setup: (root) => {
        window.addEventListener("resize", () => fitPages(root))
        trackPage(root)
    },
})
