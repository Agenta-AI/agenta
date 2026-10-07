/** SVG previews through `<img>` only, where SVG runs no script and loads nothing external. */
import {useEffect, useState} from "react"

/** Past this an SVG stays a link: its bytes would sit in memory as a string and a blob. */
export const SVG_PREVIEW_CAP = 1024 * 1024

export const isSvgPath = (path: string): boolean => /\.svg$/i.test(path)

const SVG_TYPE = "image/svg+xml"

/** One object URL per SVG text, shared by figure, hover card and viewer; revoked when unused. */
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
