import {useEffect, useState} from "react"

import {altKeyLabel} from "../utils/platform"

/** The Alt key's glyph for this platform, resolved after mount so SSR can't mismatch it. */
export function useAltKey(): string {
    const [label, setLabel] = useState("Alt")
    useEffect(() => setLabel(altKeyLabel()), [])
    return label
}
