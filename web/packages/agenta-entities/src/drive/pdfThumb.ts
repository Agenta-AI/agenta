/**
 * Lazy PDF first-page → PNG data-URL, for grid thumbnails. pdfjs-dist is ~large, so it is
 * dynamically imported (its own chunk, out of first load) and loaded ONCE (module-level promise).
 * The worker is served as a same-origin static asset from public/ (copied there by
 * scripts/copy-pdf-worker.mjs in dev + build) so nothing hits the network/CDN. Render is
 * size-capped by the caller.
 *
 * NOT `new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)`: the webpack production build
 * externalizes that ESM worker and fails ("ESM packages need to be imported"); dev's turbopack
 * tolerated it, so the break only ever showed in CI.
 */
type PdfjsModule = typeof import("pdfjs-dist")

let pdfjsPromise: Promise<PdfjsModule> | null = null
let workerSrc = "/pdf.worker.min.mjs"
// A worker that never comes up (its script 404s) leaves getDocument pending forever.
const OPEN_TIMEOUT_MS = 15_000

/** A host served under a base path (`/m`) points this at its own copy of the worker. */
export const setPdfWorkerSrc = (src: string) => {
    workerSrc = src
}

async function loadPdfjs(): Promise<PdfjsModule> {
    if (!pdfjsPromise) {
        pdfjsPromise = import("pdfjs-dist").then((pdfjs) => {
            pdfjs.GlobalWorkerOptions.workerSrc = workerSrc
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
        const task = pdfjs.getDocument({data})
        const doc = await Promise.race([
            task.promise,
            new Promise<never>((_, reject) =>
                setTimeout(() => {
                    void task.destroy()
                    reject(new Error("pdf worker timed out"))
                }, OPEN_TIMEOUT_MS),
            ),
        ])
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
