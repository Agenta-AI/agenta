import {PptxViewer, RECOMMENDED_ZIP_LIMITS} from "@aiden0z/pptx-renderer"

import {runViewer} from "./runtime"

let viewer: PptxViewer | null = null

runViewer({
    kind: "presentation",
    render: async (bytes, root) => {
        root.style.height = "100%"
        viewer = await PptxViewer.open(bytes, root, {
            renderMode: "slide",
            externalMedia: "block",
            fitMode: "contain",
            zipLimits: RECOMMENDED_ZIP_LIMITS,
            pdfjs: false,
            onSlideChange: (index) => window.parent.postMessage({type: "slide", index}, "*"),
        })
        // A ZIP with no slides (a renamed archive) is not a presentation.
        if (!viewer.slideCount) throw new Error("no slides")
        return {slideCount: viewer.slideCount}
    },
    goto: (index) => {
        if (viewer && index < viewer.slideCount) void viewer.goToSlide(index)
    },
})
