/** SVG previews through `<img>` only, where SVG runs no script and loads nothing external. */
import {useMemo} from "react"

import {useObjectUrl} from "./driveFileSource"

/** Past this an SVG stays a link: its bytes would sit in memory as a string and a blob. */
export const SVG_PREVIEW_CAP = 1024 * 1024

export const isSvgPath = (path: string): boolean => /\.svg$/i.test(path)

/** SVG text within the cap as an `image/svg+xml` object URL and its byte size; null otherwise. */
export function useSvgImage(text: string | null | undefined): {src: string; bytes: number} | null {
    const blob = useMemo(
        () =>
            typeof text === "string" && text.length <= SVG_PREVIEW_CAP
                ? new Blob([text], {type: "image/svg+xml"})
                : null,
        [text],
    )
    const src = useObjectUrl(blob)
    return blob && src ? {src, bytes: blob.size} : null
}
