/**
 * Lazy PDF first-page → PNG data-URL, for grid thumbnails. pdfjs-dist is ~large, so it is
 * dynamically imported (its own chunk, out of first load) and loaded ONCE (module-level promise).
 * The worker is resolved from the bundled asset via `new URL(…, import.meta.url)` (webpack/Next
 * asset emission) so nothing hits the network/CDN. Render is size-capped by the caller.
 */
type PdfjsModule = typeof import("pdfjs-dist")

let pdfjsPromise: Promise<PdfjsModule> | null = null

async function loadPdfjs(): Promise<PdfjsModule> {
    if (!pdfjsPromise) {
        pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
            pdfjs.GlobalWorkerOptions.workerSrc = new URL(
                "pdfjs-dist/build/pdf.worker.min.mjs",
                import.meta.url,
            ).toString()
            return pdfjs
        })
    }
    return pdfjsPromise
}

/** Render page 1 of a PDF blob to a PNG data URL, longest side ≤ `maxPx`. Null on any failure
 * (corrupt file, worker error) — the caller falls back to the type icon. */
export async function renderPdfFirstPage(blob: Blob, maxPx = 200): Promise<string | null> {
    try {
        const pdfjs = await loadPdfjs()
        const data = await blob.arrayBuffer()
        const doc = await pdfjs.getDocument({data}).promise
        try {
            const page = await doc.getPage(1)
            const base = page.getViewport({scale: 1})
            const scale = maxPx / Math.max(base.width, base.height)
            const viewport = page.getViewport({scale: Math.min(scale, 2)})
            const canvas = document.createElement("canvas")
            canvas.width = Math.ceil(viewport.width)
            canvas.height = Math.ceil(viewport.height)
            const ctx = canvas.getContext("2d")
            if (!ctx) return null
            await page.render({canvasContext: ctx, viewport}).promise
            return canvas.toDataURL("image/png")
        } finally {
            void doc.destroy()
        }
    } catch {
        return null
    }
}
