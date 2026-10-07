/**
 * SVG previews, shown through `<img>` only: an image context runs no script and loads nothing
 * external, so SVG markup is never put into the DOM. The bytes come from the text read (an SVG is
 * text), which `createImageBitmap` cannot downscale.
 */
import {useMemo} from "react"

import {useObjectUrl} from "./driveFileSource"

/** Past this an SVG stays a link: its bytes would sit in memory as a string and a blob. */
export const SVG_PREVIEW_CAP = 1024 * 1024

export const isSvgPath = (path: string): boolean => /\.svg$/i.test(path)

const attrOf = (tag: string, name: string): string | undefined =>
    new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1]

const pxOf = (value?: string): number | null => {
    const match = value ? /^\s*([\d.]+)\s*(?:px)?\s*$/i.exec(value) : null
    const n = match ? Number.parseFloat(match[1]) : Number.NaN
    return n > 0 ? n : null
}

/** The root tag's size: `width`/`height` in px, completed or replaced by the `viewBox`. */
export function svgIntrinsicSize(text: string): {width: number; height: number} | null {
    const tag = /<svg\b[^>]*>/i.exec(text)?.[0]
    if (!tag) return null
    const width = pxOf(attrOf(tag, "width"))
    const height = pxOf(attrOf(tag, "height"))
    if (width && height) return {width, height}
    const box = attrOf(tag, "viewBox")
        ?.trim()
        .split(/[\s,]+/)
        .map(Number)
    if (!box || box.length !== 4 || !(box[2] > 0) || !(box[3] > 0)) return null
    if (width) return {width, height: (width * box[3]) / box[2]}
    if (height) return {width: (height * box[2]) / box[3], height}
    return {width: box[2], height: box[3]}
}

/** An `image/svg+xml` object URL for SVG text within the cap; null otherwise. */
export function useSvgObjectUrl(text: string | null | undefined): string | null {
    const blob = useMemo(
        () =>
            typeof text === "string" && text.length <= SVG_PREVIEW_CAP
                ? new Blob([text], {type: "image/svg+xml"})
                : null,
        [text],
    )
    return useObjectUrl(blob)
}
