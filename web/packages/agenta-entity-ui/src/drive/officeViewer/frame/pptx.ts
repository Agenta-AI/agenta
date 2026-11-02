import {PptxViewer, RECOMMENDED_ZIP_LIMITS} from "@aiden0z/pptx-renderer"

import {runViewer} from "./runtime"

// The strip sits outside #root, so the comment picker's slide lookup never reaches a thumbnail.
const style = document.createElement("style")
style.textContent = [
    "body{display:flex;flex-direction:column}",
    "#root{flex:1;min-height:0}",
    "body:not(.wide) #root{display:flex;flex-direction:column;justify-content:center}",
    ".strip{display:none;gap:12px;padding:12px;overflow-x:auto;flex-shrink:0}",
    "body.wide .strip{display:flex}",
    ".thumb{flex:none;display:flex;flex-direction:column;align-items:center;gap:4px;padding:0;border:0;background:none;cursor:pointer;font:12px system-ui,sans-serif;color:#8c8c8c}",
    ".thumb>div{width:112px;aspect-ratio:16/9;overflow:hidden;background:#fff;border-radius:4px;outline:1px solid rgba(128,128,128,.35)}",
    ".thumb.active>div{outline:2px solid #3b82f6}",
    ".thumb.active{color:#3b82f6;font-weight:600}",
].join("")
document.head.appendChild(style)

// Below this width the strip would crowd the slide; the app's prev and next buttons remain.
const WIDE_PX = 560
const THUMB_WIDTH = 112

let viewer: PptxViewer | null = null
const thumbs: HTMLButtonElement[] = []

const fitWidth = () => document.body.classList.toggle("wide", window.innerWidth >= WIDE_PX)

function markActive(index: number): void {
    thumbs.forEach((thumb, i) => thumb.classList.toggle("active", i === index))
    thumbs[index]?.scrollIntoView({block: "nearest", inline: "nearest"})
}

// Thumbnails render when scrolled into view, so a long deck does not lay out every slide up front.
function buildStrip(open: PptxViewer): void {
    const strip = document.createElement("div")
    strip.className = "strip"
    document.body.appendChild(strip)
    const observer = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) continue
                observer.unobserve(entry.target)
                const index = thumbs.indexOf(entry.target as HTMLButtonElement)
                const box = entry.target.firstElementChild as HTMLElement
                open.renderThumbnailToContainer(index, box, {width: THUMB_WIDTH})
            }
        },
        {root: strip, rootMargin: "0px 240px"},
    )
    for (let i = 0; i < open.slideCount; i++) {
        const thumb = document.createElement("button")
        thumb.className = "thumb"
        thumb.setAttribute("aria-label", `Slide ${i + 1}`)
        thumb.append(document.createElement("div"), String(i + 1))
        thumb.addEventListener("click", () => void open.goToSlide(i))
        strip.appendChild(thumb)
        thumbs.push(thumb)
        observer.observe(thumb)
    }
    markActive(0)
}

runViewer({
    kind: "presentation",
    setup: () => {
        fitWidth()
        window.addEventListener("resize", fitWidth)
    },
    render: async (bytes, root) => {
        viewer = await PptxViewer.open(bytes, root, {
            renderMode: "slide",
            externalMedia: "block",
            fitMode: "contain",
            zipLimits: RECOMMENDED_ZIP_LIMITS,
            pdfjs: false,
            onSlideChange: (index) => {
                markActive(index)
                window.parent.postMessage({type: "slide", index}, "*")
            },
        })
        // A ZIP with no slides (a renamed archive) is not a presentation.
        if (!viewer.slideCount) throw new Error("no slides")
        buildStrip(viewer)
        return {slideCount: viewer.slideCount}
    },
    goto: (index) => {
        if (viewer && index < viewer.slideCount) void viewer.goToSlide(index)
    },
})
