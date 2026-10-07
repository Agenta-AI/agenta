/**
 * SVG previews, shown through `<img>` only: an image context runs no script and loads nothing
 * external, so SVG markup is never put into the DOM. The bytes come from the text read (an SVG is
 * text), which `createImageBitmap` cannot downscale.
 */
import {useEffect, useState} from "react"

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

/** Whether the root tag sets both `width` and `height`, in any unit: then the browser's natural
 * size for the image is real, not its 300 x 150 stand-in for a size-less SVG. */
export function svgDeclaresSize(text: string): boolean {
    const tag = /<svg\b[^>]*>/i.exec(text)?.[0]
    return Boolean(tag && attrOf(tag, "width") && attrOf(tag, "height"))
}

const SVG_TYPE = "image/svg+xml"

/** One object URL per SVG text, shared by the figure, hover card and viewer; revoked when unused. */
const sharedImages = new Map<string, {src: string; bytes: number; refs: number}>()

function acquire(text: string) {
    let image = sharedImages.get(text)
    if (!image) {
        const blob = new Blob([text], {type: SVG_TYPE})
        image = {src: URL.createObjectURL(blob), bytes: blob.size, refs: 0}
        sharedImages.set(text, image)
    }
    image.refs += 1
    return image
}

function release(text: string) {
    const image = sharedImages.get(text)
    if (!image || --image.refs > 0) return
    URL.revokeObjectURL(image.src)
    sharedImages.delete(text)
}

/** SVG text within the cap as an `image/svg+xml` object URL and its byte size; null otherwise. */
export function useSvgImage(text: string | null | undefined): {src: string; bytes: number} | null {
    const usable = typeof text === "string" && text.length <= SVG_PREVIEW_CAP ? text : null
    const [image, setImage] = useState<{text: string; src: string; bytes: number} | null>(null)
    useEffect(() => {
        if (usable === null) return
        const {src, bytes} = acquire(usable)
        setImage({text: usable, src, bytes})
        return () => release(usable)
    }, [usable])
    return image && image.text === usable ? {src: image.src, bytes: image.bytes} : null
}
